// tests/aqi.test.js — run with:  node tests/aqi.test.js
// Uses only Node's built-in assert. No dependencies.
const assert = require('assert');
const {
  AQI_BANDS, categoriseAQI, pm25ToAQI, CITIES, getCity, nearestCity,
  bestOutdoorWindow, worstOutdoorWindow, fmtHour, generateRoutine,
  co2SavedKg, exposureAvoided, INDOOR_HACKS, buildAQIPrompt,
  rankCities, ACTIVITIES, getActivity, activityVerdict,
  cadrForRoom, commuteSavings,
} = require('../aqi.js');

// 1. AQI categories at every CPCB band boundary
const boundaries = [
  [0, 'Good'], [50, 'Good'], [51, 'Satisfactory'], [100, 'Satisfactory'],
  [101, 'Moderate'], [200, 'Moderate'], [201, 'Poor'], [300, 'Poor'],
  [301, 'Very Poor'], [400, 'Very Poor'], [401, 'Severe'], [500, 'Severe'],
];
for (const [aqi, label] of boundaries) {
  assert.strictEqual(categoriseAQI(aqi).label, label, `AQI ${aqi} must be ${label}`);
}
assert.strictEqual(categoriseAQI(600).label, 'Severe', 'above 500 is still Severe');
assert.strictEqual(categoriseAQI(-5), null, 'negative AQI is invalid');
assert.strictEqual(categoriseAQI(NaN), null, 'NaN AQI is invalid');
assert.strictEqual(categoriseAQI('bad'), null, 'non-numeric AQI is invalid');
assert.strictEqual(AQI_BANDS.length, 6, 'exactly six CPCB bands');

// 2. PM2.5 → AQI at the CPCB breakpoints
const pm25Cases = [
  [0, 0], [30, 50], [31, 51], [60, 100], [61, 101], [90, 200],
  [91, 201], [120, 300], [121, 301], [250, 400], [251, 401], [500, 500],
];
for (const [pm25, aqi] of pm25Cases) {
  assert.strictEqual(pm25ToAQI(pm25), aqi, `PM2.5 ${pm25} must map to AQI ${aqi}`);
}
assert.strictEqual(pm25ToAQI(600), 500, 'PM2.5 above 500 caps the AQI at 500');
assert.strictEqual(pm25ToAQI(-1), null, 'negative PM2.5 is invalid');
assert.strictEqual(pm25ToAQI(NaN), null, 'NaN PM2.5 is invalid');

// 3. Bundled cities: fifteen, consistent, with 24 hourly values each
assert.strictEqual(CITIES.length, 15, 'fifteen bundled Indian cities');
for (const c of CITIES) {
  assert.strictEqual(c.hourly.length, 24, `${c.name} needs 24 hourly values`);
  assert.strictEqual(c.tomorrow.length, 24, `${c.name} needs 24 tomorrow values`);
  assert.strictEqual(c.aqi, pm25ToAQI(c.pm25), `${c.name} AQI must derive from its PM2.5`);
  assert.ok(categoriseAQI(c.aqi), `${c.name} AQI must fall in a band`);
  assert.ok(c.lat >= 8 && c.lat <= 35 && c.lon >= 68 && c.lon <= 97, `${c.name} needs Indian coordinates`);
}
assert.strictEqual(getCity('delhi').band, undefined, 'city records carry aqi, not band (band is derived)');
assert.strictEqual(categoriseAQI(getCity('delhi').aqi).label, 'Severe', 'Delhi sample must be Severe');
assert.strictEqual(getCity('delhi').aqi, 420, 'Delhi PM2.5 300 must map to AQI 420');
assert.strictEqual(categoriseAQI(getCity('chennai').aqi).label, 'Satisfactory', 'Chennai sample must be Satisfactory');
assert.strictEqual(categoriseAQI(getCity('pune').aqi).label, 'Moderate', 'Pune sample must be Moderate');
assert.strictEqual(getCity('unknown-city').key, 'delhi', 'unknown city key falls back to Delhi');

