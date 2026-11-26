# BreatheEasy — Urban Air Quality Assistant

**PromptWars Virtual · Challenge 06 — Urban Air Quality Assistant**
A smart, dynamic assistant that helps families and communities navigate
severe winter smog. It does not just show a number — it turns the AQI into
a day plan: when to go out, how to commute, when to open the windows, and
what to do indoors, with the direct impact of each choice stated in plain
numbers.

**Live app:** https://kuntalsaha05.github.io/breatheeasy-aqi-assistant/
**Repository rules check:** public · single branch (`main`) · total size ≈ 94 KB (limit 10 MB)

---

## 1. Chosen vertical

**Urban Air Quality Assistant** — one vertical, three personas inside it:

| Persona | Who they are | What they struggle with |
|---|---|---|
| Family with children / elderly at home | Parents deciding whether kids play outside, whether grandparents walk in the morning | "Is it safe to go out now?" — and what to do instead |
| Daily commuter | Travels 10 km to work through traffic-hour smog | Whether the car is worth it, and when the air is least bad |
| Outdoor worker | Works outside most of the day (delivery, construction, street vending) | Cannot stay indoors — needs the least-bad hours and a mask plan |

The assistant adapts to the household: the same city produces a different
day plan for a family with an asthmatic child than for a solo commuter —
different outdoor windows, different commute advice, different indoor hacks.

## 2. Approach and logic

The core idea: **deterministic air-quality logic + an inspectable GenAI layer.**

- **One scale, documented** — the **CPCB (India) AQI bands** (Good 0–50,
  Satisfactory 51–100, Moderate 101–200, Poor 201–300, Very Poor 301–400,
  Severe 401–500). PM2.5 is converted to AQI with the standard CPCB
  24-hour PM2.5 breakpoints and linear interpolation inside each band, so
  the bundled AQI for every city is derived from its PM2.5, never
  hand-typed — the two can never disagree.
- **The day has a shape** — hourly PM2.5 follows a diurnal pattern: worst
  in the early morning and late evening (inversion + traffic + biomass
  burning), cleanest in the early afternoon when the air mixes. The best
  and worst 2-hour windows are computed from the hourly series, not
  asserted, so the "go out at 2–4 PM" advice is a calculation.
- **Every recommendation states its impact** (`aqi.js`, pure functions, no
  DOM, no network):
  - *Exposure avoided* — shifting one hour of moderate outdoor activity
    from the worst window to the best avoids ≈ (worst − best) PM2.5 ×
    1.5 m³ of air breathed per hour, in micrograms. Delhi's worst→best
    shift is ≈ 278 µg in one hour.
  - *CO2 saved* — taking the metro instead of a petrol car saves
    (120 − 10) g CO2 per passenger-km; a 10 km round trip is ≈ 1.1 kg
    per day, ≈ 5.5 kg per work week. Factors are rough Indian averages
    and are labelled as such.
  - *Sensitive groups change the plan* — children, elderly, asthma, and
    outdoor work each add their own item; a Severe day (AQI ≥ 301) opens
    with a stay-indoors rule.
