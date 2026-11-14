// App entry point: wires settings, screens, storage, the workout session and the HR source.

import { t, setLang } from './i18n.js';
import { loadSettings, saveSettings, clone } from './settings.js';
import { buildPlan } from './workout.js';
import { WorkoutSession } from './session.js';
import { HrSimulator, profileBias } from './simulator.js';
import { StrapConnection, bluetoothSupported } from './ble.js';
import { keepScreenOn, releaseScreen } from './wakelock.js';
import * as store from './storage.js';
import { recommendNext } from './stats.js';
import { sessionsCsv, makeBackup, parseBackup } from './backup.js';
import { fmtClock } from './format.js';
import { showScreen, toast } from './ui/dom.js';
import { renderHome, strapCardHtml } from './ui/home.js';
import { WorkoutView } from './ui/workout-view.js';
import { renderSummary } from './ui/summary.js';
import { renderHistory } from './ui/history.js';
import { renderDetail } from './ui/detail.js';
import { renderProgress } from './ui/progress.js';
import { renderSettings } from './ui/settings-view.js';
import { renderOnboarding } from './ui/onboarding.js';
import { setPath } from './ui/form.js';
import { saveFile } from './ui/download.js';
import { confirmDialog, choiceDialog, closeModal } from './ui/modal.js';

const MIN_SAVE_SEC = 60; // shorter workouts are treated as false starts
const AUTOSAVE_MS = 5000;

const app = {
  settings: loadSettings(),
  session: null,
  view: null,
  strap: null,
  btSupported: bluetoothSupported(),
  storage: null,
  liveBpm: null,
  includeSim: true,
};

const screens = {};
for (const id of ['home', 'workout', 'summary', 'history', 'detail', 'progress', 'settings', 'onboarding']) {
  screens[id] = document.getElementById('screen-' + id);
}

function applyLang() {
  document.documentElement.lang = setLang(app.settings.lang);
}

function persist() {
  saveSettings(app.settings);
}

const useSimulator = () => !app.btSupported || app.settings.hrSource === 'sim';

// ---------- strap ----------

