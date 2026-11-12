// Small HTTP helpers for consistent API responses and async route wrapping.

import { parseHHMM } from './time.js';

// Wraps an async route handler so rejected promises are forwarded to the
// error middleware instead of crashing the process.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Send a JSON success payload.
export function ok(res, payload = {}, status = 200) {
  res.status(status).json({ success: true, ...payload });
}

// Build a structured error and attach an HTTP status.
export function httpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

// Validate an email shape (basic, RFC-ish). Not exhaustive — Supabase Auth
// also validates at signup — but used for pre-flight server validation
// (proposal: "Validate ... contact details on the server").
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

// Validate a YYYY-MM-DD date string and that it is a real calendar date.
export function isValidDate(value) {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (
    d.getFullYear() === Number(m[1]) &&
    d.getMonth() === Number(m[2]) - 1 &&
    d.getDate() === Number(m[3])
  );
}

// Validate "HH:MM" 24h time string.
export function isValidHHMM(value) {
  return parseHHMM(value) != null;
}
