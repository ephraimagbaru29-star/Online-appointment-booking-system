import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, ok, httpError } from '../utils/http.js';

const router = Router();

// GET /api/profile/me — the signed-in user's own profile.
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .eq('id', req.user.id)
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to load profile.', error.message);
  if (!data) throw httpError(404, 'Profile not found.');
  ok(res, { profile: data });
}));

// PATCH /api/profile/me — let a customer update their own contact details
// (full name only; role/email are managed elsewhere for safety).
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const full_name = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : null;
  if (!full_name) throw httpError(400, 'full_name is required.');
  if (full_name.length > 120) throw httpError(400, 'full_name is too long.');

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ full_name })
    .eq('id', req.user.id)
    .select('id, email, full_name, role, created_at')
    .single();
  if (error) throw httpError(500, 'Failed to update profile.', error.message);
  ok(res, { profile: data });
}));

export default router;
