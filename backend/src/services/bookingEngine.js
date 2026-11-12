// Booking engine: computes available slots and creates bookings safely.
//
// Slot generation rules (proposal section 10):
//   - Only slots within the provider's configured working hours.
//   - No booking in the past.
//   - Cancelled appointments do not block availability.
//   - One schedule time zone, displayed to customers.
//
// Conflict prevention: the final insert + overlap check run atomically inside a
// Postgres function (book_appointment RPC) so two simultaneous requests cannot
// double-book the same slot (proposal: "Use a database-level constraint or
// transaction-safe booking operation").

import { supabaseAdmin } from '../config/supabase.js';
import { ensureSupabase } from '../config/supabase.js';
import { httpError } from '../utils/http.js';
import {
  weekdayNameFor,
  parseHHMM,
  combineDateAndTime,
  minutesToHHMM,
  overlaps,
  isInPast,
  zonedParts,
} from '../utils/time.js';

// Fetch a single active service by id.
// (services table per proposal: id, name, description, duration_minutes,
// active — no provider_id; the provider is chosen in the booking flow.)
async function getService(serviceId) {
  const { data, error } = await supabaseAdmin
    .from('services')
    .select('id, name, description, duration_minutes, active')
    .eq('id', serviceId)
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to load service.', error.message);
  if (!data) throw httpError(404, 'Service not found.');
  if (!data.active) throw httpError(400, 'This service is no longer available.');
  return data;
}

// Load the provider's availability windows for a given date's weekday,
// normalising the optional `breaks` JSONB column into [{start,end}] minutes.
async function getAvailability(providerId, date) {
  const weekday = weekdayNameFor(new Date(`${date}T00:00:00`));
  const { data, error } = await supabaseAdmin
    .from('availability')
    .select('id, weekday, start_time, end_time, breaks')
    .eq('provider_id', providerId)
    .eq('weekday', weekday);
  if (error) throw httpError(500, 'Failed to load availability.', error.message);
  return (data || []).map(normaliseWindow);
}

function normaliseWindow(row) {
  const start = parseHHMM(row.start_time);
  const end = parseHHMM(row.end_time);
  const breaks = Array.isArray(row.breaks)
    ? row.breaks
        .map((b) => ({
          start: parseHHMM(b.start ?? b.from),
          end: parseHHMM(b.end ?? b.to),
        }))
        .filter((b) => b.start != null && b.end != null && b.end > b.start)
    : [];
  return { ...row, start, end, breaks };
}

