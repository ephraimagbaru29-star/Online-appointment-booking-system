import { initPage } from './auth.js';
import { api } from './api.js';
import { toast, escapeHtml, loadingRow, emptyRow } from './ui.js';

const profile = await initPage({ staff: true, activePath: '/staff/services.html' });
if (profile) run();

// ---- Duration helpers ----

// Convert total decimal minutes → { hours, minutes, seconds }.
function minutesToParts(totalMinutes) {
  const totalSeconds = Math.round(totalMinutes * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { hours: h, minutes: m, seconds: s };
}

// Convert { hours, minutes, seconds } → total decimal minutes.
function partsToMinutes(h, m, s) {
  return h * 60 + m + s / 60;
}

// Human-readable label for a decimal minutes value, e.g. "1 hr 30 min 30 sec".
function durationLabel(totalMinutes) {
  const { hours, minutes, seconds } = minutesToParts(totalMinutes);
  const parts = [];
  if (hours)   parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds) parts.push(`${seconds} sec`);
  return parts.length ? parts.join(' ') : '0 min';
}

// Populate the three <select> elements with valid options.
function buildPickers() {
  const hoursSel   = document.getElementById('svcHours');
  const minutesSel = document.getElementById('svcMinutes');
  const secondsSel = document.getElementById('svcSeconds');

  // Hours 0–23
  for (let h = 0; h <= 23; h++) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = String(h).padStart(2, '0');
    hoursSel.appendChild(o);
  }

  // Minutes 0–59
  for (let m = 0; m <= 59; m++) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = String(m).padStart(2, '0');
    minutesSel.appendChild(o);
  }

  // Seconds: 0, 15, 30, 45 (quarter-minute increments)
  for (const s of [0, 15, 30, 45]) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = String(s).padStart(2, '0');
    secondsSel.appendChild(o);
  }

  // Default: 0 hours, 30 minutes, 0 seconds
  minutesSel.value = 30;
  updatePreview();

  hoursSel.addEventListener('change', updatePreview);
  minutesSel.addEventListener('change', updatePreview);
  secondsSel.addEventListener('change', updatePreview);
}

function updatePreview() {
  const total = getPickerMinutes();
  const preview = document.getElementById('durationPreview');
  if (total <= 0) {
    preview.textContent = 'Please set a duration greater than 0.';
    preview.style.color = 'var(--danger)';
  } else {
    preview.textContent = `Appointment duration: ${durationLabel(total)}`;
    preview.style.color = 'var(--muted)';
  }
}

function getPickerMinutes() {
  const h = Number(document.getElementById('svcHours').value)   || 0;
  const m = Number(document.getElementById('svcMinutes').value) || 0;
  const s = Number(document.getElementById('svcSeconds').value) || 0;
  return partsToMinutes(h, m, s);
}

// Set all three selects from a decimal minutes value (used when editing).
function setPickerMinutes(totalMinutes) {
  const { hours, minutes, seconds } = minutesToParts(totalMinutes);
  document.getElementById('svcHours').value   = hours;
  document.getElementById('svcMinutes').value = minutes;
  // Snap seconds to nearest quarter (0/15/30/45).
  const snapped = Math.round(seconds / 15) * 15 % 60;
  document.getElementById('svcSeconds').value = snapped;
  updatePreview();
}

// ---- Main ----
async function run() {
  const form    = document.getElementById('serviceForm');
  const body    = document.getElementById('svcBody');
  const alertEl = document.getElementById('alert');
  const resetBtn = document.getElementById('resetBtn');

  let services = [];

  buildPickers();

  function showAlert(message, type = 'error') {
    alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  }

  function resetForm() {
    document.getElementById('svcId').value = '';
    document.getElementById('svcName').value = '';
    document.getElementById('svcDescription').value = '';
    document.getElementById('svcActive').checked = true;
    document.getElementById('svcHours').value   = 0;
    document.getElementById('svcMinutes').value = 30;
    document.getElementById('svcSeconds').value = 0;
    document.getElementById('formTitle').textContent = 'Add a service';
    document.getElementById('saveBtn').textContent   = 'Save service';
    updatePreview();
  }

  async function load() {
    body.innerHTML = loadingRow(4);
    try {
      const data = await api.get('/services?all=true');
      services = data.services || [];
      render();
    } catch (err) {
      body.innerHTML = emptyRow(err.message || 'Failed to load.', 4);
    }
  }

  function render() {
    if (!services.length) {
      body.innerHTML = emptyRow('No services yet. Add one above.', 4);
      return;
    }
    body.innerHTML = services
      .map(
        (s) => `
      <tr data-id="${s.id}">
        <td>
          <strong>${escapeHtml(s.name)}</strong>
          <div class="muted" style="font-size:0.8rem">${escapeHtml(s.description || '')}</div>
        </td>
        <td>${durationLabel(s.duration_minutes)}</td>
        <td>${s.active
          ? '<span class="badge confirmed">Active</span>'
          : '<span class="badge cancelled">Inactive</span>'}</td>
        <td class="actions"></td>
      </tr>`
      )
      .join('');
    services.forEach((s) => addActions(s));
  }

  function addActions(s) {
    const row = body.querySelector(`tr[data-id="${s.id}"]`);
    if (!row) return;
    const cell = row.lastElementChild;

    const mk = (label, cls, handler) => {
      const b = document.createElement('button');
      b.className = `btn ${cls} sm`;
      b.textContent = label;
      b.addEventListener('click', handler);
      cell.appendChild(b);
    };

    mk('Edit', 'secondary', () => edit(s));
    mk(s.active ? 'Deactivate' : 'Activate', s.active ? 'ghost' : 'secondary', () => toggle(s));
    mk('Delete', 'danger', () => remove(s));
  }

  function edit(s) {
    document.getElementById('svcId').value          = s.id;
    document.getElementById('svcName').value        = s.name;
    document.getElementById('svcDescription').value = s.description || '';
    document.getElementById('svcActive').checked    = s.active;
    setPickerMinutes(s.duration_minutes);
    document.getElementById('formTitle').textContent = 'Edit service';
    document.getElementById('saveBtn').textContent   = 'Update service';
    form.scrollIntoView({ behavior: 'smooth' });
  }

  async function toggle(s) {
    try {
      await api.patch(`/services/${s.id}/active`, { active: !s.active });
      toast(s.active ? 'Deactivated' : 'Activated', 'success');
      load();
    } catch (err) {
      toast(err.message || 'Failed to update.', 'error');
    }
  }

  async function remove(s) {
    if (!confirm(`Delete "${s.name}"? It will be deactivated to preserve existing bookings.`)) return;
    try {
      await api.del(`/services/${s.id}`);
      toast('Service deactivated', 'success');
      load();
    } catch (err) {
      toast(err.message || 'Failed to delete.', 'error');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertEl.innerHTML = '';

    const id          = document.getElementById('svcId').value;
    const name        = document.getElementById('svcName').value.trim();
    const description = document.getElementById('svcDescription').value.trim() || null;
    const active      = document.getElementById('svcActive').checked;
    const duration    = getPickerMinutes();

    if (!name) return showAlert('Service name is required.');
    if (duration <= 0) return showAlert('Please set a duration greater than 0.');

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    try {
      if (id) {
        await api.put(`/services/${id}`, { name, description, duration_minutes: duration, active });
        toast('Service updated', 'success');
      } else {
        await api.post('/services', { name, description, duration_minutes: duration, active });
        toast('Service added', 'success');
      }
      resetForm();
      load();
    } catch (err) {
      showAlert(err.message || 'Failed to save.');
    } finally {
      btn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', resetForm);
  load();
}
