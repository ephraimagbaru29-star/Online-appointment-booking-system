import dotenv from 'dotenv';

dotenv.config();

// Centralised, validated environment configuration.
// Supabase project URL + keys are kept server-side (proposal section 8 & 11:
// "Keep secret keys server-side and use HTTPS in production").
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  // We do not hard-crash here so the server can still boot for health checks /
  // static file serving; routes that need Supabase will surface a clear error.
  console.warn(
    `[config] Missing environment variables: ${missing.join(', ')}. ` +
      'Supabase-backed routes will return 503 until configured. Copy .env.example to .env and fill in your Supabase project credentials.'
  );
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // Approved frontend origin for CORS (proposal: "CORS restricted to the
  // approved frontend origin"). Defaults to same-origin serving.
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:4000',
  // Single provider time zone for the schedule (proposal: "Use one clearly
  // defined time zone for the provider's schedule and display it to customers").
  scheduleTimezone: process.env.SCHEDULE_TIMEZONE || 'UTC',
};

export const supabaseConfigured = Boolean(
  config.supabaseUrl && config.supabaseServiceRoleKey && config.supabaseAnonKey
);
