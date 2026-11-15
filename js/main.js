// App entry point: wires settings, screens, storage, the workout session and the HR source.

import { t, setLang } from './i18n.js';
import { loadSettings, saveSettings, clone, hasMaxHr, updateHeartRateSettings, simMaxHr, applyMaxHrTest } from './settings.js';
import { buildPlan, buildTestPlan } from './workout.js';
import { activityOf, phaseTargets, targetsPath } from './activities.js';
import { updateDeviceSettings } from './straps.js';
import { WorkoutSession } from './session.js';
import { ReadySession } from './ready.js';
import { HrSimulator, profileBias } from './simulator.js';
import { StrapConnection, bluetoothSupported } from './ble.js';
import { keepScreenOn, releaseScreen } from './wakelock.js';
import * as store from './storage.js';
import { recommendNext } from './stats.js';
import { buildModels, plannedSettings, currentVo2max, vo2maxOf } from './estimate.js';
import { sessionsCsv, makeBackup, parseBackup } from './backup.js';
import { fmtClock } from './format.js';
import { showScreen, toast } from './ui/dom.js';
import { renderHome, strapCardHtml } from './ui/home.js';
import { WorkoutView } from './ui/workout-view.js';
import { ReadyView } from './ui/ready-view.js';
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
  ready: null,
  view: null,
  strap: null,
  btSupported: bluetoothSupported(),
  storage: null,
  liveBpm: null,
  liveHrAt: -Infinity,
  includeSim: true,
  progressActivity: null,
  models: {}, // per-activity history models for the automatic interval plan
};

const screens = {};
for (const id of ['home', 'ready', 'workout', 'summary', 'history', 'detail', 'progress', 'settings', 'onboarding']) {
  screens[id] = document.getElementById('screen-' + id);
}

function applyLang() {
  document.documentElement.lang = setLang(app.settings.lang);
}

function persist() {
  saveSettings(app.settings);
}

/** Rebuild the history models after workouts were added, changed or removed. */
async function refreshModels() {
  try {
    app.records = await store.listWorkouts();
    app.models = buildModels(app.records);
  } catch (_) {
    app.records = [];
    app.models = {};
  }
}

/** Settings the next workout will use (automatic interval target applied) and the estimate. */
const planned = () => plannedSettings(app.settings, app.models);

const useSimulator = () => !app.btSupported || app.settings.hrSource === 'sim';

// ---------- strap ----------

