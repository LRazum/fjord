# AGENTS.md — Fjord

Guide for coding agents working on this repository. Read it fully before changing anything.

## What Fjord is

A web app for **Norwegian 4×4 interval training**, guided by live heart rate from a Bluetooth chest strap or a watch that broadcasts heart rate. Activities: treadmill (the default), gym bike, stepmill, rowing machine, outdoor run and outdoor ride. Default plan: 10 min warm-up, 4 × 4 min intervals at 85–95 % HRmax, 3 min active recovery at 60–70 %, 5 min cool-down. Everything is configurable. A built-in **max HR field test** measures HRmax for users who do not know it.

The user usually trains indoors with an iPhone in front of them. The workout screen must be readable at a glance and usable with sweaty fingers.

## Hard constraints (do not break)

- **Vanilla HTML, CSS and JavaScript (ES modules).** No frameworks, no build step, no npm dependencies, no CDN scripts. Draw charts yourself (SVG). `package.json` exists only so `npm test` works.
- **Static hosting on GitHub Pages** (HTTPS, served from a sub-path like `/fjord/`). Use relative paths everywhere (`./js/...`, never `/js/...`).
- **All data stays on the device.** No server, no accounts, no analytics, no network calls except loading the app's own files.
- **Target browsers:**
  - **Bluefy on iPhone** (WKWebView with Web Bluetooth). This is the only place a real strap is used.
  - **Firefox on Linux** is the development browser. Firefox has **no Web Bluetooth**. Everything except the real strap connection must work fully in Firefox, including the simulator, workout, storage, history, charts and export/import.
- **Feature-detect every optional API**: `navigator.bluetooth`, Wake Lock, `navigator.share`, `navigator.vibrate`, `navigator.storage`, IndexedDB. Never crash or show errors because something is missing. Do not use Chrome-only APIs other than Web Bluetooth.
- **Be conservative with Safari compatibility**: no top-level `await`, no `Array.prototype.at`, no `structuredClone`.
- **The workout screen never scrolls.** It uses a dark theme, respects `env(safe-area-inset-*)`, and works in portrait and landscape down to 320×480 and 568×320. Touch targets are at least 44 px; the workout +/− buttons are larger.
- **UI language:** English is the default, Croatian is the second language. Every user-facing string lives in `js/i18n.js` in **both** `en` and `hr`. Never hard-code UI text.
- **Logic modules stay DOM-free**, so they can be tested with `node:test`.

## Run, test, verify

Run all commands from the repository root.

The parent folder `/home/lovro` is itself an unrelated git repository. Make sure you are inside the repository root, where `.git` lives next to `index.html`.

```bash
python3 -m http.server 8000      # then open http://localhost:8000 in Firefox
node --test tests/*.test.js      # unit tests (Node 18+), must stay green
```

- `localhost` is a secure context, so the service worker, Wake Lock and IndexedDB all work there.
- GitHub Actions runs the suite on Node 18 and 24 for pull requests and pushes to `main`. `tests/assets.test.js` checks offline asset coverage and translation key/parameter parity. CI does not install application dependencies or build the app.
- **Developer options** sit at the bottom of the home screen:
  - *Time speed 10×* makes a 40-minute workout take 4 minutes.
  - *Simulated runner* chooses whether the plan is too easy, a good fit, too hard or random for the simulated runner.
- `window.fjord` exposes the app state (`fjord.session`, `fjord.settings`, `fjord.strap`) for console debugging.
- **Fast-forwarding a workout in tests:** stop the timer and drive the clock by hand: `s._stopTimer(); let c = Date.now(); s.now = () => c; s._lastTick = c; c += 1000; s.tick();`.
- **Testing Bluetooth without a strap:** inject a fake `navigator.bluetooth` (see `tests/ble.test.js` for the object shape), then `import('/js/main.js?x=' + Date.now())` so `bluetoothSupported()` is evaluated again.
- After UI changes, check the page in Firefox at phone sizes: 390×844, 375×667, 320×480, and landscape 844×390 and 568×320. Confirm there is no horizontal page scroll and the workout screen does not overflow.

## Repository layout

