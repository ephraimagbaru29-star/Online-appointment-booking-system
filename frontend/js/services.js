import { initPage } from './auth.js';
import { api } from './api.js';
import { toast, escapeHtml, loadingRow, emptyRow } from './ui.js';

const profile = await initPage({ staff: true, activePath: '/staff/services.html' });
if (profile) run();

async function run() {
  const form = document.getElementById('serviceForm');
  const body = document.getElementById('svcBody');
  const alertEl = document.getElementById('alert');
  const resetBtn = document.getElementById('resetBtn');

  let services = [];

  function alert(message, type = 'error') {
    alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  }

  function resetForm() {
    document.getElementById('svcId').value = '';
    document.getElementById('svcName').value = '';
    document.getElementById('svcDuration').value = '';
    document.getElementById('svcDescription').value = '';
    document.getElementById('svcActive').checked = true;
    document.getElementById('formTitle').textContent = 'Add a service';
    document.getElementById('saveBtn').textContent = 'Save service';
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
        <td><strong>${escapeHtml(s.name)}</strong><div class="muted" style="font-size:0.8rem">${escapeHtml(s.description || '')}</div></td>
        <td>${s.duration_minutes} min</td>
        <td>${s.active ? '<span class="badge confirmed">Active</span>' : '<span class="badge cancelled">Inactive</span>'}</td>
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
    document.getElementById('svcId').value = s.id;
    document.getElementById('svcName').value = s.name;
    document.getElementById('svcDuration').value = s.duration_minutes;
    document.getElementById('svcDescription').value = s.description || '';
    document.getElementById('svcActive').checked = s.active;
    document.getElementById('formTitle').textContent = 'Edit service';
    document.getElementById('saveBtn').textContent = 'Update service';
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
    const id = document.getElementById('svcId').value;
    const name = document.getElementById('svcName').value.trim();
    const duration = Number(document.getElementById('svcDuration').value);
    const description = document.getElementById('svcDescription').value.trim() || null;
    const active = document.getElementById('svcActive').checked;

    if (!name) return alert('Name is required.');
    if (!duration || duration <= 0) return alert('Duration must be a positive number.');

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
      alert(err.message || 'Failed to save.');
    } finally {
      btn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', resetForm);

  load();
}