function setupStrap() {
  if (!app.btSupported) return;
  const strap = (app.strap = new StrapConnection());
  strap.on('hr', (m) => {
    app.liveBpm = m.bpm;
    if (app.session && !app.session.sim) app.session.pushHr(m.bpm, m.rr);
    const el = document.querySelector('[data-live-bpm]');
    if (el) el.textContent = m.bpm;
  });
  strap.on('battery', ({ level }) => {
    if (app.session && !app.session.sim) app.session.setBattery(level);
    refreshStrapCard();
  });
  strap.on('state', ({ state }) => {
    if (state !== 'connected') app.liveBpm = null;
    refreshStrapCard();
  });
  strap.on('disconnect', () => {
    if (app.session && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  });
  strap.on('error', ({ error, cancelled }) => {
    if (!cancelled) toast(t('strap.error', { msg: (error && error.message) || '' }), 6000);
  });
}

function refreshStrapCard() {
  const el = document.getElementById('strap-card');
  if (el && !screens.home.hidden) el.innerHTML = strapCardHtml(app);
}

// ---------- home ----------

function showHome() {
  renderHome(screens.home, app, {
    start: startWorkout,
    nav(to) {
      if (to === 'history') showHistory();
      else if (to === 'progress') showProgress();
      else if (to === 'settings') showSettings();
    },
    setDev(key, value) {
      app.settings.dev[key] = value;
      persist();
    },
    setSource(src) {
      app.settings.hrSource = src;
      persist();
      refreshStrapCard();
    },
    connect: () => app.strap && app.strap.connect(),
    disconnect: () => app.strap && app.strap.disconnect(),
  });
  showScreen('home');
}

// ---------- workout ----------

async function startWorkout() {
  // Start these inside the tap: the screen-on video and Bluetooth need a user gesture.
  const screenOn = keepScreenOn();
  let sim = useSimulator();
  if (!sim && app.strap.state !== 'connected') {
    const choice = await choiceDialog({
      title: t('start.noStrapTitle'),
      text: t('start.noStrapText'),
      choices: [
        { value: 'connect', label: t('home.connect'), kind: 'primary' },
        { value: 'sim', label: t('start.useSim') },
        { value: null, label: t('wo.cancel') },
      ],
    });
    if (!choice) return releaseScreen();
    if (choice === 'sim') sim = true;
    else if (!(await app.strap.connect())) {
      refreshStrapCard();
      return releaseScreen();
    }
  }

  const s = app.settings;
  const plan = buildPlan(s);
  const zone = s.zones.interval;
  const simulator = sim
    ? new HrSimulator({
        maxHr: s.maxHr,
        restHr: s.restHr,
        reference: s.treadmill.interval,
        intervalTargetPct: (zone[0] + zone[1]) / 2,
        bias: profileBias(s.dev.simProfile),
      })
    : null;
  const session = new WorkoutSession({ settings: s, plan, sim: simulator, timeScale: s.dev.timeScale });
  if (!sim && app.strap.battery != null) session.setBattery(app.strap.battery);
  runSession(session);
  session.start();
  screenOn.then((how) => {
    if (!how && app.session === session) toast(t('wo.noWakeLock'), 6000);
  });
}

/** Show the workout screen for a new or restored session and keep it saved. */
function runSession(session) {
  app.session = session;
  const strap = session.sim ? null : app.strap;
  app.view = new WorkoutView(
    screens.workout,
    session,
    {
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
      reconnect() {
        if (!app.strap) return;
        if (app.strap.device) app.strap.reconnect();
        else app.strap.connect();
      },
    },
    strap,
  );

  // Crash/reload protection: keep a snapshot of the running workout.
  let last = 0;
  const save = () => {
    if (session.state === 'finished' || app.session !== session) return;
    last = Date.now();
    store.saveCurrent(session.toSnapshot()).catch(() => {});
  };
  session.on('tick', () => {
    if (Date.now() - last >= AUTOSAVE_MS) save();
  });
  session.on('phase', save);
  session.on('state', save);
  session.on('treadmill', save);
  app.saveNow = save;
  session.on('finish', () => finishWorkout(session));
  showScreen('workout');
}

async function finishWorkout(session) {
  closeModal(); // the workout may finish on its own while "End workout?" is open
  releaseScreen();
  const rec = session.toRecord();
  if (app.strap && !session.sim) rec.strapName = app.strap.name || null;
  if (app.view) app.view.destroy();
  app.view = null;
  app.session = null;
  app.saveNow = null;
  await store.clearCurrent().catch(() => {});

  if (rec.durationSec < MIN_SAVE_SEC) {
    toast(t('sum.tooShort'));
    showHome();
    return;
  }
  await saveRecord(rec);
  showSummary(rec);
}

async function saveRecord(rec) {
  try {
    await store.saveWorkout(rec);
  } catch (e) {
    toast(t('store.saveFailed'), 6000);
  }
  if (!app.askedPersist) {
    app.askedPersist = true;
    store.requestPersist().then(async () => {
      app.storage = await store.storageInfo();
    });
  }
}

/** Plan the next session's interval target from a recommendation. */
function applyRecommendation(r) {
  app.settings.treadmill.interval = { ...r.next };
  persist();
}

function showSummary(rec) {
  const r = recommendNext(rec);
  // Real workouts update the plan automatically (including keeping what was actually
  // run); simulated ones only when asked.
  let applied = false;
  if (rec.source !== 'sim' && r.action !== 'none') {
    applyRecommendation(r);
    applied = true;
  }
  renderSummary(screens.summary, rec, {
    recommendation: r,
    applied,
    onApply: () => applyRecommendation(r),
    async onDone(updated) {
      await saveRecord(updated);
      showHome();
    },
    async onDetails(updated) {
      await saveRecord(updated);
      showDetail(updated.id, 'home');
    },
  });
  showScreen('summary');
}

// ---------- history, detail, progress ----------

async function showHistory() {
  const records = await store.listWorkouts();
  renderHistory(screens.history, records, {
    onBack: showHome,
    onOpen: (id) => showDetail(id, 'history'),
    onProgress: showProgress,
    onExportCsv: exportCsv,
  });
  showScreen('history');
}

async function showDetail(id, from = 'history') {
  const rec = await store.getWorkout(id);
  if (!rec) return showHistory();
  const back = from === 'home' ? showHome : showHistory;
  renderDetail(screens.detail, rec, {
    onBack: back,
    onSave: (r) => saveRecord(r),
    async onDelete(r) {
      await store.deleteWorkout(r.id);
      toast(t('det.deleted'));
      showHistory();
    },
  });
  showScreen('detail');
}

async function showProgress() {
  const records = await store.listWorkouts();
  renderProgress(screens.progress, records, {
    onBack: showHome,
    includeSim: app.includeSim,
    onToggleSim(v) {
      app.includeSim = v;
      showProgress();
    },
  });
  showScreen('progress');
}

// ---------- settings, backup ----------

function showSettings() {
  renderSettings(screens.settings, app.settings, {
    storage: app.storage,
    onBack: showHome,
    onChange(path, value) {
      setPath(app.settings, path, value);
      if (path === 'maxHr') app.settings.maxHrSource = 'known';
      // Keep every zone low ≤ high.
      const m = /^zones\.(\w+)\.(0|1)$/.exec(path);
      if (m) {
        const z = app.settings.zones[m[1]];
        if (z[0] > z[1]) {
          if (m[2] === '0') z[1] = z[0];
          else z[0] = z[1];
          showSettingsKeepScroll();
        }
      }
      persist();
    },
    onLang(lang) {
      app.settings.lang = lang;
      persist();
      applyLang();
      showSettingsKeepScroll();
    },
    exportBackup,
    importBackup,
    exportCsv,
    onboarding: () => showOnboarding(),
  });
  showScreen('settings');
}

function showSettingsKeepScroll() {
  const y = window.scrollY;
  showSettings();
  window.scrollTo(0, y);
}

const today = () => new Date().toISOString().slice(0, 10);

async function exportBackup() {
  const workouts = await store.listWorkouts();
  const data = makeBackup({ settings: app.settings, workouts });
  const name = `fjord-backup-${today()}.json`;
  const how = await saveFile(name, 'application/json', JSON.stringify(data));
  if (how === 'downloaded') toast(t('common.saved', { name }));
}

async function exportCsv() {
  const workouts = await store.listWorkouts();
  const name = `fjord-sessions-${today()}.csv`;
  const how = await saveFile(name, 'text/csv', sessionsCsv(workouts));
  if (how === 'downloaded') toast(t('common.saved', { name }));
}

async function importBackup(file) {
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (_) {
    parsed = { ok: false, error: 'notJson' };
  }
  if (!parsed.ok) {
    toast(t('backup.err.' + parsed.error), 6000);
    return;
  }
  const ok = await confirmDialog({
    title: t('backup.importTitle'),
    text: t(parsed.settings ? 'backup.importTextSettings' : 'backup.importText', { n: parsed.workouts.length }),
    yes: t('backup.import'),
    no: t('wo.cancel'),
  });
  if (!ok) return;
  const res = await store.addWorkouts(parsed.workouts);
  if (parsed.settings) {
    app.settings = { ...parsed.settings, onboarded: true };
    persist();
    applyLang();
  }
  toast(t('backup.imported', { added: res.added, existing: res.existing }), 6000);
  showSettings();
}

// ---------- onboarding ----------

function showOnboarding() {
  const draft = clone(app.settings);
  renderOnboarding(screens.onboarding, draft, {
    btSupported: app.btSupported,
    onLang(lang) {
      app.settings.lang = lang;
      applyLang();
    },
    onFinish(done) {
      app.settings = { ...done, onboarded: true };
      persist();
      applyLang();
      showHome();
    },
  });
  showScreen('onboarding');
}

// ---------- crash recovery ----------

async function offerRecovery(snap) {
  const elapsed = (snap.engine && snap.engine.elapsedMs) / 1000 || 0;
  const when = new Date(snap.savedAt).toLocaleString(t('locale'), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const choice = await choiceDialog({
    title: t('rescue.title'),
    text: t('rescue.text', { when, time: fmtClock(elapsed) }),
    choices: [
      { value: 'resume', label: t('rescue.resume'), kind: 'primary' },
      { value: 'save', label: t('rescue.save') },
      { value: 'discard', label: t('rescue.discard'), kind: 'danger' },
    ],
  });
  if (choice === 'resume') {
    const s = snap.settings;
    const sim =
      snap.source === 'sim'
        ? new HrSimulator({ maxHr: s.maxHr, restHr: s.restHr, reference: s.treadmill.interval, bias: profileBias(s.dev.simProfile) })
        : null;
    if (!sim && !app.btSupported) {
      toast(t('rescue.needStrap'), 6000);
      return offerRecovery(snap);
    }
    const session = new WorkoutSession({ settings: s, plan: snap.plan, sim, timeScale: snap.timeScale, restore: snap });
    runSession(session);
    session.attach();
    keepScreenOn();
  } else if (choice === 'save') {
    const rec = WorkoutSession.recordFromSnapshot(snap);
    await store.clearCurrent().catch(() => {});
    if (rec.durationSec < MIN_SAVE_SEC) {
      toast(t('sum.tooShort'));
      return;
    }
    await saveRecord(rec);
    showSummary(rec);
  } else if (choice === 'discard') {
    await store.clearCurrent().catch(() => {});
  }
  // Dismissed: leave it for next time.
}

// ---------- page lifecycle ----------

document.addEventListener('visibilitychange', () => {
  if (!app.session) return;
  if (document.visibilityState === 'visible') app.session.tick();
  else if (app.saveNow) app.saveNow();
});

window.addEventListener('pagehide', () => {
  if (app.saveNow) app.saveNow();
});

window.addEventListener('beforeunload', (e) => {
  const st = app.session && app.session.state;
  if (st === 'running' || st === 'paused') {
    if (app.saveNow) app.saveNow();
    e.preventDefault();
    e.returnValue = '';
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional (e.g. Firefox private windows) */
  });
}

async function init() {
  applyLang();
  setupStrap();
  app.storage = await store.storageInfo();
  if (app.settings.onboarded) showHome();
  else showOnboarding();
  const current = await store.loadCurrent().catch(() => null);
  if (current) offerRecovery(current);
}

init();

// Handy for poking at the app from the devtools console.
window.fjord = app;