```
index.html            app shell; one <section id="screen-…"> per screen
styles.css            all styles (tokens on :root, dark only)
manifest.json, sw.js  PWA manifest and service worker
icons/, media/        app icons; media/keepawake.mp4 (silent video for the screen-on fallback)
js/
  main.js             app controller: screens, strap wiring, autosave, recovery, backup
  i18n.js             STRINGS.en / STRINGS.hr, t(key, params), setLang()
  settings.js         DEFAULT_SETTINGS, load/save (localStorage 'fjord.settings'), mergeDeep, clone
  workout.js          buildPlan(settings) + WorkoutEngine state machine (pure)
  session.js          WorkoutSession: timer, 1 Hz HR samples, treadmill log, snapshots
  ready.js            ReadySession: live HR preview and five real seconds of countdown (pure)
  coaching.js         WorkoutCoach: persistent HR deviations, small suggestions, response delay (pure)
  simulator.js        HrSimulator (ACSM VO2 model, first-order HR lag, fatigue, drift, noise)
  hrmath.js           smoothedHr (5 s), hrTrend (18 s slope), zoneStatus (hysteresis), zoneBpm
  hrparse.js          parseHeartRateMeasurement(DataView) for characteristic 0x2A37
  ble.js              StrapConnection (connect, auto-reconnect with backoff, battery), bluetoothSupported()
  activities.js       ACTIVITIES (treadmill, bike, stepmill, rower, run, ride) and their machine controls
  storage.js          IndexedDB 'fjord': stores 'workouts' (keyPath id) and 'kv' ('current' snapshot)
  stats.js            workoutStats, recommendNext, progress (weekly), weekKey, flatEquivalentSpeed
  estimate.js         buildModels (history per activity), estimateInterval, plannedSettings, warmupCheck
  backup.js           sessionsCsv, samplesCsv, makeBackup, parseBackup
  export.js           toTcx (Strava/Garmin), trackSeries, exportBaseName
  charts.js           chart geometry only (live strip, workout chart, weekly trend, niceTicks)
  straps.js           strap and watch models (kind 'strap' | 'watch') + tip keys
  wakelock.js         Screen Wake Lock, falls back to the looping silent video (needs a user gesture)
  format.js           fmtClock, fmtNum (locale decimal), phaseName
  emitter.js          tiny event emitter
  ui/                 screens: onboarding, home, ready-view, workout-view, summary, history, detail,
                      progress, settings-view; plus form (steppers), chart-svg, modal,
                      download (share sheet / download), dom helpers, views-common
tests/                node:test suites; helpers.js builds synthetic workout records
```

## Key concepts and data shapes

**Plan** (`buildPlan`): `{ phases: [{type, index, durationSec, zone:[lo,hi], target:{...control values}, startSec}], intervals, totalSec }`. Phase types are `warmup | interval | recovery | cooldown`. Phases with zero length are left out.

**Max HR test** (`buildTestPlan`): `kind: 'maxTest'`, 10 min easy, 3 min hard, 2 min easy, 3 min building to an all-out last minute, 5 min cool-down; phases carry `effort` (`easy|hard|max`) and a `label` i18n key. The session disables coaching and zone status; the result is `peakHr` (highest 5 s smoothed HR). It becomes HRmax only when the user accepts it on the summary (`applyMaxHrTest`). Test records are excluded from `progress()` and recommendations.

**Activities** (`activities.js`): each has `controls` (e.g. treadmill `speed`, `incline`; bike `level`, `cadence`; stepmill `level`; rower `power`, `rate`; outdoor none) with units, limits, decimals, coaching cap and recommendation steps. Targets live in `settings.treadmill` (treadmill) or `settings.targets.{bike,stepmill,rower}`; use `phaseTargets()`/`targetsPath()`. Speed efficiency and TCX distance are treadmill-only. Outdoors, coaching suggestions have `kind: null` ("speed up / ease off") and nothing is logged.

**WorkoutEngine** has the states `ready → running ⇄ paused → finished`. It is driven only by `advance(dtMs)` and has no timers of its own.
- Events: `state`, `phase`, `cue` (30 s left and 3‑2‑1; currently unused) and `finish` (`completed` or `ended`).
- `toJSON()` and `WorkoutEngine.restore()` serialise and rebuild it.

**WorkoutSession** owns the engine.
- **Clock:** time comes from the injectable `now()` and is multiplied by `timeScale`.
- **Controls:** Pause, Resume, Skip and End settle pending wall-clock time before changing engine state. Resume settles it while still paused, so suspended timers cannot count paused time. A Skip that catches up across a natural phase boundary leaves the newly entered phase running.
- **Samples:** it records `samples[sec] = bpm | null` at 1 Hz of workout time. Strap readings are timestamped and buffered until consumed. Each sample uses the reading available at its actual wall-clock time (including time scale and pauses); a future reading must never backfill earlier seconds. A reading older than 5 real seconds counts as missing. Ready-to-workout transfer preserves the reading's original age.
- **Machine log:** `treadmillLog` (name kept for old records) holds `{t, ...control values, src: 'plan'|'carry'|'user'}`. Rapid +/− taps within 4 s merge into one entry.
- **Carry-over:** a user change in one phase carries to the next phase of the same type (`targets`, `finalTargets`).
- **Snapshots:** `toSnapshot()` / `new WorkoutSession({restore})` / `attach()` handle crash recovery, and `toRecord()` gives the stored record.

