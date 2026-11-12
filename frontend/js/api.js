// API client: wraps fetch, attaches the bearer token, and parses the
// { success, ... } envelope the backend returns.
import { API_BASE, toast, redirect, setScheduleTimezone } from './ui.js';

const TOKEN_KEY = 'abs_token';
const PROFILE_KEY = 'abs_profile';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setSession({ access_token, profile }) {
  if (access_token) localStorage.setItem(TOKEN_KEY, access_token);
  if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
export function getProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Network error. Is the backend running?', 0, e);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }

  if (!res.ok || (data && data.success === false)) {
    const message = data?.error || `Request failed (${res.status})`;
    if (res.status === 401) {
      // Session expired / invalid — force re-auth.
      clearSession();
      if (!location.pathname.endsWith('/')) redirect('/');
    }
    throw new ApiError(message, res.status, data?.details);
  }
  return data;
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

// Convenience: fetch schedule tz once on load (best-effort).
export async function loadConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    if (data?.scheduleTimezone) setScheduleTimezone(data.scheduleTimezone);
  } catch { /* ignore */ }
}