// 4. Nearest city from coordinates
assert.strictEqual(nearestCity(28.6, 77.2), 'delhi', 'coords near Delhi must map to Delhi');
assert.strictEqual(nearestCity(18.5, 73.9), 'pune', 'coords near Pune must map to Pune');
assert.strictEqual(nearestCity(13.0, 80.3), 'chennai', 'coords near Chennai must map to Chennai');
assert.strictEqual(nearestCity(NaN, 77), null, 'NaN latitude is invalid');
assert.strictEqual(nearestCity(200, 77), null, 'latitude above 90 is invalid');

// 5. Best / worst outdoor windows on the Delhi shape
const delhi = getCity('delhi');
const best = bestOutdoorWindow(delhi.hourly);
const worst = worstOutdoorWindow(delhi.hourly);
assert.deepStrictEqual(best, { start: 14, end: 16, avgPm25: 213 }, 'best window must be the 2–4 PM afternoon dip');
assert.deepStrictEqual(worst, { start: 7, end: 9, avgPm25: 398 }, 'worst window must be the 7–9 AM morning peak');
assert.ok(best.avgPm25 < worst.avgPm25, 'best window must be cleaner than worst');
assert.deepStrictEqual(bestOutdoorWindow([50, 40, 30, 20]), { start: 2, end: 4, avgPm25: 25 });
assert.deepStrictEqual(worstOutdoorWindow([50, 40, 30, 20]), { start: 0, end: 2, avgPm25: 45 });
assert.deepStrictEqual(bestOutdoorWindow(new Array(24).fill(100)), { start: 0, end: 2, avgPm25: 100 }, 'flat data resolves ties to the earliest window');
assert.strictEqual(bestOutdoorWindow([42]), null, 'a single value cannot form a window');
assert.strictEqual(bestOutdoorWindow([]), null, 'empty data has no window');
assert.strictEqual(bestOutdoorWindow(null), null, 'missing data has no window');
assert.strictEqual(worstOutdoorWindow([10, -5, 20]), null, 'negative values are invalid');

// 6. Hour labels
assert.strictEqual(fmtHour(0), '12 AM');
assert.strictEqual(fmtHour(12), '12 PM');
assert.strictEqual(fmtHour(14), '2 PM');
assert.strictEqual(fmtHour(23), '11 PM');

// 7. CO2 saved vs driving a petrol car
assert.strictEqual(co2SavedKg('metro', 10), 1.1, 'metro for 10 km saves 1.1 kg CO2/day');
assert.strictEqual(co2SavedKg('two-wheeler', 10), 0.8, 'two-wheeler for 10 km saves 0.8 kg CO2/day');
assert.strictEqual(co2SavedKg('car', 10), 0, 'driving saves nothing vs driving');
assert.strictEqual(co2SavedKg('walk-cycle', 10), 1.2, 'walking/cycling for 10 km saves 1.2 kg CO2/day');
assert.strictEqual(co2SavedKg('metro', 0), 0, 'zero distance saves zero');
assert.strictEqual(co2SavedKg('unknown-mode', 10), 0, 'unknown mode falls back to car');

// 8. Exposure avoided by shifting one hour outdoors
assert.strictEqual(exposureAvoided(213, 398), 278, 'Delhi worst→best shift avoids 278 µg in one hour');
assert.strictEqual(exposureAvoided(100, 100), 0, 'identical windows avoid nothing');
assert.strictEqual(exposureAvoided(200, 100), 0, 'a worse "best" window never goes negative');