**ReadySession** precedes a new workout. It has no DOM or timers: the controller calls `tick()` with an injectable real-time clock. Its states are `ready → counting → finished` or `cancelled`. HR older than 5 s is missing; missing HR and no skin contact never block Start. The simulator previews a standing runner and is reused by the workout. Only after the countdown finishes does the controller create and start `WorkoutSession`. Cancel clears the preview timer and releases the screen lock. A hidden page resets an active countdown to `ready`.

**WorkoutCoach** is owned by `WorkoutSession`. It uses workout seconds, 5 s smoothed HR, the 18 s trend, and the current phase. A deviation beyond the zone by more than 1 percentage point must persist for 20 s. No increases in the first 90 s of an interval (60 s of warm-up), during recovery/cool-down, or while the trend is already heading into the zone. No suggestions in the first/last 30 s of a phase, on pause, without a configured HRmax, with stale/missing HR, disconnection, or no skin contact. Steps are capped at 0.5 km/h or 0.5 percentage points of incline; `both` alternates one control at a time. Confirm/Skip/manual adjustment defers proposals for 60 s. `confirmSuggestion(id)` rechecks the clock, phase and signal, then logs a user change. Suggestions are transient and are not stored in snapshots or records.

**Workout record** (stored in IndexedDB, exported in backups):
`{ id, startedAt, endedAt, durationSec, finishReason, source:'sim'|'ble', timeScale, settings, plan, phases:[{i,type,index,startSec,endSec,plannedSec,end:'done'|'skipped'|'ended'}], samples, treadmillLog, finalTargets, activity?, kind?:'workout'|'maxTest', peakHr?, rpe?, note?, strapName?, estimate?:{values,key,n,sim}, warmupCheck?:{action,hr,expected,delta,calibrated,key?,from?,to?,outcome:'accepted'|'skipped'|'expired'|null} }`. Records without `activity` are treadmill workouts (`activityOf(rec.settings)`).
If you change this shape, keep old records readable and keep `parseBackup` and `BACKUP_FORMAT` in step.

**Settings**:
- Profile: `lang`, `onboarded`, `maxHr`, `maxHrSource` (`known|age|test|default`), `maxHrTest` (`{bpm, at, activity}`), `age`, `restHr`, `strapModel` (strap or watch id), `hrSource`, `activity`.
- Adjusting: `adjustPref` (`'speed'` = first control, `'incline'` = second, `'both'`), `speedStep`, `inclineStep` (treadmill only).
- Plan: `structure.{warmupSec,intervals,intervalSec,recoverySec,cooldownSec}`, `zones.{phase}:[lo,hi]` in % HRmax, `treadmill.{phase}:{speed,incline}`, `targets.{bike,stepmill,rower}.{phase}:{...}`.
- Developer: `dev.{timeScale,simProfile}`.
- Live suggestions: `coachingEnabled` (defaults to true).
- Automatic plan: `intervalPlan` (`'auto'` default | `'manual'`) and `warmupCheck` (defaults to true); see below.
- Profile for VO2max: `sex` (`'male'|'female'|null`), `weightKg` (null; only the bike and rower need it). `age` is shared with the age-based HRmax estimate. `maxHrSource` is explicitly chosen as `known` or `age`; `hasMaxHr` rejects the initial fallback and age mode without a valid age. Profile updates use `updateHeartRateSettings`; age estimates are labelled and update with age. Starting a new workout requires a configured HRmax; older saved workouts remain readable.

New keys get defaults in `DEFAULT_SETTINGS`; `mergeDeep` fills them in for old saved settings. Bump `version` only when a migration is needed (see `loadSettings`).

