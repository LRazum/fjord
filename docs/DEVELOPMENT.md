# Fjord: development notes

Technical notes for running, testing and deploying Fjord. The user-facing overview is in the [README](../README.md).

- Vanilla HTML/CSS/JS (ES modules). No build step and no dependencies.
- UI in English by default; Croatian is available via the EN/HR switch.
- Runs in **Bluefy** on iPhone, which has Web Bluetooth, for the real strap. Everything else (simulator, workout engine, UI) runs in **Firefox** on Linux, which is the development browser.
- All data stays on the device. There is no server, no account and no analytics.

## Status

| Milestone | Contents | State |
|---|---|---|
| 1 | Skeleton, workout state machine, HR simulator, workout screen, offline shell | ✅ |
| 2 | Bluetooth strap: connection, HR measurement parsing, battery, auto-reconnect | ✅ |
| 3 | Voice and sounds | dropped for now; optional text suggestions are available |
| 4 | Storage (IndexedDB), crash recovery, history, workout detail, progress, statistics | ✅ |
| 5 | Onboarding, settings, backup export/import, CSV, TCX | ✅ |
| 6 | Watches, max HR test, bike / stepmill / rower / outdoor | ✅ (watches not yet tried on a real device) |

Not yet tested on a real strap: the Bluetooth code is covered by unit tests with a fake device and by an in-browser test with a fake `navigator.bluetooth`.

## Run locally on Linux

Any static file server works. Python is already on the system:

```bash
cd fjord
python3 -m http.server 8000
```

Open <http://localhost:8000> in Firefox. `localhost` counts as a secure context, so the service worker, Wake Lock and the other secure-context APIs all work over plain HTTP.

Firefox notes:

- **Firefox has no Web Bluetooth.** Fjord detects this, hides the strap connection and uses the simulator. Real strap testing happens on the iPhone (see *Test on iPhone with Bluefy*).
- **Developer options** (*Developer*) are at the bottom of the home screen. *Time speed 10×* runs the workout clock 10× faster, so a whole 40-minute session takes 4 minutes. *Simulated runner* chooses whether the planned treadmill settings are too easy, a good fit, too hard or random for the simulated runner.
- The service worker is network-first, so a normal reload always picks up your edits. If something looks stale, use Ctrl+Shift+R.
- Private windows don't get a service worker, and may not keep workouts after the window closes (Fjord warns when it cannot store data).

## Tests

The pure modules (`workout.js`, `session.js`, `ready.js`, `coaching.js`, `settings.js`, `hrmath.js`, `hrparse.js`, `ble.js`, `simulator.js`, `stats.js`, `estimate.js`, `backup.js`, `charts.js`, `export.js`) have unit tests in `tests/`, written with `node:test`. They need Node 18 or newer:

```bash
sudo apt install nodejs
```

```bash
node --test tests/*.test.js
```

`npm test` runs the same command. There are no packages to install.

GitHub Actions runs the tests on Node 18 and 24 for every pull request and push to `main`. It also checks that all browser modules are cached for offline use, that cached files exist, and that English and Croatian translations have matching keys and parameters. CI has no dependency-install or build step.

## Deploy to GitHub Pages

The app is plain static files with relative paths, so it works from a sub-path like `https://<user>.github.io/fjord/`.

1. Create a GitHub repository (e.g. `fjord`) and push this folder to it. With the GitHub CLI:
   ```bash
   gh repo create fjord --public --source=. --push
   ```
   GitHub Desktop works too: *Publish repository*.
2. On GitHub, open the repository and go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute the site is live at `https://<user>.github.io/fjord/`. Each push to `main` redeploys automatically and takes about 1 minute. You can watch it under the *Actions* tab.

The `.nojekyll` file tells Pages to serve the files as they are.

The free plan publishes Pages only from public repositories. That's fine here because the code holds no personal data: workouts live in the browser on your phone, not in the repo.

## Test on iPhone with Bluefy

1. Install **Bluefy – Web BLE Browser** from the App Store.
2. Open `https://<user>.github.io/fjord/` in Bluefy. Allow Bluetooth access when iOS asks.
3. **Full screen:** tap the Bluefy menu (the ⋯ / settings button in the toolbar) and turn on **Fullscreen** / *Hide toolbar*. Fjord respects the notch and home-indicator safe areas. To get back out, use the small floating Bluefy button.
4. Bookmark the page in Bluefy so you can find it again quickly.
5. After the first load the app works offline: the service worker caches it.
6. **Getting updates:** after you push, wait for Pages to deploy (about 1 minute), then pull to refresh or reload in Bluefy. The network-first service worker serves the new version as soon as the network answers.
7. If the screen still turns off during a workout (Fjord shows a warning when neither Wake Lock nor the silent-video fallback works), set *Settings → Display & Brightness → Auto-Lock → Never* on the iPhone for the session.

> ⚠️ Workouts are stored in Bluefy's browser storage. Deleting Bluefy, or clearing its website data, deletes your history. Use **Export backup** regularly.

