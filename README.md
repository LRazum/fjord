# Fjord

Norwegian 4×4 interval training on a treadmill, guided by live heart rate from a Bluetooth chest strap.

- Vanilla HTML/CSS/JS (ES modules). No build step and no dependencies.
- UI in English by default; Croatian is available via the EN/HR switch.
- Runs in **Bluefy** on iPhone, which has Web Bluetooth, for the real strap. Everything else (simulator, workout engine, UI) runs in **Firefox** on Linux, which is the development browser.
- All data stays on the device. There is no server, no account and no analytics.

## Status

| Milestone | Contents | State |
|---|---|---|
| 1 | Skeleton, workout state machine, HR simulator, workout screen, offline shell | ✅ |
| 2 | Bluetooth strap connection and parsing | — |
| 3 | Coaching, voice and sounds | — |
| 4 | Storage, history, statistics, charts | — |
| 5 | Onboarding, settings, export/import, polish | — |

## Run locally on Linux

Any static file server works. Python is already on the system:

```bash
cd fjord
python3 -m http.server 8000
```

Open <http://localhost:8000> in Firefox. `localhost` counts as a secure context, so the service worker, Wake Lock and the other secure-context APIs all work over plain HTTP.

Firefox notes:

- **Firefox has no Web Bluetooth.** Fjord detects this, hides the strap connection and uses the simulator. Real strap testing happens on the iPhone (see below).
- **Developer options** (*Developer*) are at the bottom of the home screen. *Time speed 10×* runs the workout clock 10× faster, so a whole 40-minute session takes 4 minutes. *Simulated runner* chooses whether the planned treadmill settings are too easy, a good fit, too hard or random for the simulated runner.
- **Speech** (milestone 3): Firefox on Linux gets its voices from `speech-dispatcher`. If no voices are installed, Fjord falls back to beeps only. To get voices:
  ```bash
  sudo apt install speech-dispatcher espeak-ng
  ```
  Then restart Firefox.
- The service worker is network-first, so a normal reload always picks up your edits. If something looks stale, use Ctrl+Shift+R.
- Private windows don't get a service worker. In milestone 4 they won't get persistent storage either.

## Tests

The pure modules (`workout.js`, `session.js`, `hrmath.js`, `simulator.js`, `charts.js`, `export.js`) have unit tests in `tests/`, written with `node:test`. They need Node 18 or newer:

```bash
sudo apt install nodejs
```

```bash
node --test tests/*.test.js
```

`npm test` runs the same command. There are no packages to install.

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
2. Open `https://<user>.github.io/fjord/` in Bluefy. Allow Bluetooth access when iOS asks (from milestone 2).
3. **Full screen:** tap the Bluefy menu (the ⋯ / settings button in the toolbar) and turn on **Fullscreen** / *Hide toolbar*. Fjord respects the notch and home-indicator safe areas. To get back out, use the small floating Bluefy button.
4. Bookmark the page in Bluefy so you can find it again quickly.
5. After the first load the app works offline: the service worker caches it.
6. **Getting updates:** after you push, wait for Pages to deploy (about 1 minute), then pull to refresh or reload in Bluefy. The network-first service worker serves the new version as soon as the network answers.
7. If the screen still turns off during a workout (Fjord shows a warning when neither Wake Lock nor the silent-video fallback works), set *Settings → Display & Brightness → Auto-Lock → Never* on the iPhone for the session.

> ⚠️ Workouts are stored in Bluefy's browser storage (from milestone 4). Deleting Bluefy, or clearing its website data, deletes your history. Use **Export backup** regularly.

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
  simulator.js      simulated heart rate (pure, no DOM)
  hrmath.js         smoothing, trend, zone hysteresis (pure, no DOM)
  format.js         time/number formatting
  wakelock.js       keeps the screen on (Wake Lock, silent-video fallback)
  charts.js         chart geometry (pure, no DOM)
  export.js         TCX export (pure, no DOM)
  ui/               screens: home, workout, summary, modal, DOM helpers
tests/              node:test unit tests for the pure modules
package.json        only there so `npm test` works; no dependencies
```

When you add a new file, also add it to the `ASSETS` list in `sw.js` and bump `VERSION` there.

## How a workout behaves

- At the start of each phase Fjord assumes you set the treadmill to the target, and logs that. Use **+ / −** to log what you really set; hold a button to repeat.
- A change you make during a phase carries over: if you go to 11.0 km/h in interval 1, interval 2 starts with 11.0 km/h as its target. Recovery, warm-up and cool-down keep their own targets.
- **Skip** needs a second tap within 2.5 s. **End** asks for confirmation.
- The background shows the zone (blue below, green in, red above) and the same state is written under the heart rate. The zone is shown in beats (e.g. 162–180 bpm) and in % HRmax.
- On screens that are tall enough, a small chart shows the last 3 minutes of heart rate against the zone band.
- **Screen on:** Fjord uses the Screen Wake Lock API. Where the browser has none (in-app browsers on iPhone), it plays a tiny silent video off-screen instead, which keeps the display awake. On iOS that video can pause music playing in another app.
- **Export TCX** on the summary screen saves the workout (heart rate, laps per phase, distance and climb from the logged treadmill settings) as a `.tcx` file that Strava and Garmin Connect import. On a phone it opens the share sheet.
- The timer follows the wall clock, so it keeps running if the browser is in the background.
