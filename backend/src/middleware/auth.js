// Authentication & authorization middleware.
//
// Auth is delegated to Supabase Auth (proposal section 8). The frontend obtains
// a JWT on sign-in and sends it as `Authorization: Bearer <jwt>`. This middleware
// verifies the token with Supabase, loads the user's profile (role), and enforces
// role-based access (proposal section 11: "Customers can access only their own
// appointment records; staff access is role-restricted").

import { supabaseAuth, supabaseAdmin } from '../config/supabase.js';
import { ensureSupabase } from '../config/supabase.js';
import { httpError } from '../utils/http.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

// Verifies the bearer token, attaches req.user = { id, email } and
// req.profile = { id, role, full_name }. Returns 401 if missing/invalid.
export async function requireAuth(req, _res, next) {
  try {
    ensureSupabase();
    const token = extractToken(req);
    if (!token) throw httpError(401, 'Authentication required.');

    // Verify the token against Supabase Auth.
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) {
      throw httpError(401, 'Invalid or expired session.');
    }
    req.user = { id: data.user.id, email: data.user.email };

    // Load the profile row to get the role (customer | staff).
    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role, full_name, email')
      .eq('id', data.user.id)
      .maybeSingle();
    if (pErr) throw httpError(500, 'Failed to load user profile.');
    if (!profile) throw httpError(403, 'Profile not found. Please complete sign-up.');

    req.profile = profile;
    next();
  } catch (err) {
    next(err);
  }
}

// Optional auth: attaches user/profile if a valid token is present, but does
// not fail if absent (used for public service browsing where it may help).
export async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token || !supabaseAuth) return next();
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (!error && data?.user) {
      req.user = { id: data.user.id, email: data.user.email };
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, full_name, email')
        .eq('id', data.user.id)
        .maybeSingle();
      if (profile) req.profile = profile;
    }
  } catch {
    // ignore — treated as anonymous
  }
  next();
}

// Requires an authenticated staff member (covers the "system administrator /
// service provider" role in a small deployment).
export function requireStaff(req, _res, next) {
  if (!req.profile) return next(httpError(401, 'Authentication required.'));
  if (req.profile.role !== 'staff') {
    return next(httpError(403, 'Staff access required.'));
  }
  next();
}
