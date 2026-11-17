import { initPage } from './auth.js';
import { api } from './api.js';
import { toast, formatDate, formatTime, escapeHtml, scheduleTimezone } from './ui.js';

const profile = await initPage({ activePath: '/customer/book.html' });
if (profile) run();

// ── Helpers ──────────────────────────────────────────────────────────────────

// Duration label matching services.js
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

// Convert "HH:MM" 24h → "9:00 AM" style label
function hhmm24toAmPm(hhmm) {
  if (!hhmm) return '';
  const [hStr, mStr] = hhmm.split(':');
  let h = Number(hStr);
  const m = mStr || '00';
  const ampm = h < 12 ? 'AM' : 'PM';
  if (h === 0)  h = 12;
  if (h > 12)   h -= 12;
  return `${h}:${m} ${ampm}`;
}

// Get the weekday name for a YYYY-MM-DD string
// (we need it to look up the provider's availability for that day)
function weekdayOfDate(dateStr) {
  // Build the date at noon local time to avoid DST / UTC shifts changing the day
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

const ALL_WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  // DOM refs
  const alertEl          = document.getElementById('alert');
  const step1El          = document.getElementById('step1');
  const step2El          = document.getElementById('step2');
  const step3El          = document.getElementById('step3');
  const step4El          = document.getElementById('step4');
  const step1pill        = document.getElementById('step1pill');
  const step2pill        = document.getElementById('step2pill');
  const step3pill        = document.getElementById('step3pill');
  const step4pill        = document.getElementById('step4pill');
  const serviceList      = document.getElementById('serviceList');
  const step2sub         = document.getElementById('step2sub');
  const providerSel      = document.getElementById('provider');
  const providerSchedule = document.getElementById('providerSchedule');
  const scheduleBody     = document.getElementById('scheduleBody');
  const workdayChips     = document.getElementById('workdayChips');
  const step3sub         = document.getElementById('step3sub');
  const dateInput        = document.getElementById('date');
  const dateHint         = document.getElementById('dateHint');
  const hoursBanner      = document.getElementById('hoursBanner');
  const slotGrid         = document.getElementById('slotGrid');
  const slotMeta         = document.getElementById('slotMeta');
  const noSlots          = document.getElementById('noSlots');
  const bookBar          = document.getElementById('bookBar');
  const bookSummaryTitle = document.getElementById('bookSummaryTitle');
  const bookSummaryDetail= document.getElementById('bookSummaryDetail');
  const noteEl           = document.getElementById('note');
  const bookNowBtn       = document.getElementById('bookNowBtn');
  const changeSlotBtn    = document.getElementById('changeSlotBtn');

  // State
  let services          = [];
  let providers         = [];
  let selectedService   = null;
  let selectedProvider  = null;
  let providerAvailability = []; // array of availability rows for selected provider
  let selectedSlot      = null;

  // ── Step pill tracker ────────────────────────────────────────────────────
  function setStepPills(active) {
    [step1pill, step2pill, step3pill, step4pill].forEach((p, i) => {
      p.classList.remove('active', 'done');
      if (i + 1 < active)  p.classList.add('done');
      if (i + 1 === active) p.classList.add('active');
    });
  }

  function showAlert(msg, type = 'error') {
    alertEl.innerHTML = `<div class="alert ${type}">${escapeHtml(msg)}</div>`;
  }

  dateInput.min = new Date().toISOString().slice(0, 10);

  // ── Load services + providers ────────────────────────────────────────────
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

  // ── Render service cards ─────────────────────────────────────────────────
  serviceList.innerHTML = services.map((s) => `
    <div class="service-card" data-id="${s.id}" role="button" tabindex="0"
         aria-label="${escapeHtml(s.name)}">
      <div class="svc-name">${escapeHtml(s.name)}</div>
      <div class="svc-desc">${escapeHtml(s.description || '')}</div>
      <span class="svc-dur">⏱ ${durationLabel(s.duration_minutes)}</span>
    </div>`).join('');

  serviceList.querySelectorAll('.service-card').forEach((card) => {
    const go = () => pickService(card.dataset.id);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(); });
  });

  // ── Step 1 → service selected ────────────────────────────────────────────
  function pickService(id) {
    selectedService      = services.find((s) => s.id === id);
    selectedProvider     = null;
    providerAvailability = [];
    selectedSlot         = null;
    alertEl.innerHTML    = '';

    serviceList.querySelectorAll('.service-card').forEach((c) =>
      c.classList.toggle('selected', c.dataset.id === id));

    step2sub.textContent =
      `You selected: ${selectedService.name} · ${durationLabel(selectedService.duration_minutes)}`;

    providerSel.innerHTML = providers.length
      ? '<option value="">Select a provider…</option>' +
        providers.map((p) =>
          `<option value="${p.id}">${escapeHtml(p.full_name || p.email)}</option>`).join('')
      : '<option value="">No providers available yet</option>';

    // Reset downstream
    providerSchedule.classList.add('hidden');
    step3El.classList.add('hidden');
    step4El.classList.add('hidden');
    bookBar.classList.add('hidden');
    step2El.classList.remove('hidden');
    setStepPills(2);
    step2El.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Step 2 → provider selected: load + show their schedule ──────────────
  providerSel.addEventListener('change', async () => {
    selectedProvider     = providers.find((p) => p.id === providerSel.value) || null;
    providerAvailability = [];
    selectedSlot         = null;
    bookBar.classList.add('hidden');
    step3El.classList.add('hidden');
    step4El.classList.add('hidden');
    providerSchedule.classList.add('hidden');

    if (!selectedProvider) return;

    // Fetch provider availability
    try {
      const res = await api.get(`/availability?providerId=${encodeURIComponent(selectedProvider.id)}`);
      providerAvailability = res.availability || [];
    } catch { providerAvailability = []; }

    // Render the weekly schedule panel
    renderSchedulePanel(providerAvailability, selectedProvider);

    // Advance to step 3
    dateInput.value = '';
    renderWorkdayChips(providerAvailability);
    step3El.classList.remove('hidden');
    step4El.classList.add('hidden');
    setStepPills(3);
    step3El.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // ── Render the provider's weekly schedule (shown in step 2 card) ─────────
  function renderSchedulePanel(avail, provider) {
    const byDay = Object.fromEntries(avail.map((a) => [a.weekday, a]));

    scheduleBody.innerHTML = ALL_WEEKDAYS.map((day) => {
      const a = byDay[day];
      if (!a) {
        return `
          <div class="sp-row">
            <span class="sp-dot closed"></span>
            <span class="sp-day off">${day}</span>
            <span class="sp-hours off">Day off</span>
          </div>`;
      }
      const startLabel = hhmm24toAmPm(a.start_time);
      const endLabel   = hhmm24toAmPm(a.end_time);
      const breaks     = Array.isArray(a.breaks) && a.breaks[0] ? a.breaks[0] : null;
      const breakStr   = breaks
        ? `Break: ${hhmm24toAmPm(breaks.start)} – ${hhmm24toAmPm(breaks.end)}`
        : '';
      return `
        <div class="sp-row">
          <span class="sp-dot open"></span>
          <span class="sp-day">${day}</span>
          <span class="sp-hours">${startLabel} – ${endLabel}</span>
          ${breakStr ? `<span class="sp-break">☕ ${escapeHtml(breakStr)}</span>` : ''}
        </div>`;
    }).join('');

    providerSchedule.classList.remove('hidden');
  }

  // ── Render weekday chips in step 3 (green = working day) ─────────────────
  function renderWorkdayChips(avail) {
    const workingDays = new Set(avail.map((a) => a.weekday));
    const providerName = selectedProvider?.full_name || selectedProvider?.email || 'this provider';

    workdayChips.innerHTML = ALL_WEEKDAYS.map((day) => {
      const isOpen = workingDays.has(day);
      return `<span class="wd-chip ${isOpen ? 'open' : ''}"
        title="${isOpen ? 'Available' : 'Day off'}">${day.slice(0,3)}</span>`;
    }).join('');

    // Update the step 3 subtitle
    const workingList = ALL_WEEKDAYS.filter((d) => workingDays.has(d));
    step3sub.innerHTML = workingList.length
      ? `<strong>${escapeHtml(providerName)}</strong> is available on: ` +
        workingList.map((d) => `<strong>${d}</strong>`).join(', ') +
        '. Only these days will have open slots.'
      : `<strong>${escapeHtml(providerName)}</strong> has no working hours set yet.`;
  }

  // ── Step 3 → date selected ───────────────────────────────────────────────
  dateInput.addEventListener('change', async () => {
    const date = dateInput.value;
    if (!date || !selectedService || !selectedProvider) return;
    selectedSlot = null;
    bookBar.classList.add('hidden');

    // Check if the selected date is a working day
    const chosenWeekday = weekdayOfDate(date);
    const dayData = providerAvailability.find((a) => a.weekday === chosenWeekday);

    if (!dayData) {
      // Not a working day — warn but still try loading (backend will return [])
      dateHint.innerHTML =
        `<span style="color:var(--warning)">⚠️ ${escapeHtml(selectedProvider?.full_name || 'This provider')} ` +
        `does not work on ${chosenWeekday}s. No slots will be available.</span>`;
    } else {
      const startLabel = hhmm24toAmPm(dayData.start_time);
      const endLabel   = hhmm24toAmPm(dayData.end_time);
      const breaks     = Array.isArray(dayData.breaks) && dayData.breaks[0] ? dayData.breaks[0] : null;
      dateHint.innerHTML =
        `<span style="color:var(--success)">✓ Available on ${chosenWeekday}s: ` +
        `<strong>${startLabel} – ${endLabel}</strong>` +
        (breaks ? ` &nbsp;·&nbsp; ☕ Break ${hhmm24toAmPm(breaks.start)} – ${hhmm24toAmPm(breaks.end)}` : '') +
        `</span>`;
    }

    await loadSlots(date);
  });

  // ── Step 4: load + render slots ──────────────────────────────────────────
  async function loadSlots(date) {
    step4El.classList.remove('hidden');
    noSlots.classList.add('hidden');
    hoursBanner.classList.add('hidden');
    slotGrid.innerHTML = '<span class="muted">Loading available times…</span>';
    slotMeta.textContent = '';
    setStepPills(4);
    step4El.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Show the working-hours banner for this day
    const chosenWeekday = weekdayOfDate(date);
    const dayData = providerAvailability.find((a) => a.weekday === chosenWeekday);
    if (dayData) {
      const startLabel = hhmm24toAmPm(dayData.start_time);
      const endLabel   = hhmm24toAmPm(dayData.end_time);
      const breaks     = Array.isArray(dayData.breaks) && dayData.breaks[0] ? dayData.breaks[0] : null;
      hoursBanner.innerHTML =
        `<span class="hb-label">🕐 Working hours:</span>` +
        `<span class="hb-time">${escapeHtml(startLabel)} – ${escapeHtml(endLabel)}</span>` +
        (breaks
          ? `<span class="hb-break">☕ Break: ${escapeHtml(hhmm24toAmPm(breaks.start))} – ${escapeHtml(hhmm24toAmPm(breaks.end))}</span>`
          : '');
      hoursBanner.classList.remove('hidden');
    }

    try {
      const { slots } = await api.get(
        `/slots?serviceId=${encodeURIComponent(selectedService.id)}` +
        `&providerId=${encodeURIComponent(selectedProvider.id)}` +
        `&date=${encodeURIComponent(date)}`
      );

      if (!slots.length) {
        slotGrid.innerHTML = '';
        noSlots.classList.remove('hidden');
        slotMeta.textContent = formatDate(date + 'T12:00:00');
        return;
      }

      slotMeta.textContent =
        `${formatDate(date + 'T12:00:00')} · ${slots.length} slot${slots.length !== 1 ? 's' : ''} available`;
      renderSlots(slots);
    } catch (err) {
      slotGrid.innerHTML =
        `<span class="muted">${escapeHtml(err.message || 'Could not load slots.')}</span>`;
    }
  }

  function renderSlots(slots) {
    noSlots.classList.add('hidden');
    slotGrid.innerHTML = slots.map((s, i) => `
      <button type="button" class="slot-btn" data-i="${i}"
        aria-label="Book ${formatTime(s.start)}">
        ${formatTime(s.start)}<br/>
        <span style="font-size:0.72rem;font-weight:400;opacity:.75">${formatTime(s.end)}</span>
      </button>`).join('');

    slotGrid.querySelectorAll('.slot-btn').forEach((btn) =>
      btn.addEventListener('click', () => pickSlot(btn, slots)));
  }

  // ── Slot selected → show Book Now bar ────────────────────────────────────
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

  changeSlotBtn.addEventListener('click', () => {
    selectedSlot = null;
    slotGrid.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('picked'));
    bookBar.classList.add('hidden');
    noteEl.value = '';
  });

  // ── Book Now ─────────────────────────────────────────────────────────────
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
      await loadSlots(dateInput.value);
    }
  });
}
