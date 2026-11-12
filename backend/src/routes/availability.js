import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler, ok, httpError, isValidHHMM } from '../utils/http.js';
import { WEEKDAYS } from '../utils/time.js';

const router = Router();

const VALID_WEEKDAYS = new Set(WEEKDAYS);

// Validate + normalise an availability window with optional breaks.
function cleanWindow(body, staffId) {
  const provider_id = body?.provider_id || staffId;
  const weekday = typeof body?.weekday === 'string' ? body.weekday.trim() : '';
  const start_time = typeof body?.start_time === 'string' ? body.start_time.trim() : '';
  const end_time = typeof body?.end_time === 'string' ? body.end_time.trim() : '';

  if (!provider_id) throw httpError(400, 'provider_id is required.');
  if (!VALID_WEEKDAYS.has(weekday)) throw httpError(400, `weekday must be one of: ${WEEKDAYS.join(', ')}.`);
  if (!isValidHHMM(start_time)) throw httpError(400, 'start_time must be HH:MM (24h).');
  if (!isValidHHMM(end_time)) throw httpError(400, 'end_time must be HH:MM (24h).');
  if (start_time >= end_time) throw httpError(400, 'start_time must be earlier than end_time.');

  // breaks: [{ start, end }] in HH:MM. Optional.
  let breaks = [];
  if (Array.isArray(body?.breaks)) {
    breaks = body.breaks
      .map((b) => ({
        start: typeof b?.start === 'string' ? b.start.trim() : (b?.from || '').trim(),
        end: typeof b?.end === 'string' ? b.end.trim() : (b?.to || '').trim(),
      }))
      .filter((b) => isValidHHMM(b.start) && isValidHHMM(b.end) && b.start < b.end);
    // Breaks must fall within the working window.
    for (const b of breaks) {
      if (b.start < start_time || b.end > end_time) {
        throw httpError(400, 'Break periods must fall within working hours.');
      }
    }
  }

  return { provider_id, weekday, start_time, end_time, breaks };
}

// GET /api/availability?providerId=<staffId> — read a provider's working hours.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const providerId = req.query.providerId;
  // Staff can read their own (or any staff's) availability; customers may read
  // a chosen provider's so the UI can show working days.
  if (!providerId) throw httpError(400, 'providerId query param is required.');
  const { data, error } = await supabaseAdmin
    .from('availability')
    .select('id, provider_id, weekday, start_time, end_time, breaks')
    .eq('provider_id', providerId)
    .order('weekday', { ascending: true });
  if (error) throw httpError(500, 'Failed to load availability.', error.message);
  ok(res, { availability: data || [] });
}));

// GET /api/availability/providers — list staff who can be booked (for the
// customer booking flow "choose a provider"). Returns minimal profile info.
router.get('/providers', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'staff')
    .order('full_name', { ascending: true });
  if (error) throw httpError(500, 'Failed to load providers.', error.message);
  ok(res, { providers: data || [] });
}));

// POST /api/availability — staff create or upsert by (provider_id, weekday).
router.post('/', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const payload = cleanWindow(req.body, req.profile.id);

  // Upsert on the (provider_id, weekday) unique key.
  const { data: existing } = await supabaseAdmin
    .from('availability')
    .select('id')
    .eq('provider_id', payload.provider_id)
    .eq('weekday', payload.weekday)
    .maybeSingle();

  let data, error;
  if (existing) {
    ({ data, error } = await supabaseAdmin
      .from('availability')
      .update({
        start_time: payload.start_time,
        end_time: payload.end_time,
        breaks: payload.breaks,
      })
      .eq('id', existing.id)
      .select('id, provider_id, weekday, start_time, end_time, breaks')
      .single());
  } else {
    ({ data, error } = await supabaseAdmin
      .from('availability')
      .insert(payload)
      .select('id, provider_id, weekday, start_time, end_time, breaks')
      .single());
  }
  if (error) throw httpError(500, 'Failed to save availability.', error.message);
  ok(res, { availability: data }, existing ? 200 : 201);
}));

// DELETE /api/availability/:id — staff remove a working-day window.
router.delete('/:id', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('availability')
    .delete()
    .eq('id', req.params.id);
  if (error) throw httpError(500, 'Failed to delete availability.', error.message);
  ok(res, { deleted: true });
}));

export default router;