// Build the list of available slots for a service on a given date.
export async function getAvailableSlots({ providerId, serviceId, date }) {
  ensureSupabase();
  if (!providerId) throw httpError(400, 'Provider is required.');
  if (!serviceId) throw httpError(400, 'Service is required.');

  const service = await getService(serviceId);
  // The provider is supplied explicitly in the booking flow (services are
  // provider-agnostic in the proposal's data model).
  const provider = providerId;
  if (!provider) throw httpError(400, 'A provider is required.');
  const duration = service.duration_minutes;
  if (!duration || duration <= 0) {
    throw httpError(500, 'Service has no valid duration configured.');
  }

  const windows = await getAvailability(provider, date);
  if (!windows.length) return []; // provider does not work this weekday

  // Pull active appointments for this provider around that calendar day
  // (a ±1 day window to be safe across the schedule time zone / UTC boundary).
  const dayStartISO = combineDateAndTime(date, '00:00');
  const dayEnd = new Date(new Date(dayStartISO).getTime() + 24 * 60 * 60 * 1000);
  const fromISO = new Date(dayStartISO.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const toISO = new Date(dayEnd.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: appts, error } = await supabaseAdmin
    .from('appointments')
    .select('start_time, end_time, status')
    .eq('provider_id', provider)
    .gte('start_time', fromISO)
    .lte('start_time', toISO)
    .neq('status', 'cancelled'); // cancelled appointments don't block (proposal 10)
  if (error) throw httpError(500, 'Failed to load appointments.', error.message);

  const active = appts || [];

  const nowMs = Date.now();
  const slots = [];

  for (const w of windows) {
    if (w.start == null || w.end == null || w.end <= w.start) continue;
    // Generate back-to-back candidate slots stepping by the service duration.
    for (let s = w.start; s + duration <= w.end; s += duration) {
      const e = s + duration;

      // Exclude slots that overlap a break period (half-open intervals).
      if (w.breaks.some((b) => overlaps(s, e, b.start, b.end))) continue;

      const startISO = combineDateAndTime(date, minutesToHHMM(s));
      const endISO = combineDateAndTime(date, minutesToHHMM(e));
      if (!startISO || !endISO) continue;

      // No booking in the past.
      if (new Date(startISO).getTime() <= nowMs) continue;

      // Exclude slots that overlap an existing active appointment.
      const clash = active.some((a) =>
        overlaps(startISO, endISO, a.start_time, a.end_time)
      );
      if (clash) continue;

      slots.push({
        start: startISO,
        end: endISO,
        start_time: minutesToHHMM(s),
        end_time: minutesToHHMM(e),
        service_id: service.id,
        provider_id: provider,
      });
    }
  }

  // Sort chronologically for a tidy UI.
  slots.sort((a, b) => new Date(a.start) - new Date(b.start));
  return slots;
}

// Create a booking. The atomic conflict check + insert happens in Postgres
// via the book_appointment RPC (see supabase/migrations). This server-side
// re-check is the authoritative guard against double-booking.
export async function createBooking({ customerId, serviceId, providerId, startISO, customerNote }) {
  ensureSupabase();
  if (!customerId) throw httpError(401, 'You must be signed in to book.');
  if (!serviceId) throw httpError(400, 'A service is required.');
  if (!startISO) throw httpError(400, 'A start time is required.');

  const service = await getService(serviceId);
  const provider = providerId;
  if (!provider) throw httpError(400, 'This service has no provider assigned.');

  if (isInPast(startISO)) {
    throw httpError(400, 'You cannot book an appointment in the past.');
  }

  // Wall-clock weekday + start/end times in the schedule time zone, so the
  // RPC's working-hours check is correct independent of the DB session tz.
  const startParts = zonedParts(startISO);
  const endISO = new Date(
    new Date(startISO).getTime() + service.duration_minutes * 60000
  ).toISOString();
  const endParts = zonedParts(endISO);

  const { data, error } = await supabaseAdmin.rpc('book_appointment', {
    p_customer: customerId,
    p_service: serviceId,
    p_provider: provider,
    p_start: startISO,
    p_duration_min: service.duration_minutes,
    p_customer_note: customerNote || null,
    p_weekday: startParts.weekday,
    p_start_hhmm: startParts.hhmm,
    p_end_hhmm: endParts.hhmm,
  });

  if (error) {
    // The RPC raises custom codes we map to friendly messages.
    if (error.code === 'P2002' || /slot_taken|overlap/i.test(error.message)) {
      throw httpError(409, 'That time slot was just taken. Please choose another.');
    }
    if (/outside_working_hours|not_available/i.test(error.message)) {
      throw httpError(400, 'The selected time is outside the provider working hours.');
    }
    if (/in_the_past|past/i.test(error.message)) {
      throw httpError(400, 'You cannot book an appointment in the past.');
    }
    throw httpError(500, 'Booking could not be completed.', error.message);
  }
  return data;
}

// Validate a requested reschedule target against availability before calling
// the same atomic book path. Returns the candidate slot's end ISO.
export async function validateRescheduleTarget({ serviceId, providerId, startISO }) {
  ensureSupabase();
  const service = await getService(serviceId);
  const provider = providerId;
  if (!provider) throw httpError(400, 'A provider is required to reschedule.');
  if (isInPast(startISO)) {
    throw httpError(400, 'You cannot reschedule to a past time.');
  }
  return {
    providerId: provider,
    duration: service.duration_minutes,
    endISO: new Date(new Date(startISO).getTime() + service.duration_minutes * 60000).toISOString(),
  };
}
