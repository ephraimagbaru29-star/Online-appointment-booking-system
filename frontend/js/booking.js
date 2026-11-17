import { initPage } from './auth.js';
import { api } from './api.js';
import { toast, formatDate, formatTime, escapeHtml } from './ui.js';

const profile = await initPage({ activePath: '/customer/book.html' });
if (profile) run();

// ---- Duration formatting (matches services.js) ----
function durationLabel(totalMinutes) {
  const totalSec = Math.round(totalMinutes * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h} hr`);
  if (m) parts.push(`${m} min`);
  if (s) parts.push(`${s} sec`);
  return parts.length ? parts.join(' ') : '0 min';
}

async function run() {
  // ---- DOM refs ----
  const alertEl       = document.getElementById('alert');
  const step1El       = document.getElementById('step1');
  const step2El       = document.getElementById('step2');
  const step3El       = document.getElementById('step3');
  const step4El       = document.getElementById('step4');
  const step1pill     = document.getElementById('step1pill');
  const step2pill     = document.getElementById('step2pill');
  const step3pill     = document.getElementById('step3pill');
  const step4pill     = document.getElementById('step4pill');
  const serviceList   = document.getElementById('serviceList');
  const step2sub      = document.getElementById('step2sub');
  const providerSel   = document.getElementById('provider');
  const dateInput     = document.getElementById('date');
  const slotGrid      = document.getElementById('slotGrid');
  const slotMeta      = document.getElementById('slotMeta');
  const noSlots       = document.getElementById('noSlots');
  const bookBar       = document.getElementById('bookBar');
  const bookSummaryTitle  = document.getElementById('bookSummaryTitle');
  const bookSummaryDetail = document.getElementById('bookSummaryDetail');
  const noteEl        = document.getElementById('note');
  const bookNowBtn    = document.getElementById('bookNowBtn');
  const changeSlotBtn = document.getElementById('changeSlotBtn');

  // ---- State ----
  let services       = [];
  let providers      = [];
  let selectedService = null;
  let selectedProvider = null;
  let selectedSlot   = null;

  // ---- Step pill helpers ----
  function setStepPills(active) {
    const pills = [step1pill, step2pill, step3pill, step4pill];
    pills.forEach((p, i) => {
      p.classList.remove('active', 'done');
      if (i + 1 < active) p.classList.add('done');
      if (i + 1 === active) p.classList.add('active');
    });
  }

  function showAlert(msg, type = 'error') {
    alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(msg)}</div>`;
  }

  // ---- Date min ----
  dateInput.min = new Date().toISOString().slice(0, 10);

  // ---- Load services + providers in parallel ----
  const [svcRes, provRes] = await Promise.all([
    api.get('/services').catch(() => null),
    api.get('/availability/providers').catch(() => null),
  ]);

  services  = svcRes?.services   || [];
  providers = provRes?.providers || [];

  if (!services.length) {
    serviceList.innerHTML =
      '<div class="alert info">No services are available yet. Please check back later.</div>';
    return;
  }

  // ---- Render service cards ----
  serviceList.innerHTML = services
    .map(
      (s) => `
      <div class="service-card" data-id="${s.id}" role="button" tabindex="0"
           aria-label="${escapeHtml(s.name)}">
        <div class="svc-name">${escapeHtml(s.name)}</div>
        <div class="svc-desc">${escapeHtml(s.description || '')}</div>
        <span class="svc-dur">⏱ ${durationLabel(s.duration_minutes)}</span>
      </div>`
    )
    .join('');

  serviceList.querySelectorAll('.service-card').forEach((card) => {
    const activate = () => pickService(card.dataset.id);
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activate(); });
  });

  // ---- Step 1 → pick a service ----
  function pickService(id) {
    selectedService  = services.find((s) => s.id === id);
    selectedProvider = null;
    selectedSlot     = null;
    alertEl.innerHTML = '';

    // Highlight selected card
    serviceList.querySelectorAll('.service-card').forEach((c) => {
      c.classList.toggle('selected', c.dataset.id === id);
    });

    // Populate provider dropdown
    step2sub.textContent = `You selected: ${selectedService.name} · ${durationLabel(selectedService.duration_minutes)}`;
    if (!providers.length) {
      providerSel.innerHTML = '<option value="">No providers available yet</option>';
    } else {
      providerSel.innerHTML =
        '<option value="">Select a provider…</option>' +
        providers
          .map((p) => `<option value="${p.id}">${escapeHtml(p.full_name || p.email)}</option>`)
          .join('');
    }

    // Show step 2, hide later steps
    step2El.classList.remove('hidden');
    step3El.classList.add('hidden');
    step4El.classList.add('hidden');
    bookBar.classList.add('hidden');
    setStepPills(2);
    step2El.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Step 2 → pick a provider ----
  providerSel.addEventListener('change', () => {
    selectedProvider = providers.find((p) => p.id === providerSel.value) || null;
    selectedSlot     = null;
    bookBar.classList.add('hidden');

    if (!selectedProvider) {
      step3El.classList.add('hidden');
      step4El.classList.add('hidden');
      return;
    }

    // Show step 3
    dateInput.value = '';
    step3El.classList.remove('hidden');
    step4El.classList.add('hidden');
    setStepPills(3);
    step3El.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // ---- Step 3 → pick a date ----
  dateInput.addEventListener('change', async () => {
    const date = dateInput.value;
    if (!date || !selectedService || !selectedProvider) return;
    selectedSlot = null;
    bookBar.classList.add('hidden');
    await loadSlots(date);
  });

  // ---- Step 4: load + render slots ----
  async function loadSlots(date) {
    step4El.classList.remove('hidden');
    noSlots.classList.add('hidden');
    slotGrid.innerHTML = '<span class="muted">Loading available times…</span>';
    slotMeta.textContent = '';
    setStepPills(4);
    step4El.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const { slots } = await api.get(
        `/slots?serviceId=${encodeURIComponent(selectedService.id)}` +
        `&providerId=${encodeURIComponent(selectedProvider.id)}` +
        `&date=${encodeURIComponent(date)}`
      );

      if (!slots.length) {
        slotGrid.innerHTML = '';
        noSlots.classList.remove('hidden');
        slotMeta.textContent = formatDate(date + 'T00:00:00');
        return;
      }

      slotMeta.textContent = `${formatDate(date + 'T00:00:00')} · ${slots.length} slot${slots.length !== 1 ? 's' : ''} available`;
      renderSlots(slots);
    } catch (err) {
      slotGrid.innerHTML = `<span class="muted">${escapeHtml(err.message || 'Could not load slots.')}</span>`;
    }
  }

  function renderSlots(slots) {
    noSlots.classList.add('hidden');
    slotGrid.innerHTML = slots
      .map(
        (s, i) =>
          `<button type="button" class="slot-btn" data-i="${i}"
            aria-label="Book ${formatTime(s.start)}">
            ${formatTime(s.start)}<br/>
            <span style="font-size:0.72rem;font-weight:400;opacity:.75">${formatTime(s.end)}</span>
          </button>`
      )
      .join('');

    slotGrid.querySelectorAll('.slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => pickSlot(btn, slots));
    });
  }

  // ---- Slot selected → show Book Now bar ----
  function pickSlot(btn, slots) {
    slotGrid.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('picked'));
    btn.classList.add('picked');
    selectedSlot = slots[Number(btn.dataset.i)];

    bookSummaryTitle.textContent =
      `${selectedService.name} with ${selectedProvider.full_name || selectedProvider.email}`;
    bookSummaryDetail.textContent =
      `${formatDate(selectedSlot.start)} · ${formatTime(selectedSlot.start)} – ${formatTime(selectedSlot.end)}`;

    bookBar.classList.remove('hidden');
    bookBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Change slot ----
  changeSlotBtn.addEventListener('click', () => {
    selectedSlot = null;
    slotGrid.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('picked'));
    bookBar.classList.add('hidden');
    noteEl.value = '';
  });

  // ---- Book Now ----
  bookNowBtn.addEventListener('click', async () => {
    if (!selectedSlot) return;

    bookNowBtn.disabled = true;
    bookNowBtn.innerHTML = '<span class="spinner"></span> Booking…';

    try {
      await api.post('/appointments', {
        service_id:    selectedService.id,
        provider_id:   selectedProvider.id,
        start:         selectedSlot.start,
        customer_note: noteEl.value.trim() || null,
      });
      toast('Appointment booked — status: Pending', 'success');
      setTimeout(() => { window.location.href = '/customer/dashboard.html'; }, 900);
    } catch (err) {
      showAlert(err.message || 'Booking failed. Please try again.');
      bookNowBtn.disabled = false;
      bookNowBtn.innerHTML = '🗓 Book Now';
      // Reload slots — the picked one may now be taken.
      await loadSlots(dateInput.value);
    }
  });
}
