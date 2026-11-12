// Shared UI helpers used across all pages.

// The API base URL. Empty string means same-origin (the default single-host
// deployment where Express serves the frontend). When hosting the frontend
// separately, set window.API_BASE before api.js loads.
export const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';

// Read the configured schedule time zone (default UTC; updated from the
// backend health/config endpoint on startup).
export let scheduleTimezone = 'UTC';
export function setScheduleTimezone(tz) { scheduleTimezone = tz || scheduleTimezone; }

// ---- Toast notifications ----
let toastEl = null;
export function toast(message, type = '') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toastEl.className = 'toast';
  }, 3200);
}

// ---- HTML escaping ----
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Date / time formatting in the schedule time zone ----
function fmt(iso, options) {
  return new Intl.DateTimeFormat(undefined, { timeZone: scheduleTimezone, ...options }).format(new Date(iso));
}

export function formatDate(iso) {
  return fmt(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
export function formatDateShort(iso) {
  return fmt(iso, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function formatTime(iso) {
  return fmt(iso, { hour: 'numeric', minute: '2-digit' });
}
export function formatDateTime(iso) {
  return `${formatDateShort(iso)} · ${formatTime(iso)}`;
}

// Format an ISO slot into the schedule tz "HH:MM" for reschedule/booking UI.
export function toLocalInput(iso) {
  // <input type="datetime-local"> expects "YYYY-MM-DDTHH:MM" in the *user's
  // browser* local time, not the schedule tz. We let the browser handle that.
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Status badges ----
export function statusBadge(status) {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

// ---- Loading / empty states ----
export function loadingRow(cols = 5) {
  return `<tr><td colspan="${cols}" class="muted">Loading…</td></tr>`;
}
export function emptyRow(message, cols = 5) {
  return `<tr><td colspan="${cols}" class="muted">${escapeHtml(message)}</td></tr>`;
}

// ---- Redirect helper ----
export function redirect(path) {
  window.location.href = path;
}

// ---- Render the top navigation bar for a signed-in user ----
export function renderNav(profile, activePath) {
  const isStaff = profile?.role === 'staff';
  const links = isStaff
    ? [
        { href: '/staff/dashboard.html', label: 'Appointments' },
        { href: '/staff/services.html', label: 'Services' },
        { href: '/staff/availability.html', label: 'Availability' },
      ]
    : [
        { href: '/customer/dashboard.html', label: 'My Appointments' },
        { href: '/customer/book.html', label: 'Book Appointment' },
      ];

  const navHtml = links
    .map((l) => `<a href="${l.href}" class="${l.href === activePath ? 'active' : ''}">${l.label}</a>`)
    .join('');

  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  topbar.innerHTML = `
    <div class="topbar">
      <div class="container row">
        <a href="${isStaff ? '/staff/dashboard.html' : '/customer/dashboard.html'}" class="brand">
          <span class="dot"></span> Appointment Booking
        </a>
        <nav class="nav">
          ${navHtml}
          <span class="user">${escapeHtml(profile?.full_name || profile?.email || '')} · ${escapeHtml(profile?.role)}</span>
          <button class="btn-link" id="signoutBtn">Sign out</button>
        </nav>
      </div>
    </div>`;
  document.getElementById('signoutBtn').addEventListener('click', signOutClick);
}

async function signOutClick() {
  try {
    const m = await import('./api.js');
    await m.api.post('/auth/signout', {}).catch(() => {});
    m.clearSession();
  } catch { /* ignore */ }
  redirect('/');
}