**Stats definitions** (keep consistent across the summary, detail, progress and CSV views):
- **Time in zone:** measured on the 5 s smoothed HR with the same hysteresis as the live view.
- **Last 2 min:** mean % HRmax over the final 120 s of an interval. An interval counts for recommendations only if it lasted at least 150 s.
- **HRR60:** the smoothed HR at the start of a recovery or cool-down that follows an interval, minus the smoothed HR 60 s later.
- **Efficiency ("speed at 90 % HRmax"):** the flat-equivalent speed `v·(1+4.5·grade)` over the last 2 min, scaled by `90 / last2Pct`.
- **Recommendation:** below the zone means harder, above means easier. A deviation of 4 points or more means two steps.
  - The step is ±0.5 km/h for speed, ±1 % for incline, and ±0.5 km/h plus ±0.5 % for both.
  - It starts from `finalTargets.interval`.
  - It changes `settings.treadmill.interval` only through explicit acceptance, for both strap and simulator workouts. Keep current plan leaves settings untouched. An unset HRmax returns `action: 'none', reason: 'maxHr'`.

**Automatic interval target** (`estimate.js`): %HRR ≈ %VO2R, with oxygen cost from the simulator's `vo2Machine`. Each counted interval's last 2 min gives a capacity `3.5 + (cost − 3.5) / HRR fraction`; `buildModels` takes the median over the last 5 workouts per activity within 8 weeks (real workouts only when any exist; max tests excluded) plus the median interval/warm-up capacity ratio. With `intervalPlan: 'auto'` and at least 2 workouts, `plannedSettings` returns a copy of the settings whose interval target is solved for mid-zone on the preferred control (snapped to `setStep`); the saved manual plan is never overwritten and the post-workout Apply buttons are replaced by the next estimate. `main.js` keeps `app.models` fresh after every save, delete and import.

**Warm-up check:** from 75 s to 20 s before the warm-up ends, once HR has been at one setting for 120 s with a slope ≤ 4 bpm/min, `warmupCheck` compares the 2-min mean HR with what the planned interval implies (calibrated by the history ratio). ≥ 4 bpm (≥ 6 without a calibrated history) offers a target for today's intervals, at most two `nextStep`s. Accepting changes `session.targets.interval` only; an unanswered offer expires at the next phase; snapshots keep only that the check ran.

**VO2max** (`estimate.js`): `vo2maxOf(rec, kg, restHr)` is the median interval capacity of one workout (the same %HRR ≈ %VO2R model; `vo2Machine` takes body mass, so bike and rower need `weightKg`, stored with the workout or taken from the profile; the profile resting HR fills in for workouts saved without one). `currentVo2max` takes the median of the last 5 workouts of an activity within 8 weeks (≥ 2), `vo2maxByWeek` feeds the Progress chart. `vo2Rating(value, age, sex)` uses `VO2_NORMS` (lower bounds of superior/excellent/good/fair per decade 20–79, nearest band outside it) and returns the level and a 0–1 position for the five-segment scale drawn by `vo2Html` in `ui/views-common.js`.

## Design

Liquid glass over a living aurora, dark only. Tokens live on `:root` in `styles.css`.
- **Background:** `body::before` (and `::before` of the Ready and workout screens) paints three drifting radial lights from `--a1..--a3`. On the workout screen `data-zone` swaps them to blue (below), green (in) or red (above), transitioned through `@property`, because the zone must read at a glance. The page colour sits on `html` only; a `body` background would cover the aurora.
- **Glass:** cards, tiles, list items, the nav pill, dialogs and the workout panels use `backdrop-filter: var(--blur)` over a translucent fill, plus a 1px specular rim (`::before` with `--rim`, masked to the border). Nested controls inside a glass card use plain translucent fills, not another blur.
- **Settings:** a grouped glass menu (You / Workouts / App), one row per subpage with a tinted icon and a one-line summary of what is set; `PAGES` in `ui/settings-view.js` lists the subpages. Add new settings to the subpage they belong to rather than as another card on the menu.
- **Controls:** pill buttons; primary actions and selected options are near-white with dark ink (`--ink`). Steppers are a pill track with round buttons.
- **Type:** system text (SF on iPhone); numbers use `--num` (`ui-rounded`, SF Rounded) bold and tabular.
- **Workout dial:** an SVG ring around the heart rate maps 50–100 % HRmax to 260°. The fill and marker follow the 5 s smoothed HR; the target zone is a separate thinner arc just outside the ring so the fill never hides it. The dial is hidden for the max test, with a suggestion card, and on short screens (portrait under 600 px, landscape under 360 px). The live HR strip shows only in portrait from 900 px tall.
- No emoji, no hard-coded UI text; respect `prefers-reduced-motion` (aurora and transitions stop).

