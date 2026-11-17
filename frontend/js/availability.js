import { initPage } from './auth.js';
import { api } from './api.js';
import { toast, escapeHtml } from './ui.js';

const profile = await initPage({ staff: true, activePath: '/staff/availability.html' });
if (profile) run(profile.id);

const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ── AM/PM time picker helpers ────────────────────────────────────────────────

// Minutes shown in the picker — every 15 min is enough precision for slots.
const MINUTE_OPTIONS = ['00','15','30','45'];

// Build the HTML for one AM/PM picker, given a unique id prefix and an
// optional initial "HH:MM" 24h value.
function timepickerHTML(prefix, value24 = '') {
  const { h12, min, ampm } = parse24toAmPm(value24);

  // Hour options 1–12
  const hourOpts = Array.from({ length: 12 }, (_, i) => {
    const v = i + 1;
    return `<option value="${v}" ${v === h12 ? 'selected' : ''}>${String(v).padStart(2,'0')}</option>`;
  }).join('');

  // Minute options
  const minOpts = MINUTE_OPTIONS.map((m) =>
    `<option value="${m}" ${m === min ? 'selected' : ''}>${m}</option>`
  ).join('');

  return `
    <div class="time-picker" data-prefix="${prefix}">
      <select class="tp-hour" aria-label="Hour">${hourOpts}</select>
      <span class="sep">:</span>
      <select class="tp-min" aria-label="Minute">${minOpts}</select>
      <select class="tp-ampm ampm-sel" aria-label="AM or PM">
        <option value="AM" ${ampm === 'AM' ? 'selected' : ''}>AM</option>
        <option value="PM" ${ampm === 'PM' ? 'selected' : ''}>PM</option>
      </select>
    </div>`;
}

// Parse "HH:MM" 24h → { h12, min, ampm }
// Returns defaults (12 AM) if the value is empty/invalid.
function parse24toAmPm(value24 = '') {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value24 || '').trim());
  if (!m) return { h12: 12, min: '00', ampm: 'AM' };
  let h = Number(m[1]);
  const min = MINUTE_OPTIONS.includes(m[2]) ? m[2] : '00';
  const ampm = h < 12 ? 'AM' : 'PM';
  if (h === 0)  h = 12;       // midnight → 12 AM
  if (h > 12)   h = h - 12;   // 13–23  → 1–11 PM
  return { h12: h, min, ampm };
}

// Read a rendered time-picker back to "HH:MM" 24h.
function readPickerTo24(container) {
  const h12  = Number(container.querySelector('.tp-hour').value);
  const min  = container.querySelector('.tp-min').value;
  const ampm = container.querySelector('.tp-ampm').value;
  let h24 = h12;
  if (ampm === 'AM' && h12 === 12) h24 = 0;   // 12 AM → 00
  if (ampm === 'PM' && h12 !== 12) h24 = h12 + 12; // 1–11 PM → 13–23
  return `${String(h24).padStart(2,'0')}:${min}`;
}

// Is the picker set to any real value? (we check if the user has explicitly
// changed it from the placeholder — an unset picker starts at "12:00 AM")
// We treat the picker as "set" only when the card has been saved before
// (i.e. data-id is non-empty) OR when the user changes something.
// For simplicity the Save button is always available; the backend validates.

