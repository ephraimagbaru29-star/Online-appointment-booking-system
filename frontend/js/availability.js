import { initPage } from './auth.js';
import { api } from './api.js';
import { toast, escapeHtml } from './ui.js';

const profile = await initPage({ staff: true, activePath: '/staff/availability.html' });
if (profile) run(profile.id);

const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

async function run(providerId) {
  const wrap = document.getElementById('daysWrap');
  const alertEl = document.getElementById('alert');

  function alert(message, type = 'error') {
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

  wrap.innerHTML = WEEKDAYS.map((day) => {
    const a = byDay[day];
    const breaks = Array.isArray(a?.breaks) && a.breaks[0] ? a.breaks[0] : { start: '', end: '' };
    return `
      <div class="card" style="padding:16px" data-day="${day}" data-id="${a?.id || ''}">
        <div class="between">
          <strong>${day}</strong>
          <button class="btn ghost sm clear-day" type="button">Day off</button>
        </div>
        <div class="grid-2 mt-2">
          <div class="field">
            <label>Start</label>
            <input type="time" class="start" value="${a?.start_time || ''}" />
          </div>
          <div class="field">
            <label>End</label>
            <input type="time" class="end" value="${a?.end_time || ''}" />
          </div>
        </div>
        <div class="grid-2 mt-2">
          <div class="field">
            <label>Break start (optional)</label>
            <input type="time" class="break-start" value="${breaks.start || ''}" />
          </div>
          <div class="field">
            <label>Break end (optional)</label>
            <input type="time" class="break-end" value="${breaks.end || ''}" />
          </div>
        </div>
        <button class="btn sm mt-2 save-day">Save day</button>
        <span class="muted day-msg" style="font-size:0.8rem;margin-left:8px"></span>
      </div>`;
  }).join('');

  wrap.querySelectorAll('.card').forEach((card) => {
    card.querySelector('.save-day').addEventListener('click', () => saveDay(card, providerId));
    card.querySelector('.clear-day').addEventListener('click', () => clearDay(card, providerId));
  });

  async function saveDay(card, providerId) {
    const day = card.dataset.day;
    const start = card.querySelector('.start').value;
    const end = card.querySelector('.end').value;
    const bs = card.querySelector('.break-start').value;
    const be = card.querySelector('.break-end').value;
    const msg = card.querySelector('.day-msg');

    if (!start && !end) {
      return alert('Set start and end times, or mark the day off.');
    }
    if (!start || !end) return alert(`${day}: both start and end are required.`);
    if (start >= end) return alert(`${day}: start must be earlier than end.`);

    const breaks = [];
    if (bs && be) {
      if (bs >= be) return alert(`${day}: break start must be earlier than break end.`);
      breaks.push({ start: bs, end: be });
    }

    try {
      await api.post('/availability', {
        provider_id: providerId,
        weekday: day,
        start_time: start,
        end_time: end,
        breaks,
      });
      msg.textContent = 'Saved';
      toast(`${day} saved`, 'success');
    } catch (err) {
      msg.textContent = '';
      alert(err.message || `Failed to save ${day}.`);
    }
  }

  async function clearDay(card, providerId) {
    const day = card.dataset.day;
    const id = card.dataset.id;
    const msg = card.querySelector('.day-msg');
    if (!id) {
      // Nothing stored — just clear the inputs.
      card.querySelectorAll('input[type="time"]').forEach((i) => (i.value = ''));
      msg.textContent = 'Day off';
      return;
    }
    if (!confirm(`Remove working hours for ${day}?`)) return;
    try {
      await api.del(`/availability/${id}`);
      card.dataset.id = '';
      card.querySelectorAll('input[type="time"]').forEach((i) => (i.value = ''));
      msg.textContent = 'Day off';
      toast(`${day} set to day off`, 'success');
    } catch (err) {
      alert(err.message || `Failed to update ${day}.`);
    }
  }
}
