// aqi.js — pure air-quality logic for BreatheEasy (Urban Air Quality Assistant).
//
// Design rules (mirrors planner.js from Challenge 05):
//   * No DOM, no network, no API keys — the same file runs in Node (where
//     tests/aqi.test.js exercises it) and in the browser (app.js).
//   * Every function is deterministic: same input, same plan. The only
//     non-determinism in the app is the optional Open-Meteo fetch and the
//     optional Gemini call, both in app.js.
//   * ONE scale only: the CPCB (India) AQI bands, documented in README.md.
//     Bundled city data is representative sample data for demo / offline use;
//     live data comes from the Open-Meteo Air Quality API (CAMS) when online.

/* ------------------------------------------------------------------ */
/* CPCB (India) AQI bands                                              */
/* ------------------------------------------------------------------ */

const AQI_BANDS = [
  { min: 0, max: 50, label: 'Good', color: '#15803d',
    advice: 'Air quality is good. Enjoy outdoor activities as normal.',
    sensitive: 'No precautions needed for anyone.' },
  { min: 51, max: 100, label: 'Satisfactory', color: '#65a30d',
    advice: 'Acceptable air quality. Unusually sensitive people should consider reducing prolonged outdoor exertion.',
    sensitive: 'Children, elderly and people with asthma: fine outdoors, but take it easier than usual.' },
  { min: 101, max: 200, label: 'Moderate', color: '#a16207',
    advice: 'Sensitive groups may feel effects. Reduce prolonged or heavy outdoor exertion.',
    sensitive: 'Children, elderly and people with asthma: keep outdoor time shorter and avoid the worst hours.' },
  { min: 201, max: 300, label: 'Poor', color: '#c2410c',
    advice: 'Everyone may begin to feel health effects. Reduce outdoor exertion; sensitive groups should avoid it.',
    sensitive: 'Children, elderly and people with asthma: stay indoors as much as possible and wear an N95 mask outside.' },
  { min: 301, max: 400, label: 'Very Poor', color: '#b91c1c',
    advice: 'Health effects are likely for everyone. Avoid outdoor exertion; stay indoors where you can.',
    sensitive: 'Children, elderly and people with asthma: stay indoors, keep inhalers handy, and wear an N95 mask if you must go out.' },
  { min: 401, max: 500, label: 'Severe', color: '#6b21a8',
    advice: 'Health effects for everyone, even at low exposure. Avoid all outdoor exertion and stay indoors.',
    sensitive: 'Children, elderly and people with asthma: stay indoors, run a purifier, and wear an N95 mask for any essential trip out.' },
];

/* ------------------------------------------------------------------ */
/* Shared validation helpers                                         */
/* ------------------------------------------------------------------ */

/** True for a real number (not NaN, not Infinity, not a string). */
function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Longest commute the maths handles, in km. */
const MAX_COMMUTE_KM = 100;

/** Clamp a commute distance to 0–100 km; non-numeric input counts as 0. */
function clampKm(km) {
  return Math.max(0, Math.min(MAX_COMMUTE_KM, Number(km) || 0));
}

/**
 * CPCB band for an AQI value. Returns null for a missing / non-numeric /
 * negative value; a value above 500 is still "Severe" (the scale caps at 500).
 */
function categoriseAQI(aqi) {
  if (!isValidNumber(aqi) || aqi < 0) return null;
  const v = Math.min(Math.round(aqi), 500);
  // The bands cover 0–500 contiguously, so the lookup always finds one.
  return AQI_BANDS.find((b) => v >= b.min && v <= b.max);
}

/* ------------------------------------------------------------------ */
/* PM2.5 → CPCB AQI (standard CPCB 24-hour PM2.5 breakpoints)          */
/* ------------------------------------------------------------------ */

// [low conc, high conc, low AQI, high AQI] — linear interpolation inside a band.
const PM25_BREAKPOINTS = [
  [0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200],
  [91, 120, 201, 300], [121, 250, 301, 400], [251, 500, 401, 500],
];

