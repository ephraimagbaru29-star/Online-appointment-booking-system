import { Router } from 'express';
import { supabaseAuth, supabaseAdmin, ensureSupabase } from '../config/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, ok, httpError, isValidEmail } from '../utils/http.js';

const router = Router();

const MIN_PASSWORD = 6;

function cleanCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const full_name = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  if (!isValidEmail(email)) throw httpError(400, 'A valid email is required.');
  if (!password || password.length < MIN_PASSWORD) {
    throw httpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
  }
  return { email, password, full_name };
}

// POST /api/auth/signup — creates a confirmed user (server-side, via the
// service role) and returns a session token. The handle_new_user trigger
// creates the customer profile automatically.
router.post('/signup', asyncHandler(async (req, res) => {
  ensureSupabase();
  const { email, password, full_name } = cleanCredentials(req.body);

  // Create the user (email confirmed) server-side.
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createErr) {
    if (/already|exists/i.test(createErr.message)) {
      throw httpError(409, 'An account with that email already exists.');
    }
    throw httpError(400, createErr.message);
  }

  // Sign them in to obtain a JWT to return to the client.
  const { data: session, error: signInErr } = await supabaseAuth.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !session?.session) {
    // Account was created; return success and ask the user to sign in.
    return ok(res, { created: true, message: 'Account created. Please sign in.' }, 201);
  }

  const profile = await loadProfile(created.user.id);
  ok(res, {
    access_token: session.session.access_token,
    user: { id: created.user.id, email },
    profile,
  }, 201);
}));

// POST /api/auth/signin
router.post('/signin', asyncHandler(async (req, res) => {
  ensureSupabase();
  const { email, password } = cleanCredentials(req.body);
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    throw httpError(401, 'Invalid email or password.');
  }
  const profile = await loadProfile(data.user.id);
  ok(res, {
    access_token: data.session.access_token,
    user: { id: data.user.id, email: data.user.email },
    profile,
  });
}));

// POST /api/auth/signout — stateless: the client discards its token. We return
// ok; JWTs are short-lived and the client clears its stored copy.
router.post('/signout', asyncHandler(async (_req, res) => {
  ok(res, { signedOut: true });
}));

// GET /api/auth/me — current user's profile (requires auth).
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  ok(res, { user: req.user, profile: req.profile });
}));

// Helper: fetch a profile row; tolerates the (unlikely) race where the trigger
// has not yet created it by inserting a fallback.
async function loadProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw httpError(500, 'Failed to load profile.', error.message);
  if (!data) {
    // Fallback insert in case the trigger lagged (idempotent).
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('profiles')
      .insert({ id: userId, email: '', full_name: '', role: 'customer' })
      .select('id, email, full_name, role, created_at')
      .maybeSingle();
    if (insErr) throw httpError(500, 'Failed to create profile.', insErr.message);
    return inserted;
  }
  return data;
}

export default router;
