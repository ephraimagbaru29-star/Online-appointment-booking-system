// Authentication helpers + route guards for protected pages.
import { api, setSession, getToken, getProfile, clearSession, loadConfig } from './api.js';
import { toast, redirect, renderNav } from './ui.js';

// Sign up a new customer account.
export async function signup({ full_name, email, password }) {
  const data = await api.post('/auth/signup', { full_name, email, password });
  if (data.access_token) {
    setSession({ access_token: data.access_token, profile: data.profile });
    return data;
  }
  // Account created but no session returned.
  return data;
}

// Sign in and store the session.
export async function signin({ email, password }) {
  const data = await api.post('/auth/signin', { email, password });
  setSession({ access_token: data.access_token, profile: data.profile });
  return data;
}

// Route to the right dashboard based on role.
export function routeByRole(profile) {
  if (profile?.role === 'staff') redirect('/staff/dashboard.html');
  else redirect('/customer/dashboard.html');
}

// Guard: require a signed-in user; optionally require staff. Redirects to "/"
// (login) when unauthenticated or to the customer dashboard when a customer
// hits a staff page. Returns the profile on success.
export async function guard({ staff = false } = {}) {
  await loadConfig();
  const token = getToken();
  const profile = getProfile();
  if (!token || !profile) {
    redirect('/');
    return null;
  }
  if (staff && profile.role !== 'staff') {
    redirect('/customer/dashboard.html');
    return null;
  }
  // Verify the session is still valid by hitting /auth/me. If 401, the api
  // layer clears the session and redirects to "/" automatically.
  try {
    const me = await api.get('/auth/me');
    if (me?.profile) {
      localStorage.setItem('abs_profile', JSON.stringify(me.profile));
      return me.profile;
    }
  } catch (e) {
    if (e.status === 401) { redirect('/'); return null; }
    // Non-auth error (e.g. backend down): proceed with cached profile.
  }
  return profile;
}

// Initialise a protected page: run the guard, render the nav, return profile.
export async function initPage({ staff = false, activePath }) {
  const profile = await guard({ staff });
  if (!profile) return null;
  renderNav(profile, activePath);
  return profile;
}
