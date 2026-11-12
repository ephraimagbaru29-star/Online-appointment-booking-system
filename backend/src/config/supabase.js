import { createClient } from '@supabase/supabase-js';
import { config, supabaseConfigured } from './env.js';

// Service-role client: bypasses RLS. Used by the backend for privileged
// operations (staff managing services/availability, booking conflict checks
// via RPC, promoting staff). Kept server-side only — never exposed to the
// frontend.
export const supabaseAdmin = supabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Anon client: respects RLS. Used to verify user JWTs through Supabase Auth
// (supabase.auth.getUser(token)) without handling secrets ourselves.
export const supabaseAuth = supabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export function ensureSupabase() {
  // Guard for routes that require a live Supabase connection.
  if (!supabaseAdmin || !supabaseAuth) {
    const err = new Error(
      'Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.'
    );
    err.status = 503;
    throw err;
  }
}
