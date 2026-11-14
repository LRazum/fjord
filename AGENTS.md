# AGENTS.md — Fjord

Guide for coding agents working on this repository. Read it fully before changing anything.

## What Fjord is

A web app for **Norwegian 4×4 interval training on a treadmill**, guided by live heart rate from a Bluetooth chest strap. Default plan: 10 min warm-up, 4 × 4 min intervals at 85–95 % HRmax, 3 min active recovery at 60–70 %, 5 min cool-down. Everything is configurable.

The user runs on a treadmill with an iPhone in front of them. The workout screen must be readable at a glance and usable with sweaty fingers.

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
  simulator.js        HrSimulator (ACSM VO2 model, first-order HR lag, fatigue, drift, noise)
  hrmath.js           smoothedHr (5 s), hrTrend (18 s slope), zoneStatus (hysteresis), zoneBpm
  hrparse.js          parseHeartRateMeasurement(DataView) for characteristic 0x2A37
  ble.js              StrapConnection (connect, auto-reconnect with backoff, battery), bluetoothSupported()
  storage.js          IndexedDB 'fjord': stores 'workouts' (keyPath id) and 'kv' ('current' snapshot)
  stats.js            workoutStats, recommendNext, progress (weekly), weekKey, flatEquivalentSpeed
  backup.js           sessionsCsv, samplesCsv, makeBackup, parseBackup
  export.js           toTcx (Strava/Garmin), trackSeries, exportBaseName
  charts.js           chart geometry only (live strip, workout chart, weekly trend, niceTicks)
  straps.js           tested strap models + tip keys
  wakelock.js         Screen Wake Lock, falls back to the looping silent video (needs a user gesture)
  format.js           fmtClock, fmtNum (locale decimal), phaseName
  emitter.js          tiny event emitter
  ui/                 screens: onboarding, home, workout-view, summary, history, detail,
                      progress, settings-view; plus form (steppers), chart-svg, modal,
                      download (share sheet / download), dom helpers, views-common
tests/                node:test suites; helpers.js builds synthetic workout records
```

## Key concepts and data shapes

**Plan** (`buildPlan`): `{ phases: [{type, index, durationSec, zone:[lo,hi], target:{speed,incline}, startSec}], intervals, totalSec }`. Phase types are `warmup | interval | recovery | cooldown`. Phases with zero length are left out.

**WorkoutEngine** has the states `ready → running ⇄ paused → finished`. It is driven only by `advance(dtMs)` and has no timers of its own.
- Events: `state`, `phase`, `cue` (30 s left and 3‑2‑1; currently unused) and `finish` (`completed` or `ended`).
- `toJSON()` and `WorkoutEngine.restore()` serialise and rebuild it.

**WorkoutSession** owns the engine.
- **Clock:** time comes from the injectable `now()` and is multiplied by `timeScale`.
- **Samples:** it records `samples[sec] = bpm | null` at 1 Hz of workout time. A strap reading older than 5 s counts as missing.
- **Treadmill log:** `treadmillLog` holds `{t, speed, incline, src: 'plan'|'carry'|'user'}`. Rapid +/− taps within 4 s merge into one entry.
- **Carry-over:** a user change in one phase carries to the next phase of the same type (`targets`, `finalTargets`).
- **Snapshots:** `toSnapshot()` / `new WorkoutSession({restore})` / `attach()` handle crash recovery, and `toRecord()` gives the stored record.

**Workout record** (stored in IndexedDB, exported in backups):
`{ id, startedAt, endedAt, durationSec, finishReason, source:'sim'|'ble', timeScale, settings, plan, phases:[{i,type,index,startSec,endSec,plannedSec,end:'done'|'skipped'|'ended'}], samples, treadmillLog, finalTargets, rpe?, note?, strapName? }`.
If you change this shape, keep old records readable and keep `parseBackup` and `BACKUP_FORMAT` in step.

**Settings**:
- Profile: `lang`, `onboarded`, `maxHr`, `maxHrSource`, `age`, `restHr`, `strapModel`, `hrSource`.
- Adjusting: `adjustPref`, `speedStep`, `inclineStep`.
- Plan: `structure.{warmupSec,intervals,intervalSec,recoverySec,cooldownSec}`, `zones.{phase}:[lo,hi]` in % HRmax, `treadmill.{phase}:{speed,incline}`.
- Developer: `dev.{timeScale,simProfile}`.

New keys get defaults in `DEFAULT_SETTINGS`; `mergeDeep` fills them in for old saved settings. Bump `version` only when a migration is needed (see `loadSettings`).

**Stats definitions** (keep consistent across the summary, detail, progress and CSV views):
- **Time in zone:** measured on the 5 s smoothed HR with the same hysteresis as the live view.
- **Last 2 min:** mean % HRmax over the final 120 s of an interval. An interval counts for recommendations only if it lasted at least 150 s.
- **HRR60:** the smoothed HR at the start of a recovery or cool-down that follows an interval, minus the smoothed HR 60 s later.
- **Efficiency ("speed at 90 % HRmax"):** the flat-equivalent speed `v·(1+4.5·grade)` over the last 2 min, scaled by `90 / last2Pct`.
- **Recommendation:** below the zone means harder, above means easier. A deviation of 4 points or more means two steps.
  - The step is ±0.5 km/h for speed, ±1 % for incline, and ±0.5 km/h plus ±0.5 % for both.
  - It starts from `finalTargets.interval`.
  - It is applied to `settings.treadmill.interval` automatically for strap workouts and through a button for simulated ones.

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
| 3 | Coaching cues, voice (speechSynthesis, Croatian with English fallback), sounds | **dropped by the user for now**; leftovers: engine `cue` events, `WorkoutView.setCue()` |
| 4 | IndexedDB storage, crash recovery, history, detail, progress, stats, recommendations | done |
| 5 | Onboarding, settings, JSON backup/import, CSV, TCX, live HR strip, zone in bpm, screen-on video fallback | done |

102 tests pass. In headless Firefox, every screen works end to end and the strap flow works with a fake `navigator.bluetooth`.

## Known gaps and open items

- **Not tested on a real device yet:**
  - The Bluefy + iPhone + real strap combination.
  - Whether the silent-video fallback actually keeps the iPhone screen on.
  - Whether Strava and Garmin accept the TCX files.
- **Publishing:**
  - The repository has **no GitHub remote yet**, so GitHub Pages is not set up. The README describes the steps.
  - Do not push, create repositories or publish anything without the user's explicit approval.
- **Small issues:**
  - The live HR strip on the workout screen is mostly empty in the first minutes of a workout.
  - When the strap disconnects there is only a banner and vibration. Sounds were part of milestone 3.
- **Ideas the user has not decided on:**
  - A "ready" screen with a live HR check and a 5 s countdown.
  - A touch lock during the workout.
  - "+1 min" and "one more interval" buttons.
  - Coaching cues: they would reuse the engine `cue` events, `hrmath` trend and hysteresis, with at least 25 s between corrective cues and no "speed up" in the first 90 s of an interval while HR is still rising fast enough to reach the zone.

## Working with the user

- The user writes in Croatian. Answer in the language they write in, but keep code, comments, commit messages and the README in English.
- Work in small, verifiable steps: run the tests and check in Firefox before saying something is done, and say plainly what was not verified, especially anything that needs the iPhone or a real strap.
- Commit only when asked. The branch is `main`.
