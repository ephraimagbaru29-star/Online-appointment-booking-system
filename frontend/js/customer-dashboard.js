import { initPage } from './auth.js';
import { api } from './api.js';
import {
  toast, formatDate, formatTime, escapeHtml, statusBadge,
  loadingRow, emptyRow, formatDateTime,
} from './ui.js';

const profile = await initPage({ activePath: '/customer/dashboard.html' });
if (profile) run();

async function run() {
  const upcomingBody = document.getElementById('upcomingBody');
  const pastBody = document.getElementById('pastBody');
  upcomingBody.innerHTML = loadingRow(6);
  pastBody.innerHTML = loadingRow(6);

  try {
    const { appointments } = await api.get('/appointments');
    const now = Date.now();
    const upcoming = appointments
      .filter((a) => a.status !== 'cancelled' && new Date(a.start_time).getTime() >= now - 60 * 60 * 1000)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const past = appointments
      .filter((a) => !(a.status !== 'cancelled' && new Date(a.start_time).getTime() >= now - 60 * 60 * 1000))
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

    renderUpcoming(upcoming);
    renderPast(past);
  } catch (err) {
    upcomingBody.innerHTML = emptyRow(err.message || 'Failed to load.', 6);
    pastBody.innerHTML = emptyRow('', 6);
  }

  function row(a) {
    const service = a.services?.name || '—';
    const provider = a.provider?.full_name || '—';
    return `
      <tr>
        <td><code>${escapeHtml(a.reference_number || '')}</code></td>
        <td>${escapeHtml(service)}</td>
        <td>${escapeHtml(provider)}</td>
        <td>${formatDateTime(a.start_time)}</td>
        <td>${statusBadge(a.status)}</td>
        <td class="actions"></td>
      </tr>`;
  }

  function renderUpcoming(list) {
    if (!list.length) {
      upcomingBody.innerHTML = emptyRow('No upcoming appointments. Click “Book new” to schedule one.', 6);
      return;
    }
    upcomingBody.innerHTML = list.map(row).join('');
    list.forEach((a, i) => {
      const cell = upcomingBody.children[i].lastElementChild;
      if (a.status === 'pending' || a.status === 'confirmed') {
        const btn = document.createElement('button');
        btn.className = 'btn danger sm';
        btn.textContent = 'Cancel';
        btn.addEventListener('click', () => cancel(a, btn));
        cell.appendChild(btn);
      }
    });
  }

  function renderPast(list) {
    if (!list.length) {
      pastBody.innerHTML = emptyRow('No history yet.', 6);
      return;
    }
    pastBody.innerHTML = list.map(row).join('');
  }

  async function cancel(a, btn) {
    if (!confirm(`Cancel appointment ${a.reference_number}?`)) return;
    btn.disabled = true;
    try {
      await api.post(`/appointments/${a.id}/cancel`, {});
      toast('Appointment cancelled', 'success');
      run();
    } catch (err) {
      toast(err.message || 'Could not cancel.', 'error');
      btn.disabled = false;
    }
  }
}
