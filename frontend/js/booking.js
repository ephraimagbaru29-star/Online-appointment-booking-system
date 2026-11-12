import { initPage } from './auth.js';
import { api, ApiError } from './api.js';
import { toast, formatDate, formatTime, escapeHtml } from './ui.js';

const profile = await initPage({ activePath: '/customer/book.html' });
if (profile) run();

async function run() {
  const alertEl = document.getElementById('alert');
  const serviceSel = document.getElementById('service');
  const providerSel = document.getElementById('provider');
  const serviceDetail = document.getElementById('serviceDetail');
  const dateInput = document.getElementById('date');
  const slotsWrap = document.getElementById('slotsWrap');
  const slotsEl = document.getElementById('slots');
  const slotMeta = document.getElementById('slotMeta');
  const noSlots = document.getElementById('noSlots');
  const confirmCard = document.getElementById('confirmCard');
  const confirmSummary = document.getElementById('confirmSummary');
  const noteEl = document.getElementById('note');
  const bookBtn = document.getElementById('bookBtn');
  const changeBtn = document.getElementById('changeBtn');

  let services = [];
  let providers = [];
  let selectedSlot = null;

  function alert(message, type = 'error') {
    alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  }

  // Set the date input's minimum to today.
  const todayStr = new Date().toISOString().slice(0, 10);
  dateInput.min = todayStr;

  // Load services + providers in parallel.
  const [servicesRes, providersRes] = await Promise.all([
    api.get('/services').catch(() => null),
    api.get('/availability/providers').catch(() => null),
  ]);

  services = servicesRes?.services || [];
  providers = providersRes?.providers || [];

  if (!services.length) {
    serviceSel.innerHTML = '<option value="">No services available yet</option>';
    serviceDetail.textContent = 'Please check back later or contact the provider.';
    return;
  }

  serviceSel.innerHTML =
    '<option value="">Select a service…</option>' +
    services.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} · ${s.duration_minutes} min</option>`).join('');

  if (!providers.length) {
    providerSel.innerHTML = '<option value="">No providers available</option>';
  } else {
    providerSel.innerHTML =
      '<option value="">Select a provider…</option>' +
      providers.map((p) => `<option value="${p.id}">${escapeHtml(p.full_name || p.email)}</option>`).join('');
  }

  serviceSel.addEventListener('change', () => {
    const s = services.find((x) => x.id === serviceSel.value);
    serviceDetail.innerHTML = s
      ? `${escapeHtml(s.description || '')} <span class="muted">· ${s.duration_minutes} minutes</span>`
      : '';
    maybeLoadSlots();
  });
  providerSel.addEventListener('change', maybeLoadSlots);
  dateInput.addEventListener('change', maybeLoadSlots);

  async function maybeLoadSlots() {
    selectedSlot = null;
    confirmCard.classList.add('hidden');
    const serviceId = serviceSel.value;
    const providerId = providerSel.value;
    const date = dateInput.value;
    if (!serviceId || !providerId || !date) return;

    slotsWrap.classList.remove('hidden');
    noSlots.classList.add('hidden');
    slotsEl.innerHTML = '<span class="muted">Loading slots…</span>';
    slotMeta.textContent = '';

    try {
      const { slots } = await api.get(`/slots?serviceId=${encodeURIComponent(serviceId)}&providerId=${encodeURIComponent(providerId)}&date=${encodeURIComponent(date)}`);
      slotMeta.textContent = `${formatDate(date)} (${slots.length} open)`;
      renderSlots(slots);
    } catch (err) {
      slotsEl.innerHTML = `<span class="muted">${escapeHtml(err.message || 'Could not load slots.')}</span>`;
    }
  }

  function renderSlots(slots) {
    if (!slots.length) {
      slotsWrap.classList.add('hidden');
      noSlots.classList.remove('hidden');
      return;
    }
    noSlots.classList.add('hidden');
    slotsWrap.classList.remove('hidden');
    slotsEl.innerHTML = slots
      .map(
        (s, i) =>
          `<button type="button" class="slot" data-i="${i}" data-start="${s.start}">${formatTime(s.start)}</button>`
      )
      .join('');
    slotsEl.querySelectorAll('.slot').forEach((el) => {
      el.addEventListener('click', () => selectSlot(el, slots));
    });
  }

  function selectSlot(el, slots) {
    slotsEl.querySelectorAll('.slot').forEach((s) => s.classList.remove('selected'));
    el.classList.add('selected');
    selectedSlot = slots[Number(el.dataset.i)];
    showConfirm();
  }

  function showConfirm() {
    if (!selectedSlot) return;
    const s = services.find((x) => x.id === serviceSel.value);
    const p = providers.find((x) => x.id === providerSel.value);
    confirmSummary.innerHTML = `
      <strong>${escapeHtml(s?.name || '')}</strong> with
      <strong>${escapeHtml(p?.full_name || p?.email || '')}</strong><br />
      ${formatDate(selectedSlot.start)} · ${formatTime(selectedSlot.start)} – ${formatTime(selectedSlot.end)}`;
    confirmCard.classList.remove('hidden');
    confirmCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  changeBtn.addEventListener('click', () => {
    selectedSlot = null;
    confirmCard.classList.add('hidden');
    slotsEl.querySelectorAll('.slot').forEach((s) => s.classList.remove('selected'));
  });

  bookBtn.addEventListener('click', async () => {
    if (!selectedSlot) return;
    bookBtn.disabled = true;
    bookBtn.textContent = 'Booking…';
    try {
      const data = await api.post('/appointments', {
        service_id: serviceSel.value,
        provider_id: providerSel.value,
        start: selectedSlot.start,
        customer_note: noteEl.value.trim() || null,
      });
      toast('Booking confirmed — status: Pending', 'success');
      // Show reference and redirect to dashboard.
      setTimeout(() => {
        window.location.href = '/customer/dashboard.html';
      }, 900);
    } catch (err) {
      alert(err.message || 'Booking failed.');
      bookBtn.disabled = false;
      bookBtn.textContent = 'Confirm booking';
      // Reload slots as the chosen one may now be taken.
      maybeLoadSlots();
    }
  });
}
