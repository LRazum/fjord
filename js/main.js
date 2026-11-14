// App entry point: wires settings, screens, the workout session and the HR source.

import { t, setLang } from './i18n.js';
import { loadSettings, saveSettings } from './settings.js';
import { buildPlan } from './workout.js';
import { WorkoutSession } from './session.js';
import { HrSimulator, profileBias } from './simulator.js';
import { keepScreenOn, releaseScreen } from './wakelock.js';
import { showScreen, toast } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { WorkoutView } from './ui/workout-view.js';
import { renderSummary } from './ui/summary.js';
import { confirmDialog, closeModal } from './ui/modal.js';

const app = {
  settings: loadSettings(),
  session: null,
  view: null,
};

const screens = {
  home: document.getElementById('screen-home'),
  workout: document.getElementById('screen-workout'),
  summary: document.getElementById('screen-summary'),
};

function applyLang() {
  const lang = setLang(app.settings.lang);
  document.documentElement.lang = lang;
}

function persist() {
  saveSettings(app.settings);
}

function showHome() {
  renderHome(screens.home, app, {
    start: startWorkout,
    setDev(key, value) {
      app.settings.dev[key] = value;
      persist();
    },
    setLang(lang) {
      app.settings.lang = lang;
      persist();
      applyLang();
      showHome();
    },
  });
  showScreen('home');
}

function startWorkout() {
  const s = app.settings;
  const plan = buildPlan(s);
  const zone = s.zones.interval;
  const sim = new HrSimulator({
    maxHr: s.maxHr,
    restHr: s.restHr,
    reference: s.treadmill.interval,
    intervalTargetPct: (zone[0] + zone[1]) / 2,
    bias: profileBias(s.dev.simProfile),
  });
  const session = new WorkoutSession({ settings: s, plan, sim, timeScale: s.dev.timeScale });
  app.session = session;
  app.view = new WorkoutView(screens.workout, session, {
    async requestEnd() {
      const ok = await confirmDialog({
        title: t('wo.endTitle'),
        text: t('wo.endText'),
        yes: t('wo.endYes'),
        no: t('wo.cancel'),
        danger: true,
      });
      if (ok) session.end();
    },
  });
  session.on('finish', () => finishWorkout(session));

  // Must run inside the tap on Start: the video fallback needs a user gesture.
  keepScreenOn().then((how) => {
    app.screenOn = how;
    if (!how && app.session === session) toast(t('wo.noWakeLock'), 6000);
  });

  showScreen('workout');
  session.start();
}

function finishWorkout(session) {
  closeModal(); // the workout may finish on its own while "End workout?" is open
  releaseScreen();
  const rec = session.toRecord();
  if (app.view) app.view.destroy();
  app.view = null;
  app.session = null;
  renderSummary(screens.summary, rec, { done: showHome });
  showScreen('summary');
}

// Timers are throttled or suspended in the background; catch up as soon as we're back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.session) app.session.tick();
});

window.addEventListener('beforeunload', (e) => {
  const st = app.session && app.session.state;
  if (st === 'running' || st === 'paused') {
    e.preventDefault();
    e.returnValue = '';
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional (e.g. Firefox private windows) */
  });
}

applyLang();
showHome();

// Handy for poking at the app from the devtools console.
window.fjord = app;
