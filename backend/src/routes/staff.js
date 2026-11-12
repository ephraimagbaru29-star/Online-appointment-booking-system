import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { asyncHandler, ok, httpError } from '../utils/http.js';

const router = Router();

// GET /api/staff — list staff accounts (proposal: "System administrator manages
// staff access"). Covers the small-deployment case where staff == provider.
router.get('/', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .eq('role', 'staff')
    .order('full_name', { ascending: true });
  if (error) throw httpError(500, 'Failed to load staff.', error.message);
  ok(res, { staff: data || [] });
}));

// POST /api/staff/promote — grant a user staff access.
// Accepts { user_id } or { email }.
router.post('/promote', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const { user_id, email } = req.body || {};
  if (!user_id && !email) throw httpError(400, 'Provide user_id or email.');

  let target = user_id;
  if (!target && email) {
    const { data: byEmail, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', String(email).trim())
      .maybeSingle();
    if (error) throw httpError(500, 'Failed to look up user.', error.message);
    if (!byEmail) throw httpError(404, 'No profile found for that email.');
    target = byEmail.id;
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ role: 'staff' })
    .eq('id', target)
    .select('id, email, full_name, role')
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to promote user.', error.message);
  if (!data) throw httpError(404, 'User not found.');
  ok(res, { profile: data });
}));

// POST /api/staff/demote — revoke staff access (back to customer).
// Prevents demoting yourself to avoid locking out the only admin.
router.post('/demote', requireAuth, requireStaff, asyncHandler(async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) throw httpError(400, 'user_id is required.');
  if (user_id === req.user.id) {
    throw httpError(400, 'You cannot revoke your own staff access.');
  }
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ role: 'customer' })
    .eq('id', user_id)
    .select('id, email, full_name, role')
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to demote user.', error.message);
  if (!data) throw httpError(404, 'User not found.');
  ok(res, { profile: data });
}));

export default router;
