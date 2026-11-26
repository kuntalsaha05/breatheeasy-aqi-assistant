// app.js — BreatheEasy UI layer.
//
// This file owns the DOM, the optional Open-Meteo live fetch, geolocation
// and the optional Gemini call; all air-quality maths lives in aqi.js
// (pure functions, unit-tested in tests/aqi.test.js).
//
// State model:
//   state.city    — the city record on screen (bundled sample or live data)
//   state.plan    — the last generated routine (null before Generate)
//   state.hacks   — Set of indoor-hack ids ticked off
// The Gemini key is never stored anywhere — it lives only in the page's
// own password input for the one call the user triggers.

(() => {
'use strict';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const OPEN_METEO_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const HTML_ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
};

/* ------------------------------------------------------------------ */
/* Small DOM / formatting helpers                                      */
/* ------------------------------------------------------------------ */

/** Shorthand for getElementById — every element lookup goes through here. */
const $ = (id) => document.getElementById(id);

/**
 * Escape user- or AI-supplied text before it reaches innerHTML.
 * Security boundary: city names, profile text and Gemini output are untrusted.
 */
const esc = (s) => String(s).replace(/[&<>'"]/g, (c) => HTML_ESCAPES[c]);

/* ------------------------------------------------------------------ */
/* Application state                                                   */
/* ------------------------------------------------------------------ */

const state = {
  city: getCity('delhi'), // bundled sample data until live data loads
  plan: null,
  hacks: new Set(),
};

/* ------------------------------------------------------------------ */
/* Rendering — one function per section, renderCity orchestrates       */
/* ------------------------------------------------------------------ */

/** Render the AQI hero: number, band badge, health guidance. */
function renderAQI() {
  const c = state.city;
  const band = categoriseAQI(c.aqi);
  $('aqi-number').textContent = c.aqi;
  $('aqi-number').style.color = band ? band.color : '#134e4a';
  $('aqi-label').textContent = band ? band.label : 'Unknown';
  $('aqi-label').style.color = band ? band.color : '#134e4a';
  $('aqi-pm').textContent = `PM2.5 ${c.pm25} µg/m³ · PM10 ${c.pm10} µg/m³ · ${esc(c.name)}`;
  $('aqi-advice').textContent = band ? band.advice : '';
  $('aqi-sensitive').textContent = band ? band.sensitive : '';
}

/** Render one 24-bar PM2.5 chart; best/worst window bars are coloured. */
function renderChart(elId, hourly, best, worst) {
  const el = $(elId);
  const max = Math.max(...hourly, 1);
  el.innerHTML = hourly.map((v, h) => {
    const cls = h >= best.start && h < best.end ? 'bar best'
      : h >= worst.start && h < worst.end ? 'bar worst' : 'bar';
    return `<div class="${cls}" style="height:${Math.max(2, Math.round((v / max) * 100))}%" title="${fmtHour(h)}: ${v} µg/m³"></div>`;
  }).join('');
  el.setAttribute('aria-label',
    `Bar chart of hourly PM2.5, ${fmtHour(0)} to ${fmtHour(23)}. ` +
    `Lowest around ${fmtHour(best.start)}, highest around ${fmtHour(worst.start)}.`);
  renderChartLabels(el);
}

/** Hour ticks under a chart (every 3 hours) so the bars can be read. */
function renderChartLabels(el) {
  let labels = el.nextElementSibling;
  if (!labels || !labels.classList.contains('chart-labels')) {
    labels = document.createElement('div');
    labels.className = 'chart-labels';
    el.insertAdjacentElement('afterend', labels);
  }
  labels.innerHTML = [0, 3, 6, 9, 12, 15, 18, 21]
    .map((h) => `<span>${fmtHour(h)}</span>`).join('');
}

/** Render both outlook charts and the best/worst window note. */
function renderOutlook() {
  const c = state.city;
  const best = bestOutdoorWindow(c.hourly);
  const worst = worstOutdoorWindow(c.hourly);
  const bestT = bestOutdoorWindow(c.tomorrow);
  const worstT = worstOutdoorWindow(c.tomorrow);
  renderChart('chart-today', c.hourly, best, worst);
  renderChart('chart-tomorrow', c.tomorrow, bestT, worstT);
  $('window-note').innerHTML =
    `<b>Best outdoor window today: ${fmtHour(best.start)}–${fmtHour(best.end)}</b> (PM2.5 ≈ ${best.avgPm25} µg/m³). ` +
    `Worst: ${fmtHour(worst.start)}–${fmtHour(worst.end)} (≈ ${worst.avgPm25} µg/m³). ` +
    `Tomorrow's best window is ${fmtHour(bestT.start)}–${fmtHour(bestT.end)}.`;
}

/** Render the indoor-hacks checklist and its progress count. */
function renderHacks() {
  $('hack-list').innerHTML = INDOOR_HACKS.map((h) =>
    `<li><label><input type="checkbox" data-hack="${h.id}" ${state.hacks.has(h.id) ? 'checked' : ''}> ` +
    `<b>${esc(h.title)}</b> — ${esc(h.detail)}<br><span class="impact">${esc(h.impact)}</span></label></li>`).join('');
  $('hack-progress').innerHTML =
    `<b>${state.hacks.size} of ${INDOOR_HACKS.length} hacks done.</b>` +
    (state.hacks.size === INDOOR_HACKS.length ? ' Every hack ticked — your indoor air is doing the best it can.' : '');

  document.querySelectorAll('[data-hack]').forEach((box) =>
    box.addEventListener('change', () => {
      if (box.checked) state.hacks.add(box.dataset.hack);
      else state.hacks.delete(box.dataset.hack);
      renderHacks();
    }));
}

/** Render everything that depends on the current city. */
function renderCity() {
  renderAQI();
  renderOutlook();
  renderCompare();
  if (activityChecked) onCheckActivity();
  $('prompt-text').value = buildAQIPrompt(readProfile(), state.city, state.plan);
  $('ai-note').textContent = 'Built-in plan above. Edit the prompt and run it with Gemini to upgrade.';
}

/** Ranked city comparison, worst first; the current city is highlighted. */
function renderCompare() {
  const rows = rankCities();
  const max = Math.max(...rows.map((r) => r.aqi), 1);
  $('compare-list').innerHTML = rows.map((r) =>
    `<li class="${r.key === state.city.key ? 'current' : ''}">` +
    `<span class="rank">${r.rank}</span>` +
    `<span class="cname">${esc(r.name)}</span>` +
    `<span class="cbar"><span style="width:${Math.round((r.aqi / max) * 100)}%; background:${r.color}"></span></span>` +
    `<span class="caqi" style="color:${r.color}">${r.aqi} · ${esc(r.band)}</span></li>`).join('');
}

/* ------------------------------------------------------------------ */
/* Live data — Open-Meteo Air Quality API (CAMS), free, no key        */
/* ------------------------------------------------------------------ */

/** Fill nulls in an hourly series with the nearest earlier value. */
function fillGaps(values) {
  let last = null;
  const out = values.map((v) => {
    if (typeof v === 'number' && Number.isFinite(v)) { last = v; return v; }
    return last;
  });
  const first = out.find((v) => v !== null);
  return out.map((v) => (v === null ? (first ?? 0) : v));
}

/**
 * Try the live Open-Meteo fetch for the current city; on any failure the
 * bundled sample data stays on screen and the note says so.
 */
async function onTryLive() {
  const note = $('data-note');
  const c = state.city;
  note.textContent = `Fetching live data for ${c.name}…`;
  try {
    const url = `${OPEN_METEO_ENDPOINT}?latitude=${c.lat}&longitude=${c.lon}` +
      `&hourly=pm2_5,pm10&forecast_days=2&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const pm25 = fillGaps(data.hourly.pm2_5 || []);
    const pm10 = fillGaps(data.hourly.pm10 || []);
    if (pm25.length < 24 || pm10.length < 24) throw new Error('short series');
    const today = pm25.slice(0, 24);
    const tomorrow = pm25.slice(24, 48);
    const current = today[new Date().getHours()] ?? today[today.length - 1];
    state.city = {
      key: c.key, name: c.name, lat: c.lat, lon: c.lon,
      pm25: Math.round(current),
      pm10: Math.round(pm10[new Date().getHours()] ?? pm10[23]),
      aqi: pm25ToAQI(current),
      hourly: today.map((v) => Math.round(v)),
      tomorrow: tomorrow.map((v) => Math.round(v)),
      source: 'live (Open-Meteo / CAMS)',
    };
    state.plan = null;
    $('routine-list').innerHTML = '';
    $('impact-summary').textContent = '';
    note.textContent = `Live data for ${c.name} via Open-Meteo (CAMS) — AQI ${state.city.aqi}. Bundled sample data is the fallback when offline.`;
    renderCity();
  } catch {
    note.textContent = `Live data unavailable (offline or blocked) — still showing bundled sample data for ${c.name}. Try again later.`;
  }
}

/* ------------------------------------------------------------------ */
/* Geolocation — reverse-map to the nearest bundled city               */
/* ------------------------------------------------------------------ */

function onUseLocation() {
  const note = $('data-note');
  if (!navigator.geolocation) {
    note.textContent = 'Geolocation is not available in this browser — pick a city instead.';
    return;
  }
  note.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const key = nearestCity(pos.coords.latitude, pos.coords.longitude);
      if (!key) { note.textContent = 'Could not match your location to a city — pick one instead.'; return; }
      $('city').value = key;
      state.city = getCity(key);
      state.plan = null;
      note.textContent = `Nearest bundled city to your location: ${state.city.name}. Try live data for the latest reading.`;
      renderCity();
    },
    () => { note.textContent = 'Location permission denied — pick a city instead.'; },
  );
}

/* ------------------------------------------------------------------ */
/* Routine planner                                                     */
/* ------------------------------------------------------------------ */

/** Read the household profile form into the shape aqi.js expects. */
function readProfile() {
  return {
    children: $('p-children').checked,
    elderly: $('p-elderly').checked,
    asthma: $('p-asthma').checked,
    outdoorWorker: $('p-worker').checked,
    commuter: $('p-commuter').checked,
    vehicle: $('p-vehicle').value,
    commuteKm: +$('p-km').value,
  };
}

/** Generate the day plan and render it with its impact notes. */
function onGenerate() {
  const profile = readProfile();
  const plan = generateRoutine(profile, state.city);
  state.plan = plan;
  $('routine-list').innerHTML = plan.items.map((i) =>
    `<li><b>${esc(i.time)} — ${esc(i.title)}</b><br>${esc(i.detail)}<br>` +
    `<span class="impact">Impact: ${esc(i.impact)}</span></li>`).join('');

  const avoided = exposureAvoided(plan.best.avgPm25, plan.worst.avgPm25);
  const commute = plan.items.find((i) => i.time === 'Commute');
  $('impact-summary').innerHTML =
    `<b>Your plan today:</b> shifting outdoor activity to the ${fmtHour(plan.best.start)}–${fmtHour(plan.best.end)} window ` +
    `avoids ≈ ${avoided} µg of PM2.5 inhaled per hour outdoors` +
    (commute ? `; ${esc(commute.impact)}` : '.');
  const swapMode = ['bus', 'metro', 'walk-cycle'].includes(profile.vehicle) ? profile.vehicle : 'metro';
  const savings = profile.commuter ? commuteSavings(swapMode, profile.commuteKm, 5) : null;
  if (savings && (savings.co2PerWeekKg > 0 || savings.moneyPerWeekRs > 0)) {
    $('impact-summary').innerHTML +=
      ` Over a 5-day week, that commute swap saves ≈ ${savings.co2PerWeekKg} kg of CO2 and ≈ ₹${savings.moneyPerWeekRs}.`;
  }
  $('prompt-text').value = buildAQIPrompt(profile, state.city, plan);
  $('routine-list').scrollIntoView({ behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* Prompt Studio — the exact prompt, editable, optionally run on Gemini */
/* ------------------------------------------------------------------ */

async function onCopyPrompt() {
  try {
    await navigator.clipboard.writeText($('prompt-text').value);
    $('ai-note').textContent = 'Prompt copied to the clipboard.';
  } catch {
    $('ai-note').textContent = 'Copy failed — select the prompt text and copy it manually.';
  }
}

/**
 * Prompt Studio: send the (user-editable) prompt to Gemini and append the
 * returned recommendations, marked ✨. The key is the user's own, stays in
 * the browser, and is only ever sent to Google's API.
 */
async function onRunPrompt() {
  const key = $('geminiKey').value.trim();
  const note = $('ai-note');
  if (!key) {
    note.textContent = 'Paste a Gemini API key above to run this prompt. It stays in your browser.';
    return;
  }
  note.textContent = 'Running your prompt with Gemini…';
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: $('prompt-text').value }] }] }),
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const extra = text.split('\n')
      .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
    if (extra.length) {
      $('ai-ideas').innerHTML = extra.map((i) => `<li>✨ ${esc(i)}</li>`).join('');
      note.textContent = 'Recommendations marked ✨ came from the exact prompt above, via Gemini.';
    } else {
      note.textContent = 'Gemini returned nothing usable — the built-in plan still stands.';
    }
  } catch {
    note.textContent = 'Gemini call failed (check key / connection) — the built-in plan still stands.';
  }
}

/* ------------------------------------------------------------------ */
/* Activity checker — can I do it now?                                 */
/* ------------------------------------------------------------------ */

let activityChecked = false;

/** Fill the hour select (24 options, 2 PM selected — the best window). */
function populateHours() {
  $('act-hour').innerHTML = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}"${h === 14 ? ' selected' : ''}>${fmtHour(h)}</option>`).join('');
}

/** Verdict for the chosen activity at the chosen hour in the current city. */
function onCheckActivity() {
  activityChecked = true;
  const hour = +$('act-hour').value;
  const pm25 = state.city.hourly[hour];
  const v = activityVerdict($('act-activity').value, pm25);
  const act = getActivity($('act-activity').value);
  $('act-result').innerHTML =
    `<p class="verdict ${v.level}"><b>${esc(v.verdict)}</b> — ${esc(act.label)} at ${fmtHour(hour)} in ${esc(state.city.name)} (PM2.5 ${pm25} µg/m³).</p>` +
    `<p>${esc(v.detail)}</p>`;
}

/* ------------------------------------------------------------------ */
/* Purifier sizing                                                     */
/* ------------------------------------------------------------------ */

/** CADR for the room dimensions the user entered. */
function onCalcRoom() {
  const r = cadrForRoom(+$('room-l').value, +$('room-w').value, +$('room-h').value);
  $('room-result').innerHTML = r
    ? `<p><b>Room volume ≈ ${r.volumeM3} m³ — you need a purifier rated ≥ ${r.cadrM3h} m³/h (CADR).</b></p>` +
      `<p>${esc(r.note)} A standard shop purifier lists its CADR on the box; a DIY box fan with a MERV-13 filter moves roughly 350 m³/h. Figures are rough rules of thumb, not lab measurements.</p>`
    : '<p>Enter room dimensions between 1 and 20 metres.</p>';
}

/* ------------------------------------------------------------------ */
/* Household profile — save in this browser, copy the plan             */
/* ------------------------------------------------------------------ */

const PROFILE_KEY = 'breatheeasy-profile';

/** Save the household form so it is filled in next time. */
function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(readProfile())); } catch { /* private mode — just don't persist */ }
  $('profile-note').textContent = 'Profile saved in this browser — it will be filled in next time you open the app.';
}