## Conventions

- **Screens** render with `root.innerHTML` from template strings. Escape every interpolated value with `esc()`.
- **Events:** handle them with `root.onclick` and `data-action` attributes. When a screen re-renders into the same root, register extra listeners with `listen(root, key, type, fn)` from `ui/dom.js` so they do not stack.
- **Workout screen updates:** use `setText()` and cache element references through `[data-f]` with `fields()`. Do not re-render on every tick.
- **Dialogs:** use `confirmDialog` and `choiceDialog` from `ui/modal.js`, never `window.confirm`.
- **Files:** export them through `saveFile()` in `ui/download.js`, which uses the share sheet on phones and a download on desktop.
- **Charts:** one series per chart and one y-axis (never dual-axis). Keep the grid recessive and label text in text colours, not the series colour. Every chart needs a hover/tap read-out and a table near it.
- **Adding a JS, CSS, icon or media file:** add it to `ASSETS` in `sw.js` and bump `VERSION`. A quick check:
  ```bash
  for f in $(grep -oP "'\./\K[^']+(?=')" sw.js); do [ -f "$f" ] || echo MISSING $f; done
  ```
- **New UI strings:** add them to both `en` and `hr`, in the same place in each block.
- **New logic:** put it in a DOM-free module with tests in `tests/`. Use `tests/helpers.js` (`makeRecord`) to build workouts with exactly known numbers.
- **Comments:** explain why, not what. Match the existing code style (2 spaces, single quotes, semicolons).

## Status

| Milestone | Contents | State |
|---|---|---|
| 1 | Engine, simulator, workout screen, offline shell | done |
| 2 | Bluetooth strap: parsing, connection, battery, auto-reconnect, banner | done; covered by tests and a fake device, **not yet tried with a real strap** |
| 3 | Voice (speechSynthesis) and sounds | **dropped by the user for now**; optional text suggestions were subsequently approved and implemented in `coaching.js` |
| 4 | IndexedDB storage, crash recovery, history, detail, progress, stats, recommendations | done |
| 5 | Onboarding, settings, JSON backup/import, CSV, TCX, live HR strip, zone in bpm, screen-on video fallback | done |
| 6 | Watches as HR source, max HR field test, gym bike / stepmill / rower / outdoor run and ride | done; watches **not yet tried with a real device** |

196 tests pass. Milestone 6 was checked in the browser with the simulator: onboarding (watch, test, bike), the max test at 1×-clock fast-forward through to accepting the result, an outdoor run with a suggestion card at 568×320, and a stepmill at 320×480. In headless Firefox, every screen works end to end and the strap flow works with a fake `navigator.bluetooth`. The Ready screen and countdown were checked in both languages at all five phone sizes above, including stale-HR and no-contact warnings. Real countdown timing was checked at 1× and 10× workout speed. Wake Lock tests cover cancellation while acquiring or releasing a lock, late events from an old lock, and the video fallback. Live suggestion and profile tests cover confirmation, rejection, signal loss, pause/phase changes, carry-over, recovery and storage/backup round trips. Session tests cover unticked pauses, precise End/Skip timestamps, natural phase/finish boundaries and timestamped HR catch-up without fabricated data. The live strip grows from a labelled 30-second window to the last three minutes.

## Known gaps and open items

- **Not tested on a real device yet:**
  - The Bluefy + iPhone + real strap combination, and any real watch in heart-rate broadcast mode.
  - Whether the silent-video fallback actually keeps the iPhone screen on.
  - Whether Strava and Garmin accept the TCX files.
- **Publishing:**
  - The GitHub remote is `https://github.com/LRazum/fjord.git`. The user enabled GitHub Pages from `main`, `/ (root)`; `docs/DEVELOPMENT.md` describes the setup. The README is written for users (what the app does, how to start, tips, support); keep technical detail in `docs/DEVELOPMENT.md`.
  - Do not push, create repositories or publish anything without the user's explicit approval.
- **Small issues:**
  - When the strap disconnects there is only a banner and vibration. Sounds were part of milestone 3.
- **Ideas the user has not decided on:**
  - A touch lock during the workout.
  - "+1 min" and "one more interval" buttons.

## Working with the user

- The user writes in Croatian. Answer in the language they write in, but keep code, comments, commit messages, the README and `docs/` in English.
- Work in small, verifiable steps: run the tests and check in Firefox before saying something is done, and say plainly what was not verified, especially anything that needs the iPhone or a real strap.
- Commit only when asked. The branch is `main`.
