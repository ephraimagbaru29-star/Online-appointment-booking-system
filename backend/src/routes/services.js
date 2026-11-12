import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler, ok, httpError } from '../utils/http.js';

const router = Router();

// Sanitise + validate a service payload.
function cleanService(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : null;
  const duration = Number(body?.duration_minutes);
  const active = body?.active === undefined ? true : Boolean(body.active);
  if (!name) throw httpError(400, 'Service name is required.');
  if (name.length > 120) throw httpError(400, 'Service name is too long.');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) {
    throw httpError(400, 'duration_minutes must be a positive number (max 600).');
  }
  return { name, description, duration_minutes: Math.round(duration), active };
}

// GET /api/services — active services for customers. Staff may pass ?all=true
// to include inactive ones.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const staff = req.profile.role === 'staff';
  const showAll = staff && req.query.all === 'true';
  let query = supabaseAdmin
    .from('services')
    .select('id, name, description, duration_minutes, active, created_at')
    .order('name', { ascending: true });
  if (!showAll) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw httpError(500, 'Failed to load services.', error.message);
  ok(res, { services: data || [] });
}));

// GET /api/services/:id
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('services')
    .select('id, name, description, duration_minutes, active, created_at')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to load service.', error.message);
  if (!data) throw httpError(404, 'Service not found.');
  // Non-staff cannot view inactive services.
  if (!data.active && req.profile.role !== 'staff') {
    throw httpError(404, 'Service not found.');
  }
  ok(res, { service: data });
}));

// POST /api/services — staff only
router.post('/', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const payload = cleanService(req.body);
  const { data, error } = await supabaseAdmin
    .from('services')
    .insert(payload)
    .select('id, name, description, duration_minutes, active, created_at')
    .single();
  if (error) throw httpError(500, 'Failed to create service.', error.message);
  ok(res, { service: data }, 201);
}));

// PUT /api/services/:id — staff only (full update)
router.put('/:id', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const payload = cleanService(req.body);
  const { data, error } = await supabaseAdmin
    .from('services')
    .update(payload)
    .eq('id', req.params.id)
    .select('id, name, description, duration_minutes, active, created_at')
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to update service.', error.message);
  if (!data) throw httpError(404, 'Service not found.');
  ok(res, { service: data });
}));

// PATCH /api/services/:id/active — staff toggle active flag
router.patch('/:id/active', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const active = Boolean(req.body?.active);
  const { data, error } = await supabaseAdmin
    .from('services')
    .update({ active })
    .eq('id', req.params.id)
    .select('id, name, active')
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to update service.', error.message);
  if (!data) throw httpError(404, 'Service not found.');
  ok(res, { service: data });
}));

// DELETE /api/services/:id — staff only. Soft delete (deactivate) so existing
// appointments keep a valid service reference. Hard delete is avoided to
// protect booking history (proposal: maintain a clear schedule history).
router.delete('/:id', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('services')
    .update({ active: false })
    .eq('id', req.params.id);
  if (error) throw httpError(500, 'Failed to deactivate service.', error.message);
  ok(res, { deactivated: true });
}));

export default router;