/** Restore a saved household form, if one exists. */
function loadProfile() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { /* corrupt value — ignore */ }
  if (!saved) return;
  $('p-children').checked = !!saved.children;
  $('p-elderly').checked = !!saved.elderly;
  $('p-asthma').checked = !!saved.asthma;
  $('p-worker').checked = !!saved.outdoorWorker;
  $('p-commuter').checked = saved.commuter !== false;
  if (saved.vehicle) $('p-vehicle').value = saved.vehicle;
  if (saved.commuteKm) $('p-km').value = saved.commuteKm;
  $('profile-note').textContent = 'Loaded your saved household profile.';
}

/** Copy the generated day plan as plain text. */
async function onCopyPlan() {
  if (!state.plan) {
    $('profile-note').textContent = 'Generate your day plan first, then copy it.';
    return;
  }
  const text = [
    `BreatheEasy day plan — ${state.plan.city} (AQI ${state.plan.aqi}, ${state.plan.band})`,
    ...state.plan.items.map((i) => `${i.time} — ${i.title}: ${i.detail} Impact: ${i.impact}`),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    $('profile-note').textContent = 'Day plan copied to the clipboard.';
  } catch {
    $('profile-note').textContent = 'Copy failed — select the plan text and copy it manually.';
  }
}

/* ------------------------------------------------------------------ */
/* Dark mode — persisted, falls back to the system preference          */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('theme-toggle');
  btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  try { localStorage.setItem('breatheeasy-theme', theme); } catch { /* private mode — theme just won't persist */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('breatheeasy-theme'); } catch { /* ignore */ }
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

$('city').addEventListener('change', () => {
  state.city = getCity($('city').value);
  state.plan = null;
  $('routine-list').innerHTML = '';
  $('impact-summary').textContent = '';
  $('data-note').textContent =
    `Showing bundled sample data for ${state.city.name} — representative winter-smog values for demo and offline use. Try live data for the latest reading.`;
  renderCity();
});
$('use-location').addEventListener('click', onUseLocation);
$('try-live').addEventListener('click', onTryLive);
$('generate').addEventListener('click', onGenerate);
$('copy-prompt').addEventListener('click', onCopyPrompt);
$('run-prompt').addEventListener('click', onRunPrompt);
$('act-check').addEventListener('click', onCheckActivity);
$('room-calc').addEventListener('click', onCalcRoom);
$('save-profile').addEventListener('click', saveProfile);
$('copy-plan').addEventListener('click', onCopyPlan);
$('theme-toggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

populateHours();
initTheme();
loadProfile();
renderHacks();
renderCity();

})();