// 9. Routine generation — Delhi, full household profile
const full = generateRoutine(
  { children: true, elderly: true, asthma: true, outdoorWorker: true, commuter: true, vehicle: 'car', commuteKm: 10 },
  delhi,
);
assert.strictEqual(full.city, 'Delhi');
assert.strictEqual(full.aqi, 420);
assert.strictEqual(full.band, 'Severe');
assert.ok(full.items.some((i) => i.title.startsWith('Severe-day rule')), 'a Severe day must open with the stay-indoors rule');
assert.ok(full.items.some((i) => i.title.includes('Children')), 'children flag must add a children item');
assert.ok(full.items.some((i) => i.title.includes('Elderly')), 'elderly flag must add an elderly item');
assert.ok(full.items.some((i) => i.title.includes('Asthma')), 'asthma flag must add an asthma item');
assert.ok(full.items.some((i) => i.title.includes('Outdoor worker')), 'outdoor-worker flag must add a worker item');
const commute = full.items.find((i) => i.time === 'Commute');
assert.ok(commute.title.includes('metro instead of the car'), 'a car commuter must be steered to the metro');
assert.ok(commute.impact.includes('1.1 kg'), 'the commute impact must state the 1.1 kg CO2 saving');
const windowItem = full.items.find((i) => i.title.startsWith('Best outdoor window'));
assert.ok(windowItem.impact.includes('278'), 'the window impact must state the 278 µg exposure avoided');
for (const item of full.items) {
  for (const field of ['time', 'title', 'detail', 'impact']) {
    assert.ok(typeof item[field] === 'string' && item[field].length > 0, `every routine item needs a non-empty ${field}`);
  }
}

// 10. Routine generation — low-emission commuter, clean city, empty profile
const clean = generateRoutine(
  { commuter: true, vehicle: 'walk-cycle', commuteKm: 8 }, getCity('chennai'),
);
assert.strictEqual(clean.band, 'Satisfactory');
assert.ok(!clean.items.some((i) => i.title.startsWith('Severe-day rule')), 'a Satisfactory day has no stay-indoors rule');
const cleanCommute = clean.items.find((i) => i.time === 'Commute');
assert.ok(cleanCommute.title.includes('keep the walking / cycling'), 'a walking commuter is told to keep it');
assert.ok(!cleanCommute.title.includes('instead of'), 'a low-emission commute must not say "instead of" itself');
const empty = generateRoutine({}, getCity('pune'));
assert.ok(empty.items.length >= 3, 'an empty profile still gets the window, ventilation and check items');
assert.ok(!empty.items.some((i) => i.time === 'Commute'), 'a non-commuter gets no commute item');
const clamped = generateRoutine({ commuter: true, vehicle: 'car', commuteKm: 0 }, delhi);
assert.ok(clamped.items.find((i) => i.time === 'Commute').detail.includes('1 km'), 'a zero commute distance clamps to 1 km');

// 11. Indoor hacks — six, each with a real impact note
assert.strictEqual(INDOOR_HACKS.length, 6, 'six indoor hacks');
for (const h of INDOOR_HACKS) {
  assert.ok(h.title && h.detail && h.impact, `hack ${h.id} needs title, detail and impact`);
}
assert.ok(INDOOR_HACKS.find((h) => h.id === 'plants').impact.includes('do not measurably cut PM2.5'),
  'the plants hack must be honest that it does not cut PM2.5');
assert.ok(INDOOR_HACKS.find((h) => h.id === 'box-fan').impact.includes('50–80%'),
  'the box-fan hack must carry its rough reduction figure');

// 12. The Gemini prompt carries the user's context
const prompt = buildAQIPrompt(
  { children: true, asthma: true, commuter: true, vehicle: 'car', commuteKm: 12 },
  delhi, full,
);
assert.ok(prompt.includes('Delhi') && prompt.includes('420'), 'prompt must include city and AQI');
assert.ok(prompt.includes('children') && prompt.includes('asthma'), 'prompt must include household flags');
assert.ok(prompt.includes('2 PM') && prompt.includes('7 AM'), 'prompt must include the best and worst windows');
assert.ok(prompt.includes('exactly 5 recommendations'), 'prompt must set the output contract');
assert.ok(!prompt.includes('[object Object]'), 'prompt must not contain [object Object]');

