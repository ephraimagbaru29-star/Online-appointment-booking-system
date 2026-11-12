import { initPage } from './auth.js';
import { api } from './api.js';
import {
  toast, formatDateTime, escapeHtml, statusBadge,
  loadingRow, emptyRow, toLocalInput,
} from './ui.js';

const profile = await initPage({ staff: true, activePath: '/staff/dashboard.html' });
if (profile) run();

let rescheduleTarget = null;

async function run() {
  const body = document.getElementById('apptBody');
  const fDate = document.getElementById('fDate');
  const fService = document.getElementById('fService');
  const fStatus = document.getElementById('fStatus');
  const alertEl = document.getElementById('alert');

  // Load services for the filter dropdown.
  try {
    const { services } = await api.get('/services?all=true');
    fService.innerHTML =
      '<option value="">All services</option>' +
      services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  } catch { /* ignore */ }

  document.getElementById('applyBtn').addEventListener('click', load);
  document.getElementById('clearBtn').addEventListener('click', () => {
    fDate.value = ''; fService.value = ''; fStatus.value = '';
    load();
  });
  fStatus.addEventListener('change', load);

  // Reschedule modal wiring.
  const modal = document.getElementById('rescheduleModal');
  document.getElementById('rescheduleCancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('rescheduleConfirm').addEventListener('click', confirmReschedule);

  body.innerHTML = loadingRow(7);
  load();

  function alert(message, type = 'error') {
    alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  }

  async function load() {
    const params = new URLSearchParams();
    if (fDate.value) params.set('date', fDate.value);
    if (fService.value) params.set('service_id', fService.value);
    if (fStatus.value) params.set('status', fStatus.value);
    body.innerHTML = loadingRow(7);
    try {
      const { appointments } = await api.get(`/appointments${params.size ? `?${params}` : ''}`);
      render(appointments || []);
    } catch (err) {
      body.innerHTML = emptyRow(err.message || 'Failed to load.', 7);
    }
  }

  function render(list) {
    const sorted = [...list].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    if (!sorted.length) {
      body.innerHTML = emptyRow('No appointments match these filters.', 7);
      return;
    }
    body.innerHTML = sorted
      .map(
        (a) => `
      <tr data-id="${a.id}">
        <td><code>${escapeHtml(a.reference_number || '')}</code></td>
        <td>${escapeHtml(a.customer?.full_name || a.customer?.email || 'Customer')}</td>
        <td>${escapeHtml(a.services?.name || '—')}</td>
        <td>${formatDateTime(a.start_time)}</td>
        <td>${statusBadge(a.status)}</td>
        <td>${escapeHtml(a.customer_note || '')}</td>
        <td class="actions"></td>
      </tr>`
      )
      .join('');
    sorted.forEach((a) => addActions(a));
  }

  function addActions(a) {
    const row = body.querySelector(`tr[data-id="${a.id}"]`);
    if (!row) return;
    const cell = row.lastElementChild;

    const mk = (label, cls, handler, disabled = false) => {
      const b = document.createElement('button');
      b.className = `btn ${cls} sm`;
      b.textContent = label;
      b.disabled = disabled;
      b.addEventListener('click', handler);
      cell.appendChild(b);
    };

    // Status transitions (proposal section 7 & 12).
    if (a.status === 'pending') {
      mk('Confirm', 'secondary', () => setStatus(a, 'confirmed'));
      mk('Cancel', 'danger', () => cancel(a));
      mk('Reschedule', 'ghost', () => openReschedule(a));
    } else if (a.status === 'confirmed') {
      mk('Complete', 'secondary', () => setStatus(a, 'completed'));
      mk('Cancel', 'danger', () => cancel(a));
      mk('Reschedule', 'ghost', () => openReschedule(a));
    } else if (a.status === 'completed') {
      // Completed appointments cannot be cancelled (proposal 12).
    } else if (a.status === 'cancelled') {
      // Nothing further; cancelled slots no longer block availability.
    }
  }

  async function setStatus(a, status) {
    try {
      await api.patch(`/appointments/${a.id}/status`, { status });
      toast(`Marked ${status}`, 'success');
      load();
    } catch (err) {
      toast(err.message || 'Failed to update.', 'error');
    }
  }

  async function cancel(a) {
    if (!confirm(`Cancel ${a.reference_number}? The slot will become available again.`)) return;
    try {
      await api.post(`/appointments/${a.id}/cancel`, {});
      toast('Appointment cancelled', 'success');
      load();
    } catch (err) {
      toast(err.message || 'Failed to cancel.', 'error');
    }
  }

  function openReschedule(a) {
    rescheduleTarget = a;
    const newStart = document.getElementById('newStart');
    newStart.value = toLocalInput(a.start_time);
    document.getElementById('rescheduleSummary').textContent =
      `${a.services?.name || 'Appointment'} · ${formatDateTime(a.start_time)}`;
    modal.classList.remove('hidden');
  }

  async function confirmReschedule() {
    if (!rescheduleTarget) return;
    const val = document.getElementById('newStart').value;
    if (!val) { toast('Choose a new start time.', 'error'); return; }
    const iso = new Date(val).toISOString();
    try {
      await api.post(`/appointments/${rescheduleTarget.id}/reschedule`, { start: iso });
      toast('Rescheduled — status set to Pending', 'success');
      modal.classList.add('hidden');
      load();
    } catch (err) {
      toast(err.message || 'Reschedule failed.', 'error');
    }
  }
}
