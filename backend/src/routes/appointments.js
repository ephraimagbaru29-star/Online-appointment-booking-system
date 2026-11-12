import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler, ok, httpError, isValidDate } from '../utils/http.js';
import { createBooking } from '../services/bookingEngine.js';
import { zonedParts } from '../utils/time.js';

const router = Router();

const VALID_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

// Both customer and provider join the profiles table, so we alias each
// foreign-key relationship explicitly for Supabase/PostgREST.
const APPT_COLUMNS =
  'id, reference_number, customer_id, service_id, provider_id, start_time, end_time, status, customer_note, created_at, updated_at, ' +
  'services(name), ' +
  'customer:customer_id(full_name, email), ' +
  'provider:provider_id(full_name)';

// POST /api/appointments — customer creates a booking.
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { service_id, provider_id, start, customer_note } = req.body || {};
  if (typeof service_id !== 'string' || !service_id) throw httpError(400, 'service_id is required.');
  if (typeof provider_id !== 'string' || !provider_id) throw httpError(400, 'provider_id is required.');
  if (typeof start !== 'string' || !start) throw httpError(400, 'start time is required.');
  const note = typeof customer_note === 'string' ? customer_note.trim().slice(0, 500) : null;

  const appointment = await createBooking({
    customerId: req.user.id,
    serviceId: service_id,
    providerId: provider_id,
    startISO: start,
    customerNote: note,
  });
  ok(res, { appointment }, 201);
}));

// GET /api/appointments — customers see only their own (proposal 11/12);
// staff see all, with filters (proposal 6: "date, service and status filters").
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const isStaff = req.profile.role === 'staff';
  const { date, service_id, status, provider_id, from, to } = req.query;

  let query = supabaseAdmin.from('appointments').select(APPT_COLUMNS);

  if (!isStaff) {
    // Enforce "customers can access only their own appointment records".
    query = query.eq('customer_id', req.user.id);
  } else if (provider_id) {
    query = query.eq('provider_id', provider_id);
  }

  if (status) {
    if (!VALID_STATUSES.includes(status)) throw httpError(400, 'Invalid status filter.');
    query = query.eq('status', status);
  }
  if (service_id) query = query.eq('service_id', service_id);
  if (date && isValidDate(date)) {
    query = query.gte('start_time', `${date}T00:00:00Z`).lt('start_time', `${date}T23:59:59.999Z`);
  }
  if (from) query = query.gte('start_time', from);
  if (to) query = query.lte('start_time', to);

  query = query.order('start_time', { ascending: true });
  const { data, error } = await query;
  if (error) throw httpError(500, 'Failed to load appointments.', error.message);

  ok(res, { appointments: data || [] });
}));

// GET /api/appointments/:id
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select(APPT_COLUMNS)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to load appointment.', error.message);
  if (!data) throw httpError(404, 'Appointment not found.');
  if (req.profile.role !== 'staff' && data.customer_id !== req.user.id) {
    throw httpError(403, 'You can only view your own appointments.');
  }
  ok(res, { appointment: data });
}));

// POST /api/appointments/:id/cancel — customer (own) or staff cancels.
// A cancelled booking no longer blocks the slot (proposal 10/12).
router.post('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const { data: appt, error } = await supabaseAdmin
    .from('appointments')
    .select('id, customer_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to load appointment.', error.message);
  if (!appt) throw httpError(404, 'Appointment not found.');

  const isStaff = req.profile.role === 'staff';
  if (!isStaff && appt.customer_id !== req.user.id) {
    throw httpError(403, 'You can only cancel your own appointments.');
  }
  if (appt.status === 'cancelled') throw httpError(400, 'Appointment is already cancelled.');
  if (appt.status === 'completed') throw httpError(400, 'Completed appointments cannot be cancelled.');

  const { data, err } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', appt.id)
    .select('id, status')
    .single();
  if (err) throw httpError(500, 'Failed to cancel appointment.', err.message);
  ok(res, { appointment: data });
}));

// PATCH /api/appointments/:id/status — staff confirm/complete/cancel.
router.patch('/:id/status', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
  if (!VALID_STATUSES.includes(status)) {
    throw httpError(400, `status must be one of: ${VALID_STATUSES.join(', ')}.`);
  }
  const { data: appt, error } = await supabaseAdmin
    .from('appointments')
    .select('id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to load appointment.', error.message);
  if (!appt) throw httpError(404, 'Appointment not found.');

  const { data, err } = await supabaseAdmin
    .from('appointments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', appt.id)
    .select('id, status')
    .single();
  if (err) throw httpError(500, 'Failed to update status.', err.message);
  ok(res, { appointment: data });
}));

// POST /api/appointments/:id/reschedule — staff moves an appointment to a new
// start time. The atomic overlap check runs in Postgres (reschedule_appointment
// RPC) so the new slot can't double-book.
router.post('/:id/reschedule', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const start = typeof req.body?.start === 'string' ? req.body.start.trim() : '';
  if (!start) throw httpError(400, 'A new start time (start) is required.');

  // Load the appointment to compute its duration and validate state.
  const { data: appt, error: loadErr } = await supabaseAdmin
    .from('appointments')
    .select('id, status, start_time, end_time')
    .eq('id', req.params.id)
    .maybeSingle();
  if (loadErr) throw httpError(500, 'Failed to load appointment.', loadErr.message);
  if (!appt) throw httpError(404, 'Appointment not found.');
  if (appt.status === 'cancelled') throw httpError(400, 'Cannot reschedule a cancelled appointment.');

  const durationMin = Math.round((new Date(appt.end_time) - new Date(appt.start_time)) / 60000);
  const endISO = new Date(new Date(start).getTime() + durationMin * 60000).toISOString();
  const startParts = zonedParts(start);
  const endParts = zonedParts(endISO);

  const { data, error } = await supabaseAdmin.rpc('reschedule_appointment', {
    p_appointment_id: req.params.id,
    p_new_start: start,
    p_weekday: startParts.weekday,
    p_start_hhmm: startParts.hhmm,
    p_end_hhmm: endParts.hhmm,
  });
  if (error) {
    if (/slot_taken|overlap/i.test(error.message)) {
      throw httpError(409, 'The new time conflicts with another booking.');
    }
    if (/in_the_past|past/i.test(error.message)) {
      throw httpError(400, 'Cannot reschedule to a past time.');
    }
    if (/not_found/i.test(error.message)) {
      throw httpError(404, 'Appointment not found.');
    }
    throw httpError(500, 'Failed to reschedule appointment.', error.message);
  }
  ok(res, { appointment: data });
}));

export default router;