// Human-readable display of a 24h HH:MM, e.g. "09:00" → "9:00 AM"
function display24(hhmm) {
  const { h12, min, ampm } = parse24toAmPm(hhmm);
  return `${h12}:${min} ${ampm}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run(providerId) {
  const wrap    = document.getElementById('daysWrap');
  const alertEl = document.getElementById('alert');

  function showAlert(message, type = 'error') {
    alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  }

  let availability = [];
  try {
    const data = await api.get(`/availability?providerId=${encodeURIComponent(providerId)}`);
    availability = data.availability || [];
  } catch (err) {
    wrap.innerHTML = `<p class="muted">${escapeHtml(err.message || 'Failed to load availability.')}</p>`;
    return;
  }

  const byDay = Object.fromEntries(availability.map((a) => [a.weekday, a]));

  // Build all day cards
  wrap.innerHTML = WEEKDAYS.map((day) => {
    const a      = byDay[day];
    const breaks = Array.isArray(a?.breaks) && a.breaks[0] ? a.breaks[0] : null;
    const hasHours = Boolean(a?.start_time);

    return `
      <div class="day-card ${hasHours ? 'has-hours' : ''}"
           data-day="${day}" data-id="${a?.id || ''}">

        <div class="day-header">
          <span class="day-name">${day}</span>
          <button class="btn ghost sm clear-day" type="button">Day off</button>
        </div>

        <!-- Working hours -->
        <div class="time-row">
          <div>
            <div class="time-label">Start time</div>
            ${timepickerHTML(`${day}-start`, a?.start_time || '')}
          </div>
          <div>
            <div class="time-label">End time</div>
            ${timepickerHTML(`${day}-end`, a?.end_time || '')}
          </div>
        </div>

        <!-- Optional break -->
        <div class="break-section">
          <div class="break-label">Break / lunch (optional) — excluded from bookable slots</div>
          <div class="time-row">
            <div>
              <div class="time-label">Break start</div>
              ${timepickerHTML(`${day}-bstart`, breaks?.start || '')}
            </div>
            <div>
              <div class="time-label">Break end</div>
              ${timepickerHTML(`${day}-bend`, breaks?.end || '')}
            </div>
          </div>
        </div>

        <div class="day-footer">
          <button class="btn sm save-day" type="button">Save ${day}</button>
          <span class="day-msg"></span>
        </div>
      </div>`;
  }).join('');

  // Wire up buttons
  wrap.querySelectorAll('.day-card').forEach((card) => {
    card.querySelector('.save-day').addEventListener('click', () => saveDay(card, providerId));
    card.querySelector('.clear-day').addEventListener('click', () => clearDay(card, providerId));
  });

  // ── Save a day ────────────────────────────────────────────────────────────
  async function saveDay(card, providerId) {
    const day = card.dataset.day;
    const msg = card.querySelector('.day-msg');
    alertEl.innerHTML = '';

    // Read all four pickers
    const startPicker  = card.querySelectorAll('.time-picker')[0];
    const endPicker    = card.querySelectorAll('.time-picker')[1];
    const bStartPicker = card.querySelectorAll('.time-picker')[2];
    const bEndPicker   = card.querySelectorAll('.time-picker')[3];

    const start  = readPickerTo24(startPicker);
    const end    = readPickerTo24(endPicker);
    const bStart = readPickerTo24(bStartPicker);
    const bEnd   = readPickerTo24(bEndPicker);

    // Validate working hours
    if (start >= end) {
      return showAlert(`${day}: end time must be later than start time (${display24(start)} → ${display24(end)}).`);
    }

    // Build breaks array — only include if break start < break end and both
    // fall within working hours.
    const breaks = [];
    const breakSet = bStart !== '00:00' || bEnd !== '00:00';
    if (breakSet) {
      if (bStart >= bEnd) {
        return showAlert(`${day}: break end must be later than break start.`);
      }
      if (bStart < start || bEnd > end) {
        return showAlert(`${day}: break must fall within working hours (${display24(start)} – ${display24(end)}).`);
      }
      breaks.push({ start: bStart, end: bEnd });
    }

    msg.textContent = 'Saving…';
    try {
      await api.post('/availability', {
        provider_id: providerId,
        weekday:     day,
        start_time:  start,
        end_time:    end,
        breaks,
      });
      msg.textContent = `✓ Saved (${display24(start)} – ${display24(end)})`;
      card.classList.add('has-hours');
      card.dataset.id = card.dataset.id || '__saved__'; // mark as saved
      toast(`${day} saved`, 'success');
    } catch (err) {
      msg.textContent = '';
      showAlert(err.message || `Failed to save ${day}.`);
    }
  }

  // ── Clear a day ───────────────────────────────────────────────────────────
  async function clearDay(card, providerId) {
    const day = card.dataset.day;
    const id  = card.dataset.id;
    const msg = card.querySelector('.day-msg');

    if (!id) {
      // Nothing stored yet — just show feedback
      msg.textContent = 'Day off';
      card.classList.remove('has-hours');
      return;
    }

    if (!confirm(`Remove working hours for ${day}? This will make the day unavailable for bookings.`)) return;

    try {
      await api.del(`/availability/${id}`);
      card.dataset.id = '';
      card.classList.remove('has-hours');
      msg.textContent = 'Day off';
      toast(`${day} set to day off`, 'success');
    } catch (err) {
      showAlert(err.message || `Failed to update ${day}.`);
    }
  }
}