// 13. City ranking — worst first, Delhi on top, Chennai at the bottom
const ranked = rankCities();
assert.strictEqual(ranked.length, 15, 'ranking covers all fifteen cities');
assert.strictEqual(ranked[0].name, 'Delhi');
assert.strictEqual(ranked[0].aqi, 420);
assert.strictEqual(ranked[0].rank, 1);
assert.strictEqual(ranked[14].name, 'Chennai');
assert.strictEqual(ranked[14].rank, 15);
for (let i = 0; i < ranked.length - 1; i++) {
  assert.ok(ranked[i].aqi >= ranked[i + 1].aqi, 'ranking must be worst-first');
}
assert.strictEqual(getCity('kanpur').aqi, 385, 'Kanpur PM2.5 230 must map to AQI 385');
assert.strictEqual(getCity('indore').aqi, 204, 'Indore PM2.5 92 must map to AQI 204');
assert.strictEqual(ranked.find((r) => r.key === 'kanpur').band, 'Very Poor');

// 14. Activity checker — verdict follows the CPCB band, tightened for intense/sensitive activity
assert.deepStrictEqual(activityVerdict('walk', 50), {
  level: 'go', verdict: 'Go ahead', dose: 55,
  detail: 'PM2.5 50 µg/m³ is Good / Satisfactory — about 55 µg inhaled in an hour of easy walk.',
});
assert.strictEqual(activityVerdict('run', 300).level, 'avoid');
assert.strictEqual(activityVerdict('run', 300).verdict, 'Avoid — stay indoors');
assert.strictEqual(activityVerdict('run', 300).dose, 780);
assert.strictEqual(activityVerdict('play', 100).level, 'avoid', 'children playing in Poor air must be avoided');
assert.strictEqual(activityVerdict('play', 100).dose, 160);
assert.strictEqual(activityVerdict('walk', 100).level, 'caution', 'an easy walk in Poor air is a caution, not a ban');
assert.strictEqual(activityVerdict('walk', 100).verdict, 'OK for 30 min, with an N95');
assert.strictEqual(activityVerdict('run', 80).level, 'caution', 'running in Moderate air must be shortened');
assert.strictEqual(activityVerdict('cycle', 270).level, 'avoid');
assert.strictEqual(activityVerdict('walk', null).verdict, 'No reading');
assert.strictEqual(activityVerdict('walk', -5).verdict, 'No reading');
assert.strictEqual(getActivity('unknown-activity').id, 'walk', 'unknown activity falls back to an easy walk');
assert.strictEqual(ACTIVITIES.length, 6, 'six activities in the checker');

// 15. Purifier sizing — CADR is room volume × 4 air changes per hour
assert.deepStrictEqual(cadrForRoom(4, 3, 3), {
  volumeM3: 36, cadrM3h: 144, fans: 1,
  note: 'One DIY box-fan purifier covers this room at 4 air changes per hour.',
});
assert.deepStrictEqual(cadrForRoom(10, 8, 3).fans, 3, 'a 240 m³ room needs 3 DIY fans (960 / 350)');
assert.strictEqual(cadrForRoom(10, 8, 3).cadrM3h, 960);
assert.deepStrictEqual(cadrForRoom(4, 3), cadrForRoom(4, 3, 3), 'height defaults to 3 m');
assert.strictEqual(cadrForRoom(0, 3, 3), null, 'a zero dimension is invalid');
assert.strictEqual(cadrForRoom(25, 3, 3), null, 'a dimension above 20 m is invalid');

// 16. Commute savings — CO2 and money per week vs driving a petrol car
assert.deepStrictEqual(commuteSavings('metro', 10, 5), {
  co2PerDayKg: 1.1, co2PerWeekKg: 5.5, moneyPerDayRs: 50, moneyPerWeekRs: 250,
});
assert.deepStrictEqual(commuteSavings('walk-cycle', 10, 5), {
  co2PerDayKg: 1.2, co2PerWeekKg: 6, moneyPerDayRs: 70, moneyPerWeekRs: 350,
});
assert.deepStrictEqual(commuteSavings('car', 10, 5), {
  co2PerDayKg: 0, co2PerWeekKg: 0, moneyPerDayRs: 0, moneyPerWeekRs: 0,
});
assert.deepStrictEqual(commuteSavings('metro', 0, 5), {
  co2PerDayKg: 0, co2PerWeekKg: 0, moneyPerDayRs: 0, moneyPerWeekRs: 0,
});

console.log('All AQI tests passed.');
