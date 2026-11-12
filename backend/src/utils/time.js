// Time helpers. All slot math is done in the single configured schedule
// time zone (proposal: "Use one clearly defined time zone for the provider's
// schedule and display it to customers").

import { config } from '../config/env.js';

export const tz = config.scheduleTimezone;

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Map a JS Date's local weekday to the DB weekday convention.
// availability.weekday stores the name (e.g. "Monday") for readability.
export function weekdayNameFor(date) {
  return WEEKDAYS[date.getDay()];
}

// "HH:MM" string -> minutes since midnight. Returns null if malformed.
export function parseHHMM(value) {
  if (typeof value !== 'string') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToHHMM(total) {
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Combine a YYYY-MM-DD date with an "HH:MM" time into a UTC ISO string,
// interpreting the wall-clock time in the configured schedule time zone.
// Node's Intl support lets us build a tz-aware timestamp without a DB round
// trip; we format as a UTC ISO string so Supabase stores it consistently.
export function combineDateAndTime(dateStr, hhmm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const hh = parseHHMM(hhmm);
  if (hh == null) return null;
  // Create the wall-clock instant as if it were local to the schedule tz, then
  // convert to UTC. We use formatToParts to find the actual UTC offset for
  // that date (handles DST) rather than hard-coding an offset.
  const wall = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(wall).map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  // wall was the tz-local midnight; the offset = wall - asUTC.
  const offsetMs = wall.getTime() - asUTC;
  // The desired instant in tz-local time:
  const desired = new Date(
    Date.UTC(y, m - 1, d, Math.floor(hh / 60), hh % 60, 0)
  );
  return new Date(desired.getTime() - offsetMs).toISOString();
}

// Overlap test for half-open intervals [s1,e1) and [s2,e2).
export function overlaps(s1, e1, s2, e2) {
  return new Date(s1) < new Date(e2) && new Date(s2) < new Date(e1);
}

// Is the given ISO timestamp in the past relative to now?
export function isInPast(iso) {
  return new Date(iso).getTime() < Date.now();
}

// Given an ISO timestamp, return the weekday name and "HH:MM" wall-clock time
// in the configured schedule time zone. Used so the booking RPC's working-hours
// check is correct regardless of the database session time zone.
export function zonedParts(iso) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(iso))) parts[p.type] = p.value;
  let hh = parts.hour;
  if (hh === '24') hh = '00'; // some runtimes emit 24 at midnight
  return { weekday: parts.weekday, hhmm: `${hh}:${parts.minute}` };
}