- **GenAI is an upgrade, not a crutch** (Prompt Studio). The app builds a
  prompt from the user's context — city, AQI, band, PM2.5, best/worst
  windows, household flags — with explicit constraints ("every
  recommendation must state its direct impact; exactly 5 recommendations,
  one line each"). That **exact prompt is shown on screen and is
  editable** before it is sent to Gemini, because prompt craft is part of
  the product. Without a key the rule-based planner still produces a
  complete plan offline.
- **The same logic answers more questions** — every new feature is a
  pure function in `aqi.js` with tests, not a one-off in the UI:
  - *City comparison* — all fifteen bundled cities ranked worst-first
    by AQI, so a family can see where they stand.
  - *Activity checker* — pick an activity and an hour; the verdict
    follows the CPCB band at that hour's PM2.5, tightened for intense
    exercise and sensitive groups, and states the PM2.5 you would
    inhale in that hour.
  - *Purifier sizing* — room dimensions → the CADR you need (room
    volume × 4 air changes/hour, an AHAM-style rule) and how many DIY
    box-fan purifiers that is.
  - *Weekly commute savings* — the plan's commute swap is extended to
    a 5-day week in CO2 and in rupees (rough Indian fuel/fare averages,
    labelled as such).
- **The app remembers and respects the user** — the household profile
  saves in the browser (localStorage, nothing leaves the device), the
  day plan copies as plain text, charts carry hour labels, and a dark
  mode toggle (persisted, falling back to the system preference) covers
  the whole app. A print stylesheet prints the plan without the
  controls.

## 3. How the solution works

```
index.html ── city picker, geolocation, live-data button, household form,
              AQI card, outlook charts, hacks checklist, Prompt Studio
     │
app.js ────── state + rendering, Open-Meteo live fetch (CAMS), geolocation,
              Gemini call (optional, key stays in the browser)
     │
aqi.js ────── categoriseAQI() → CPCB band + health guidance
              pm25ToAQI() → AQI from PM2.5 (CPCB breakpoints)
              bestOutdoorWindow() / worstOutdoorWindow() → 2-hour windows
              generateRoutine() → day plan, every item with an impact
              co2SavedKg() / exposureAvoided() → the impact maths
              buildAQIPrompt() → the editable prompt sent to Gemini
```

1. Pick a city (or **Use my location**, which maps you to the nearest
   bundled city) → the AQI card shows the number, the CPCB band, and
   plain-language health guidance for that band.
2. **Try live AQI data** fetches the Open-Meteo Air Quality API (CAMS,
   free, no key) for the city; if it fails or you are offline, the app
   falls back to the bundled sample data and says so.
3. The **outlook** shows today and tomorrow as hourly PM2.5 bar charts,
   with the best window in green and the worst in red.
4. Fill in the household form → **Generate my day plan** produces the
   best outdoor window, ventilation timing, commute mode, and
   sensitive-group guidance — each with its quantified impact.
5. **Indoor AQI hacks:** tick off the DIY box-fan purifier, wet mopping,
   sealing gaps, ventilation timing, no indoor burning, and plants — with
   an honest impact note per hack (plants, for example, do not measurably
   cut PM2.5) and a progress count.
6. **Prompt Studio (optional):** paste a Gemini API key, edit the prompt
   if you like, run it — Gemini's recommendations are added, marked ✨.
7. **How your city compares** ranks all fifteen bundled cities
   worst-first, with your city highlighted.
8. **Can I do it now?** checks one activity at one hour — running at
   7 AM in Delhi is a different answer from walking at 2 PM, and the
   checker says why, with the inhaled dose.
9. **Size a purifier for your room** turns length × width × height
   into the CADR you need and the number of DIY box fans that covers.
   The household profile can be saved in the browser, the day plan
   copied as text, and the whole app switched to dark mode from the
   toggle in the header.

**Run it:** open `index.html` in any browser — no build step, no server,
no dependencies. Or `python3 -m http.server 8000` and visit
http://localhost:8000

**If the page looks plain/unstyled:** some viewers open `index.html`
without its sibling files (`styles.css`, `aqi.js`, `app.js`) and show
unstyled HTML. Open `standalone.html` instead — the same app with
everything inlined into one self-contained file. It is a local preview
build only (git-ignored, not part of the submitted repository, so the
repo has no duplicated code). Regenerate it after any change with
`node tools/build-standalone.mjs` (source of truth stays the separate
files, so the code stays reviewable and tested).

**Test it:** `node tests/aqi.test.js` — checks every CPCB band boundary,
the PM2.5→AQI breakpoints, bundled-city consistency, nearest-city
mapping, best/worst window maths, CO2 and exposure calculations, routine
generation for a full household and for edge cases, the city ranking,
activity verdicts, purifier sizing and weekly commute savings, and that the Gemini
prompt carries the user's context.

## 4. Assumptions made

- **Bundled AQI data is representative sample data** for demo and offline
  use: one winter-smog PM2.5 value per city, with an hourly shape derived
  from it. It is not a live reading. The app tries the Open-Meteo Air
  Quality API (CAMS) first when the user asks for live data, and falls
  back to the bundled data with a visible note when the fetch fails.
- **One scale only:** CPCB (India) AQI bands. The US AQI scale is a
  different numbering and is not used anywhere in the app.
- **Impact figures are rough estimates, labelled as such:** CO2 factors
  are approximate per-passenger-km averages; exposure avoided assumes
  ~1.5 m³ of air breathed per hour of moderate activity; the box-fan
  purifier's 50–80% figure is a rough range. The comparisons (metro vs
  car, best vs worst window) are the point, not the exact gram.
- **The app is platform-agnostic static code** — plain HTML/CSS/JS, no
  build step, no framework, no backend. It runs from any static host
  (GitHub Pages) or straight from the file system.
- **Two submission questions are not settled by the challenge
  instructions pasted for this attempt** and do not change the app
  itself: whether Google Antigravity is required to build/submit (the
  instructions say only "the AI platform that you are going to use" with
  no named tool), and whether a narrative/blog "dual submission" is also
  required (the instructions list only the repository link, code, and
  README). Both should be confirmed on the Hack2Skill dashboard / in the
  Challenge 06 explainer session before submitting.
- The Gemini key is the user's own; the app never sees or stores anyone
  else's. The built-in rule-based plan is the fallback when there is no
  key or no network.
- Geolocation is optional and only ever maps the user to the nearest
  bundled city; the coordinates are not sent anywhere.