## Project layout

```
index.html          app shell
styles.css          all styles (dark, full-screen, safe areas)
manifest.json       PWA manifest
sw.js               service worker (offline)
icons/              app icons
media/              keepawake.mp4 (5 s of black video with silent audio)
js/
  main.js           entry point, wires everything together
  i18n.js           all UI strings (Croatian + English)
  settings.js       defaults, load/save (localStorage)
  workout.js        plan builder + workout state machine (pure, no DOM)
  session.js        running workout: timer, HR recording, treadmill log
  ready.js          live HR preview and five-second countdown (pure, no DOM)
  coaching.js       optional live treadmill suggestions (pure, no DOM)
  simulator.js      simulated heart rate (pure, no DOM)
  hrmath.js         smoothing, trend, zone hysteresis (pure, no DOM)
  format.js         time/number formatting
  wakelock.js       keeps the screen on (Wake Lock, silent-video fallback)
  ble.js            strap connection, reconnects (no DOM)
  hrparse.js        Heart Rate Measurement (0x2A37) parser (pure)
  storage.js        IndexedDB: workouts + in-progress snapshot
  stats.js          per-workout stats, weekly progress, recommendations (pure)
  estimate.js       interval target from past workouts, warm-up check (pure)
  backup.js         CSV export, JSON backup/restore (pure)
  straps.js         tested strap models and tips
  charts.js         chart geometry (pure, no DOM)
  export.js         TCX export (pure, no DOM)
  ui/               screens: onboarding, home, ready, workout, summary, history, detail,
                    progress, settings; forms, charts, dialogs
tests/              node:test unit tests for the pure modules
package.json        only there so `npm test` works; no dependencies
```

When you add a new file, also add it to the `ASSETS` list in `sw.js` and bump `VERSION` there.

## Strap connection

- **Connect strap** on the home screen opens the browser's device picker, filtered to devices that offer the standard Heart Rate Service, so any standard strap works.
- Battery level is shown when the strap reports it.
- If the link drops during a workout, the timer keeps running, a red banner appears (the phone also vibrates where supported), and Fjord retries automatically (after 1, 2, 4, 8, then every 15 s). **Reconnect** in the banner retries at once.
- A "no skin contact" warning appears when the strap reports it.
- Most straps accept one Bluetooth connection at a time: disconnect it from your watch and other apps first. The Polar H10 accepts two.
- **Watches** work when they broadcast heart rate over Bluetooth (Garmin *Broadcast Heart Rate*, COROS *Heart Rate Broadcast*, Polar and newer Suunto *share HR*). Apple Watch needs a third-party broadcast app. Choose *Watch* in onboarding or Settings for model-specific tips. Wrist HR reacts a few seconds later than a strap.

## Activities

Pick the activity on the home screen. Each has its own planned settings per phase, its own +/− controls and its own suggestions:

| Activity | Logged settings |
|---|---|
| Treadmill | speed (km/h), incline (%) |
| Gym bike | resistance level, cadence (rpm) |
| Stepmill | level |
| Rowing machine | power (W), stroke rate (spm) |
| Outdoor run / ride | none: heart rate only, suggestions say "speed up" or "ease off" |

Progress is shown per activity. Speed at 90 % HRmax and TCX distance are treadmill-only.

## Max HR test

If you don't know your maximum heart rate, choose *I do not know — test it* (or *estimate from age*). The test takes about 23 min: 10 min easy, 3 min hard and steady, 2 min easy, 3 min building to an all-out final minute, 5 min cool-down. The highest 5-second average becomes your HRmax once you accept it on the summary. Do it on the activity you train on: max HR is usually lower on a bike than running.

## Data, history and statistics