/** Approximate CPCB AQI from a PM2.5 concentration (µg/m³). Null if invalid. */
function pm25ToAQI(pm25) {
  if (!isValidNumber(pm25) || pm25 < 0) return null;
  if (pm25 > 500) return 500;
  // The last breakpoint covers up to 500, so the loop always returns here.
  for (const [cLo, cHi, aLo, aHi] of PM25_BREAKPOINTS) {
    if (pm25 <= cHi) {
      return Math.round(aLo + ((pm25 - cLo) / (cHi - cLo)) * (aHi - aLo));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Bundled city data — representative winter-smog sample values        */
/* ------------------------------------------------------------------ */

// Diurnal shape of PM2.5 (multiplier per hour): worst in the early morning
// and late evening (inversion + traffic + biomass burning), cleanest in the
// early afternoon when the air mixes. Same shape for every city, scaled to
// that city's PM2.5, so the best window is always the afternoon.
const HOURLY_SHAPE = [
  1.05, 1.00, 0.95, 0.90, 0.90, 0.95, 1.15, 1.30, 1.35, 1.25, 1.10, 1.00,
  0.90, 0.80, 0.72, 0.70, 0.75, 0.90, 1.05, 1.20, 1.30, 1.35, 1.25, 1.15,
];

const CITY_DEFS = [
  { key: 'delhi',     name: 'Delhi',     lat: 28.61, lon: 77.21, pm25: 300, pm10: 420 },
  { key: 'lucknow',   name: 'Lucknow',   lat: 26.85, lon: 80.95, pm25: 200, pm10: 310 },
  { key: 'kanpur',    name: 'Kanpur',    lat: 26.45, lon: 80.33, pm25: 230, pm10: 340 },
  { key: 'patna',     name: 'Patna',     lat: 25.59, lon: 85.14, pm25: 185, pm10: 290 },
  { key: 'amritsar',  name: 'Amritsar',  lat: 31.63, lon: 74.87, pm25: 160, pm10: 250 },
  { key: 'indore',    name: 'Indore',    lat: 22.72, lon: 75.86, pm25: 92,  pm10: 150 },
  { key: 'bhopal',    name: 'Bhopal',    lat: 23.26, lon: 77.41, pm25: 88,  pm10: 145 },
  { key: 'kolkata',   name: 'Kolkata',   lat: 22.57, lon: 88.36, pm25: 115, pm10: 190 },
  { key: 'ahmedabad', name: 'Ahmedabad', lat: 23.02, lon: 72.57, pm25: 105, pm10: 170 },
  { key: 'jaipur',    name: 'Jaipur',    lat: 26.91, lon: 75.79, pm25: 118, pm10: 185 },
  { key: 'mumbai',    name: 'Mumbai',    lat: 19.08, lon: 72.88, pm25: 85,  pm10: 140 },
  { key: 'pune',      name: 'Pune',      lat: 18.52, lon: 73.86, pm25: 75,  pm10: 120 },
  { key: 'bengaluru', name: 'Bengaluru', lat: 12.97, lon: 77.59, pm25: 62,  pm10: 105 },
  { key: 'hyderabad', name: 'Hyderabad', lat: 17.39, lon: 78.49, pm25: 65,  pm10: 110 },
  { key: 'chennai',   name: 'Chennai',   lat: 13.08, lon: 80.27, pm25: 45,  pm10: 75 },
];

/** Hourly PM2.5 for a city from its daily PM2.5 and the diurnal shape. */
function buildHourly(pm25) {
  return HOURLY_SHAPE.map((m) => Math.round(pm25 * m));
}

/** One full bundled-city record, with AQI derived from its PM2.5. */
function buildCity(def) {
  const hourly = buildHourly(def.pm25);
  return {
    ...def,
    aqi: pm25ToAQI(def.pm25),
    hourly,
    // Tomorrow's sample: the same shape, 10% cleaner (a mild improvement).
    tomorrow: hourly.map((v) => Math.round(v * 0.9)),
    source: 'bundled sample',
  };
}

const CITIES = CITY_DEFS.map(buildCity);

/** Bundled city by key; unknown keys fall back to Delhi (the smog story). */
function getCity(key) {
  return CITIES.find((c) => c.key === key) || CITIES[0];
}

/** Haversine distance in km between two lat/lon points. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * The nearest bundled city to a lat/lon (used for browser geolocation).
 * Returns the city key, or null for invalid coordinates.
 */
function nearestCity(lat, lon) {
  if (!isValidNumber(lat) || !isValidNumber(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  let best = null, bestDist = Infinity;
  for (const c of CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best.key;
}

/* ------------------------------------------------------------------ */
/* Outdoor windows                                                     */
/* ------------------------------------------------------------------ */

/** "2 PM" style label for an hour 0–23. */
function fmtHour(h) {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return '12 AM';
  if (hh < 12) return `${hh} AM`;
  if (hh === 12) return '12 PM';
  return `${hh - 12} PM`;
}

/**
 * The extreme 2-hour window in a 24-value hourly PM2.5 array — the one
 * helper behind both bestOutdoorWindow and worstOutdoorWindow.
 * `better(candidateAvg, currentAvg)` picks which extreme wins; ties
 * resolve to the earliest window, so the result is deterministic.
 * Returns { start, end, avgPm25 } or null for a missing / short / invalid array.
 */
function extremeWindow(hourly, better) {
  if (!Array.isArray(hourly) || hourly.length < 2 ||
      !hourly.every((v) => isValidNumber(v) && v >= 0)) return null;
  let best = null;
  for (let i = 0; i < hourly.length - 1; i++) {
    const avg = (hourly[i] + hourly[i + 1]) / 2;
    if (!best || better(avg, best.avgPm25)) best = { start: i, end: i + 2, avgPm25: Math.round(avg) };
  }
  return best;
}

/** The cleanest 2-hour window in a 24-value hourly PM2.5 array. */
function bestOutdoorWindow(hourly) {
  return extremeWindow(hourly, (a, b) => a < b);
}

/** The dirtiest 2-hour window — same shape as bestOutdoorWindow. */
function worstOutdoorWindow(hourly) {
  return extremeWindow(hourly, (a, b) => a > b);
}

/* ------------------------------------------------------------------ */
/* Impact maths — exposure avoided and CO2 saved                       */
/* ------------------------------------------------------------------ */

// CO2 per passenger-km, grams (rough Indian averages, labelled as such in
// the UI and README — the comparison, not the exact gram, is the point).
const CO2_G_PER_KM = { car: 120, 'two-wheeler': 40, bus: 30, metro: 10, 'walk-cycle': 0, none: 0 };

// Modes that count as low-emission for the commute recommendation.
const LOW_EMISSION_MODES = ['bus', 'metro', 'walk-cycle'];
// Display labels for the commute modes, in the order the picker shows them.
const MODE_LABELS = { metro: 'metro', bus: 'bus', 'walk-cycle': 'walking / cycling' };
// Labels for the vehicle picker (the picker is built from this, so the list
// lives in exactly one place).
const VEHICLE_LABELS = {
  car: 'Car (petrol)', 'two-wheeler': 'Two-wheeler', bus: 'Bus',
  metro: 'Metro', 'walk-cycle': 'Walking / cycling',
};

/**
 * The commute mode the plan recommends: keep a low-emission mode, or the
 * metro for a car / two-wheeler. One function, used by generateRoutine
 * and by the weekly-savings summary in the UI, so the two can never disagree.
 */
function recommendedCommuteMode(vehicle) {
  return LOW_EMISSION_MODES.includes(vehicle) ? vehicle : 'metro';
}

/**
 * CO2 saved per day (kg) by taking `mode` instead of a petrol car for a
 * `km`-long round trip. 0 when the mode is already a car, or the inputs
 * are missing/invalid.
 */
function co2SavedKg(mode, km) {
  const distance = clampKm(km);
  const modeFactor = CO2_G_PER_KM[mode] ?? CO2_G_PER_KM.car;
  return Math.round(((CO2_G_PER_KM.car - modeFactor) * distance) / 100) / 10;
}

/**
 * PM2.5 inhaled avoided (µg, rough) by moving 1 hour of moderate outdoor
 * activity from the worst window to the best window. Assumes ~1.5 m³ of air
 * breathed per hour of moderate activity. 0 when the windows do not differ.
 */
function exposureAvoided(bestAvg, worstAvg) {
  const diff = (Number(worstAvg) || 0) - (Number(bestAvg) || 0);
  return Math.max(0, Math.round(diff * 1.5));
}

/* ------------------------------------------------------------------ */
/* Indoor AQI hacks                                                    */
/* ------------------------------------------------------------------ */

const INDOOR_HACKS = [
  { id: 'box-fan', title: 'DIY box-fan purifier',
    detail: 'Tape a MERV-13 / HEPA filter to the back of a box fan and run it in the main room.',
    impact: 'Can cut indoor PM2.5 by roughly 50–80% in one room — the biggest single win.' },
  { id: 'wet-mop', title: 'Wet-mop, don’t dry-sweep',
    detail: 'Mop floors with a damp cloth instead of sweeping, which throws settled dust back into the air.',
    impact: 'Keeps settled dust from becoming airborne again; a small but real cut in resuspended PM.' },
  { id: 'seal-gaps', title: 'Seal gaps around windows and doors',
    detail: 'Tape, towels, or draft excluders on the gaps where smog leaks in.',
    impact: 'Reduces outdoor smog leaking in — biggest win on Severe and Very Poor days.' },
  { id: 'vent-window', title: 'Ventilate only in the best window',
    detail: 'Open windows for 20–30 minutes in the afternoon, when outdoor PM2.5 is lowest; shut them for the rest of the day.',
    impact: 'Flushes stale indoor air using the cleanest outdoor air of the day, not the dirtiest.' },
  { id: 'no-burn', title: 'No burning indoors',
    detail: 'Skip incense, candles, mosquito coils, and biomass cooking while the smog lasts.',
    impact: 'One incense stick can push a room’s PM2.5 past outdoor levels — skipping it removes a major indoor source.' },
  { id: 'plants', title: 'Indoor plants (for mood, not for PM2.5)',
    detail: 'Keep plants if you like them — they help mood and humidity.',
    impact: 'Honest note: plants do not measurably cut PM2.5. They are not a substitute for a purifier.' },
];

/* ------------------------------------------------------------------ */
/* Routine planner                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build a low-emission day plan from a household profile and a city's data.
 *
 * profile: { children, elderly, asthma, outdoorWorker, commuter,
 *            vehicle: 'car' | 'two-wheeler' | 'bus' | 'metro' | 'walk-cycle',
 *            commuteKm }
 * city: a bundled city record (or a live-data record with the same shape).
 *
 * Returns { city, aqi, band, best, worst, items } where every item is
 * { time, title, detail, impact } — the impact is the direct, quantified
 * consequence of that choice, never a bare instruction.
 */
function generateRoutine(profile, city) {
  const kmRaw = Number(profile.commuteKm);
  const p = {
    children: !!profile.children, elderly: !!profile.elderly,
    asthma: !!profile.asthma, outdoorWorker: !!profile.outdoorWorker,
    commuter: !!profile.commuter,
    vehicle: CO2_G_PER_KM[profile.vehicle] !== undefined ? profile.vehicle : 'car',
    commuteKm: Math.max(1, Math.min(MAX_COMMUTE_KM, Number.isFinite(kmRaw) ? kmRaw : 10)),
  };
  const c = city || CITIES[0];
  const band = categoriseAQI(c.aqi) || AQI_BANDS[2];
  const best = bestOutdoorWindow(c.hourly) || { start: 14, end: 16, avgPm25: c.pm25 };
  const worst = worstOutdoorWindow(c.hourly) || { start: 7, end: 9, avgPm25: c.pm25 };
  const avoided = exposureAvoided(best.avgPm25, worst.avgPm25);
  const bestLabel = `${fmtHour(best.start)}–${fmtHour(best.end)}`;
  const worstLabel = `${fmtHour(worst.start)}–${fmtHour(worst.end)}`;

  const items = [];
  const add = (time, title, detail, impact) => items.push({ time, title, detail, impact });

  if (c.aqi >= 301) {
    add('All day', 'Severe-day rule: stay indoors as much as possible',
      `AQI ${c.aqi} (${band.label}) — outdoor air is harmful for everyone today, not just sensitive groups.`,
      'Staying indoors with windows shut and a purifier running cuts your PM2.5 exposure far more than any single outdoor change.');
  }

  add(bestLabel, 'Best outdoor window — exercise, walk, errands',
    `Do outdoor activity between ${fmtHour(best.start)} and ${fmtHour(best.end)}, when PM2.5 is ≈ ${best.avgPm25} µg/m³ — the cleanest part of the day.`,
    `Shifting 1 hour outdoors here avoids ≈ ${avoided} µg of PM2.5 inhaled, vs the worst window (${worstLabel}, ≈ ${worst.avgPm25} µg/m³).`);

  add(bestLabel, 'Ventilate the home',
    `Open windows for 20–30 minutes in the ${bestLabel} window, then shut them — especially during the ${worstLabel} smog peak.`,
    'You flush stale indoor air with the cleanest outdoor air of the day instead of the dirtiest.');

  if (p.commuter) {
    const recommended = recommendedCommuteMode(p.vehicle);
    const lowEmission = recommended === p.vehicle;
    const saved = co2SavedKg(recommended, p.commuteKm);
    const modeLabel = MODE_LABELS[recommended];
    add('Commute',
      lowEmission
        ? `Commute: keep the ${modeLabel} — already low-emission`
        : `Commute: take the metro instead of the ${p.vehicle === 'car' ? 'car' : 'two-wheeler'}`,
      lowEmission
        ? `${p.commuteKm} km round trip by ${modeLabel} — no car involved.`
        : `${p.commuteKm} km round trip by ${modeLabel} instead of by ${p.vehicle}.`,
      saved > 0
        ? `Saves ≈ ${saved} kg of CO2 per day (≈ ${(saved * 5).toFixed(1)} kg per work week) vs driving — and keeps you out of the worst traffic-hour smog.`
        : 'Already a low-emission commute — no CO2 to save vs driving, and no extra smog exposure.');
  }

  // One item per sensitive group, each with its own timing and impact.
  const flagItems = [
    { flag: 'children', build: () => add('All day', 'Children: no outdoor play today',
      `AQI ${c.aqi} (${band.label}) — keep play indoors; move it to the ${bestLabel} window only if the AQI drops to Moderate or better.`,
      'Children breathe faster and inhale more PM2.5 per kg of body weight than adults, so the same air hits them harder.') },
    { flag: 'elderly', build: () => add(bestLabel, 'Elderly: move the morning walk to the afternoon',
      'The usual early-morning walk lands in the smog peak. Walk in the afternoon window instead, at an easy pace.',
      'Avoids the morning PM2.5 peak entirely — the single biggest exposure cut for an elderly walker.') },
    { flag: 'asthma', build: () => add('All day', 'Asthma / breathing condition: inhaler + N95',
      'Carry the inhaler, wear an N95 mask for any time outdoors, and avoid the worst window entirely.',
      'An N95 filters ≈ 95% of PM2.5 when fitted well — it turns a harmful outdoor trip into a manageable one.') },
    { flag: 'outdoorWorker', build: () => add(bestLabel, 'Outdoor worker: shift heavy work to the afternoon window',
      `Do the heaviest outdoor tasks between ${fmtHour(best.start)} and ${fmtHour(best.end)}, wear an N95 mask, and take breaks indoors every hour.`,
      `Working in the best window instead of the morning peak avoids ≈ ${avoided} µg of PM2.5 inhaled per hour of work.`) },
  ];
  for (const { flag, build } of flagItems) if (p[flag]) build();

  add('Before you leave', 'Check the AQI before stepping out',
    'Look at today’s AQI and the best/worst windows above — a 10-second check decides whether to mask up or wait.',
    'The cheapest habit in this plan: it costs nothing and prevents the worst-timed exposure of the day.');

  return { city: c.name, aqi: c.aqi, band: band.label, best, worst, items };
}

/* ------------------------------------------------------------------ */
/* Prompt Studio — the exact prompt the app sends to Gemini            */
/* ------------------------------------------------------------------ */

/**
 * The exact prompt the app sends to Gemini — shown and editable in the
 * Prompt Studio, because PromptWars judges prompt craft, not just output.
 * It carries the location and hard numbers (AQI, band, PM2.5, best/worst
 * windows), the household context, and the output contract.
 */
function buildAQIPrompt(profile, city, plan) {
  const p = profile || {};
  const flags = [
    p.children && 'children at home', p.elderly && 'elderly at home',
    p.asthma && 'asthma / respiratory condition', p.outdoorWorker && 'outdoor worker',
    p.commuter && `commuter (${p.vehicle || 'car'}, ${p.commuteKm || 10} km/day)`,
  ].filter(Boolean).join(', ') || 'no sensitive groups';
  const c = city || CITIES[0];
  const best = (plan && plan.best) || bestOutdoorWindow(c.hourly) || { start: 14, end: 16, avgPm25: c.pm25 };
  const worst = (plan && plan.worst) || worstOutdoorWindow(c.hourly) || { start: 7, end: 9, avgPm25: c.pm25 };
  return `You are an air-quality assistant for a family in ${c.name}, India.
Today: AQI ${c.aqi} (${(categoriseAQI(c.aqi) || {}).label || 'Moderate'}), PM2.5 ${c.pm25} µg/m³.
Best outdoor window: ${fmtHour(best.start)}–${fmtHour(best.end)} (PM2.5 ≈ ${best.avgPm25} µg/m³).
Worst window: ${fmtHour(worst.start)}–${fmtHour(worst.end)} (PM2.5 ≈ ${worst.avgPm25} µg/m³).
Household: ${flags}.
Constraints: suggest low-emission daily routines, indoor air-quality hacks, and sustainable alternatives
tailored to this household. Every recommendation must state its direct impact (exposure avoided or CO2 saved).
Give exactly 5 recommendations, one line each, no intro, no generic advice.`;
}

/* ------------------------------------------------------------------ */
/* City comparison — how the bundled cities rank by AQI                */
/* ------------------------------------------------------------------ */

/**
 * All bundled cities ranked worst-first by AQI. Each entry is
 * { rank, key, name, aqi, band, color } — the UI highlights the
 * currently selected city in this list.
 */
function rankCities() {
  const sorted = [...CITIES].sort((a, b) => b.aqi - a.aqi);
  return sorted.map((c, i) => {
    const band = categoriseAQI(c.aqi);
    return {
      rank: i + 1, key: c.key, name: c.name, aqi: c.aqi,
      band: band ? band.label : 'Unknown',
      color: band ? band.color : '#64748b',
    };
  });
}

/* ------------------------------------------------------------------ */
/* Activity checker — can I do this activity at this hour?             */
/* ------------------------------------------------------------------ */

// Breathing rate (m³ of air per hour) for each activity. Intense
// activities and sensitive groups (children, elderly) get stricter
// verdicts, because they inhale more PM2.5 for the same air.
const ACTIVITIES = [
  { id: 'walk', label: 'Easy walk', breathe: 1.1 },
  { id: 'run', label: 'Running / jogging', breathe: 2.6 },
  { id: 'cycle', label: 'Cycling', breathe: 2.2 },
  { id: 'play', label: 'Children playing outside', breathe: 1.6, sensitive: true },
  { id: 'work', label: 'Outdoor work (heavy)', breathe: 2.4 },
  { id: 'elderly-walk', label: 'Elderly walk', breathe: 1.1, sensitive: true },
];

/** Activity record by id; unknown ids fall back to an easy walk. */
function getActivity(id) {
  return ACTIVITIES.find((a) => a.id === id) || ACTIVITIES[0];
}

/**
 * Verdict bands for doing an activity for one hour at a given PM2.5.
 * Each band has the verdict for a normal activity and, where it differs,
 * the stricter verdict for intense or sensitive activity. The thresholds
 * follow the CPCB PM2.5 breakpoints (60 / 90 / 120 / 250); `detail` builds
 * the explanation from the reading, the inhaled dose and the activity.
 */
const ACTIVITY_BANDS = [
  { max: 60, level: 'go', verdict: 'Go ahead',
    detail: (v, dose, what) => `PM2.5 ${v} µg/m³ is Good / Satisfactory — about ${dose} µg inhaled in an hour of ${what}.` },
  { max: 90, level: 'go', verdict: 'Go ahead',
    detail: (v, dose, what) => `PM2.5 ${v} µg/m³ is Moderate — ${what} is fine; intense exercise is the thing to shorten.`,
    intense: { level: 'caution', verdict: 'OK, keep it short',
      detail: (v, dose, what) => `PM2.5 ${v} µg/m³ is Moderate — ${what} is fine for about 30 minutes, but a full hour would inhale ≈ ${dose} µg.` } },
  { max: 120, level: 'caution', verdict: 'OK for 30 min, with an N95',
    detail: (v, dose, what) => `PM2.5 ${v} µg/m³ is Poor — a short, easy outing is manageable with an N95 mask; anything longer, wait for the afternoon window.`,
    intense: { level: 'avoid', verdict: 'Avoid',
      detail: (v, dose, what) => `PM2.5 ${v} µg/m³ is Poor — ${what} would inhale ≈ ${dose} µg in an hour. Move it indoors or to the afternoon window.` } },
  { max: 250, level: 'avoid', verdict: 'Avoid',
    detail: (v, dose, what) => `PM2.5 ${v} µg/m³ is Very Poor — an hour of ${what} would inhale ≈ ${dose} µg. Stay indoors; if you must go out, wear an N95 and keep it brief.` },
  { max: Infinity, level: 'avoid', verdict: 'Avoid — stay indoors',
    detail: (v, dose, what) => `PM2.5 ${v} µg/m³ is Severe — an hour of ${what} would inhale ≈ ${dose} µg. Do not do it outdoors today.` },
];

/**
 * Verdict for doing `activityId` for one hour when PM2.5 is `pm25`.
 * Returns { level: 'go' | 'caution' | 'avoid', verdict, dose, detail }.
 * dose is the rough PM2.5 inhaled in that hour (µg).
 */
function activityVerdict(activityId, pm25) {
  const a = getActivity(activityId);
  const v = (isValidNumber(pm25) && pm25 >= 0) ? pm25 : null;
  if (v === null) {
    return { level: 'avoid', verdict: 'No reading', dose: 0, detail: 'No PM2.5 value for that hour.' };
  }
  const dose = Math.round(v * a.breathe);
  const intense = a.breathe >= 2.2 || a.sensitive;
  const what = a.label.toLowerCase();
  const band = ACTIVITY_BANDS.find((b) => v <= b.max);
  const outcome = (intense && band.intense) ? band.intense : band;
  return { level: outcome.level, verdict: outcome.verdict, dose, detail: outcome.detail(v, dose, what) };
}

/* ------------------------------------------------------------------ */
/* Purifier sizing — CADR for a room                                   */
/* ------------------------------------------------------------------ */

// A DIY box-fan purifier (box fan + MERV-13/HEPA filter) moves roughly
// 350 m³/h of cleaned air — a rough figure, labelled as such in the UI.
const DIY_FAN_CADR_M3H = 350;
// Target 4 air changes per hour (AHAM-style rule of thumb).
const TARGET_AIR_CHANGES_PER_HOUR = 4;

/**
 * Purifier size for a room L×W×H metres.
 * Returns { volumeM3, cadrM3h, fans, note } or null for invalid dims.
 * cadr = room volume × 4 air changes per hour; fans = DIY box fans
 * needed at ~350 m³/h each. A shop purifier should list a CADR ≥ cadr.
 */
function cadrForRoom(lengthM, widthM, heightM = 3) {
  const dims = [lengthM, widthM, heightM].map(Number);
  if (dims.some((d) => !isValidNumber(d) || d <= 0 || d > 20)) return null;
  const volumeM3 = Math.round(dims[0] * dims[1] * dims[2]);
  const cadrM3h = volumeM3 * TARGET_AIR_CHANGES_PER_HOUR;
  const fans = Math.max(1, Math.ceil(cadrM3h / DIY_FAN_CADR_M3H));
  return {
    volumeM3, cadrM3h, fans,
    note: fans === 1
      ? 'One DIY box-fan purifier covers this room at 4 air changes per hour.'
      : `${fans} DIY box-fan purifiers (or one purifier rated ≥ ${cadrM3h} m³/h) cover this room at 4 air changes per hour.`,
  };
}

/* ------------------------------------------------------------------ */
/* Commute savings — CO2 and money, per week                           */
/* ------------------------------------------------------------------ */

// Rough cost per km in rupees (Indian averages, labelled as such in the
// UI): petrol car ₹105/L at 15 km/L ≈ ₹7/km; two-wheeler ₹105/L at
// 50 km/L ≈ ₹2.1/km; bus and metro fares average ≈ ₹1.5 and ₹2 per km;
// walking / cycling is free.
const COST_RS_PER_KM = { car: 7, 'two-wheeler': 2.1, bus: 1.5, metro: 2, 'walk-cycle': 0 };

/**
 * Weekly savings from taking `mode` instead of a petrol car for a `km`
 * round trip, `daysPerWeek` days a week. Returns
 * { co2PerDayKg, co2PerWeekKg, moneyPerDayRs, moneyPerWeekRs }.
 * All zeros when the mode is already a car or the inputs are invalid.
 */
function commuteSavings(mode, km, daysPerWeek = 5) {
  const distance = clampKm(km);
  const days = Math.max(0, Math.min(7, Number(daysPerWeek) || 0));
  const m = CO2_G_PER_KM[mode] !== undefined ? mode : 'car';
  const co2PerDayKg = co2SavedKg(m, distance);
  const moneyPerDayRs = Math.max(0, Math.round(((COST_RS_PER_KM.car - COST_RS_PER_KM[m]) * distance) * 10) / 10);
  return {
    co2PerDayKg,
    co2PerWeekKg: Math.round(co2PerDayKg * days * 10) / 10,
    moneyPerDayRs,
    moneyPerWeekRs: Math.round(moneyPerDayRs * days),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AQI_BANDS, categoriseAQI, pm25ToAQI, CITIES, getCity, nearestCity,
    bestOutdoorWindow, worstOutdoorWindow, fmtHour, generateRoutine,
    co2SavedKg, exposureAvoided, INDOOR_HACKS, buildAQIPrompt,
    rankCities, ACTIVITIES, getActivity, activityVerdict,
    cadrForRoom, commuteSavings, recommendedCommuteMode, VEHICLE_LABELS,
  };
}