function setupStrap() {
  if (!app.btSupported) return;
  const strap = (app.strap = new StrapConnection());
  strap.on('hr', (m) => {
    app.liveBpm = m.bpm;
    app.liveHrAt = Date.now();
    if (app.ready && !app.ready.sim) app.ready.pushHr(m.bpm, m.rr);
    if (app.session && !app.session.sim) app.session.pushHr(m.bpm, m.rr, m.contact);
    const el = document.querySelector('[data-live-bpm]');
    if (el) el.textContent = m.bpm;
  });
  strap.on('battery', ({ level }) => {
    if (app.session && !app.session.sim) app.session.setBattery(level);
    refreshStrapCard();
  });
  strap.on('state', ({ state }) => {
    if (state !== 'connected') app.liveBpm = null;
    if (app.session && !app.session.sim) app.session.setStrapStatus(state === 'connected', strap.contact);
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
  app.next = planned();
  app.vo2 = currentVo2max(app.records || [], activityOf(app.settings).id, { kg: app.settings.weightKg, restHr: app.settings.restHr });
  renderHome(screens.home, app, {
    start: () => startWorkout(),
    startTest: () => startWorkout('maxTest'),
    setActivity(id) {
      app.settings.activity = id;
      persist();
      const y = window.scrollY;
      showHome();
      window.scrollTo(0, y);
    },
    nav(to) {
      if (to === 'history') showHistory();
      else if (to === 'progress') showProgress();
      else if (to === 'settings') showSettings('menu');
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

/** A simulated athlete for the current activity, calibrated to its planned interval. */
function makeSim(s, bias = profileBias(s.dev.simProfile)) {
  const activity = activityOf(s);
  const zone = s.zones.interval;
  return new HrSimulator({
    maxHr: simMaxHr(s),
    restHr: s.restHr,
    activity: activity.id,
    reference: activity.controls.length ? phaseTargets(s).interval : null,
    intervalTargetPct: (zone[0] + zone[1]) / 2,
    bias,
  });
}

/** kind: 'workout' (the planned 4×4) or 'maxTest' (the HRmax field test). */
async function startWorkout(kind = 'workout') {
  if (app.ready || app.session) return;
  if (kind === 'workout' && !hasMaxHr(app.settings)) {
    const choice = await choiceDialog({
      title: t('start.noMaxTitle'),
      text: t('start.noMaxText'),
      choices: [
        { value: 'test', label: t('test.start'), kind: 'primary' },
        { value: 'settings', label: t('nav.settings') },
        { value: null, label: t('wo.cancel') },
      ],
    });
    if (choice === 'settings') showSettings('heart');
    if (choice !== 'test') return;
    kind = 'maxTest';
  }
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

  const { settings: s, estimate } = kind === 'maxTest' ? { settings: app.settings, estimate: null } : planned();
  const plan = kind === 'maxTest' ? buildTestPlan(s) : buildPlan(s);
  const extra = { model: app.models[activityOf(s).id] || null, estimate };
  showReady(s, plan, sim ? makeSim(s) : null, screenOn, extra);
}

function showReady(settings, plan, sim, screenOn, extra = {}) {
  const ready = new ReadySession({ sim });
  const strap = sim ? null : app.strap;
  if (strap && app.liveBpm != null) ready.pushHr(app.liveBpm, [], app.liveHrAt);
  app.ready = ready;
  let session = null;
  const cleanup = () => {
    clearInterval(timer);
    ready.cancel();
    view.destroy();
    app.ready = null;
  };
  const view = new ReadyView(screens.ready, ready, plan, strap, settings, {
    start: () => ready.startCountdown(),
    cancel() {
      cleanup();
      releaseScreen();
      showHome();
    },
  });
  const timer = setInterval(() => ready.tick(), 100);
  ready.on('finish', () => {
    const bpm = ready.snapshot().bpm;
    cleanup();
    session = new WorkoutSession({ settings, plan, sim, timeScale: settings.dev.timeScale, ...extra });
    if (strap) {
      if (strap.battery != null) session.setBattery(strap.battery);
      if (strap.state === 'connected' && bpm != null) session.pushHr(bpm, ready.lastRr, strap.contact, ready.lastHrAt);
    }
    runSession(session);
    session.start();
  });
  showScreen('ready');
  screenOn.then((how) => {
    if (!how && (app.ready === ready || (session && app.session === session))) toast(t('wo.noWakeLock'), 6000);
  });
}

/** Show the workout screen for a new or restored session and keep it saved. */
function runSession(session) {
  app.session = session;
  const strap = session.sim ? null : app.strap;
  if (!session.sim) session.setStrapStatus(!!strap && strap.state === 'connected', strap ? strap.contact : null);
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
  await refreshModels();
  if (!app.askedPersist) {
    app.askedPersist = true;
    store.requestPersist().then(async () => {
      app.storage = await store.storageInfo();
    });
  }
}

/** Plan the next session's interval target from a recommendation. */
function applyRecommendation(r) {
  if (r.applicable === false) return;
  setPath(app.settings, targetsPath(r.activity || 'treadmill') + '.interval', { ...r.next });
  persist();
}

function showSummary(rec) {
  const r = recommendNext(rec);
  renderSummary(screens.summary, rec, {
    recommendation: r,
    autoPlan: app.settings.intervalPlan === 'auto' && rec.kind !== 'maxTest' && activityOf(rec.settings).controls.length > 0,
    nextEstimate: () => planned().estimate,
    vo2: rec.kind === 'maxTest' ? null : vo2maxOf(rec, app.settings.weightKg, app.settings.restHr),
    profile: app.settings,
    currentMax: hasMaxHr(app.settings) ? app.settings.maxHr : null,
    onApply: () => applyRecommendation(r),
    onApplyTest(bpm) {
      if (applyMaxHrTest(app.settings, bpm, rec.activity || activityOf(rec.settings).id, rec.startedAt)) persist();
    },
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
      await refreshModels();
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
    activity: app.progressActivity || app.settings.activity,
    onActivity(id) {
      app.progressActivity = id;
      showProgress();
    },
    includeSim: app.includeSim,
    profile: app.settings,
    onToggleSim(v) {
      app.includeSim = v;
      showProgress();
    },
  });
  showScreen('progress');
}

// ---------- settings, backup ----------

/** page: a Settings subpage to open ('menu' for the list); omitted keeps the open one. */
function showSettings(page) {
  renderSettings(screens.settings, app.settings, {
    page,
    storage: app.storage,
    onBack: showHome,
    onChange(path, value) {
      if (path === 'coachingEnabled' || path === 'warmupCheck') value = value === 'true';
      if (!updateHeartRateSettings(app.settings, path, value) && !updateDeviceSettings(app.settings, path, value)) {
        setPath(app.settings, path, value);
      }
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
    startTest: () => startWorkout('maxTest'),
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
  await refreshModels();
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
    const sim = snap.source === 'sim' ? makeSim(s) : null;
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
  if (app.ready) {
    if (document.visibilityState !== 'visible') app.ready.resetCountdown();
    else app.ready.tick();
  }
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
  await refreshModels();
  if (app.settings.onboarded) showHome();
  else showOnboarding();
  const current = await store.loadCurrent().catch(() => null);
  if (current) offerRecovery(current);
}

init();

// Handy for poking at the app from the devtools console.
window.fjord = app;