- Every workout is stored in IndexedDB in the browser: heart rate at 1 Hz, phases, every logged treadmill change, RPE and a note.
- Strap readings keep their real timestamps when a delayed browser timer catches up. A new reading is never copied into earlier seconds; gaps without a recent reading remain missing data.
- The running workout is saved every 5 s and on every change. After a reload or crash, Fjord offers to **resume** it (paused at the same point), **save** it as it is, or discard it.
- Workouts shorter than one minute are not saved.
- **Workout detail:** HR chart with zone bands and phase markers; per interval avg/max HR, time in zone, time to reach the zone, avg speed/incline, % HRmax over the last 2 min; per phase avg/min/max HR and the HR drop 1 min after each interval.
- **Progress:** per week, speed at 90 % HRmax (flat-equivalent speed from the last 2 min of each interval, scaled to 90 % HRmax: going up means getting fitter), interval HR, time in zone, speed and incline; total workouts, week streaks.
- **Maximum heart rate:** choose a known maximum or an age estimate (`208 − 0.7 × age`) in onboarding or Settings. Estimated values are labelled on Home, Ready and the workout screen. The initial 190 is a fallback, not a personal value: choose a source before starting a new workout. An age estimate can differ from your actual maximum.
- **Next session:** if HR in the last 2 min of the intervals stayed below the zone, the suggested next interval target goes up (speed, incline or both, by your preference); above the zone, it goes down. Every workout offers **Use for next workout** and **Keep current plan**. Only accepting changes the saved plan. No recommendation is made with an unset HRmax.
- **Automatic interval target** (*Settings → Plan → Interval target: Estimate from workouts*, the default): once there are 2 recent workouts of the activity with full intervals, the interval target is estimated from the last 2 min of each interval in the last 5 workouts (within 8 weeks). Each gives the athlete's capacity from the machine setting's oxygen cost (the simulator's ACSM equations) and the fraction of heart-rate reserve it took (%HRR ≈ %VO2R); the median capacity is turned back into the setting that lands mid-zone, changing the control you prefer to adjust. Home marks the estimated target with *. The saved manual plan stays as the fallback and is not overwritten; warm-up, recovery and cool-down always use it. Simulated workouts count only while there are no real ones. With the manual mode, the post-workout recommendation works as before.
- **Warm-up check** (on by default): 75 s before the warm-up ends, if HR has been steady at one setting for 2 min, Fjord compares it with the HR the planned interval target implies, calibrated by the usual warm-up/interval ratio from the history. A difference of 4 bpm or more (6 without history) offers today's interval target (at most two recommendation steps) with **Use today** / **Skip**. Only this workout changes; an unanswered offer expires when the intervals start. The result is kept in the workout record.
- **VO2max estimate:** from the last 2 min of each interval: the oxygen cost of the machine setting (the ACSM equations the simulator uses) against the share of your heart-rate reserve, extrapolated to HRmax. Shown on Home and Progress (median of the last 5 workouts of the activity within 8 weeks, from 2 workouts on), per workout on the summary, and as a weekly chart. With age and sex in *Settings → Profile* it is rated against age-group norms (poor, fair, good, excellent, superior). Bike and rower values need body weight. It is an estimate, not a lab test: it reads a little low (cardiac drift), bike values sit below running ones, and a resting HR makes it more accurate. Nothing is estimated outdoors.
- **Settings → Your data:** full JSON backup (export and import; import adds missing workouts and restores settings), CSV of all sessions. Each workout can also be exported as per-second CSV or TCX.

## How a workout behaves

- **Start workout** opens a full-screen **Ready** screen after choosing the HR source or connecting the strap. Check your live HR, strap status and the first phase's treadmill target, then tap **Start** for a 5–4–3–2–1 countdown. It always takes five real seconds, even at 10× workout speed. No workout time or samples are recorded until it ends. **Cancel** returns home, including during the countdown. Missing HR (over 5 s) and no skin contact show warnings without blocking Start. Leaving the app during the countdown resets it and requires another Start tap.
- At the start of each phase Fjord assumes you set the treadmill to the target, and logs that. Use **+ / −** to log what you really set; hold a button to repeat.
- A change you make during a phase carries over: if you go to 11.0 km/h in interval 1, interval 2 starts with 11.0 km/h as its target. Recovery, warm-up and cool-down keep their own targets.
- **Live suggestions:** optional text cards use 5 s smoothed HR and its trend. A deviation must persist for 20 s, beyond a 1 percentage-point margin around the zone. No increase is suggested in the first 90 s of an interval, or during recovery/cool-down; a trend already heading into the zone waits. Suggestions stop while paused, disconnected, missing HR, without skin contact, or in the last 30 s of a phase. One change uses your chosen step capped at 0.5 km/h or 0.5 percentage points of incline. Set the treadmill manually, then tap **Accept** to record the change; **Skip** leaves the logged settings alone. Either choice, or a manual adjustment, leaves at least 60 workout seconds for HR to respond. **Both** alternates the two controls. Pending suggestions are rechecked on acceptance and are never restored after a reload.
- **Skip** needs a second tap within 2.5 s. **End** asks for confirmation.
- The background shows the zone (blue below, green in, red above) and the same state is written under the heart rate. The zone is shown in beats (e.g. 162–180 bpm) and in % HRmax.
- On screens that are tall enough, a small chart shows heart rate against the zone band. It starts with a 30-second window, expands as readings arrive, and settles on the last 3 minutes. A label shows the current time range.
- **Screen on:** Fjord uses the Screen Wake Lock API. Where the browser has none (in-app browsers on iPhone), it plays a tiny silent video off-screen instead, which keeps the display awake. On iOS that video can pause music playing in another app.
- **Export TCX** on the summary screen saves the workout (heart rate, laps per phase, distance and climb from the logged treadmill settings) as a `.tcx` file that Strava and Garmin Connect import. On a phone it opens the share sheet.
- The timer follows the wall clock, so it keeps running if the browser is in the background. Paused time is excluded even when browser timers are suspended. Pause, Skip and End first settle the time since the last timer tick; a late Skip cannot also discard a phase that just started naturally.
