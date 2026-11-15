import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, clone, hasMaxHr, applyMaxHrTest, updateHeartRateSettings, maxHrTestPending, simMaxHr, mergeDeep } from '../js/settings.js';
import { activityById, activityOf, phaseTargets, targetsPath, preferredControls } from '../js/activities.js';
import { buildPlan, buildTestPlan } from '../js/workout.js';
import { WorkoutSession, peakHr } from '../js/session.js';
import { WorkoutCoach } from '../js/coaching.js';
import { HrSimulator, vo2Machine } from '../js/simulator.js';
import { recommendNext, progress, workoutStats } from '../js/stats.js';
import { toTcx } from '../js/export.js';
import { samplesCsv, sessionsCsv } from '../js/backup.js';
import { strapById, updateDeviceSettings, devicesOfKind } from '../js/straps.js';
import { makeRecord } from './helpers.js';

function settingsFor(activity, over = {}) {
  const s = clone(DEFAULT_SETTINGS);
  s.maxHr = 200;
  s.maxHrSource = 'known';
  s.activity = activity;
  return Object.assign(s, over);
}

function driver(session) {
  session._stopTimer();
  let c = Date.now();
  session.now = () => c;
  session._lastTick = c;
  return (ms, each) => {
    session._stopTimer(); // start() starts its own timer
    for (let k = 0; k < ms; k += 1000) {
      c += 1000;
      if (each) each();
      session.tick();
    }
  };
}

test('activities: old settings and records default to the treadmill', () => {
  assert.equal(activityOf({}).id, 'treadmill');
  assert.equal(activityById('nope').id, 'treadmill');
  assert.equal(targetsPath('treadmill'), 'treadmill');
  assert.equal(targetsPath('bike'), 'targets.bike');
  const old = mergeDeep(DEFAULT_SETTINGS, { treadmill: { interval: { speed: 11, incline: 1 } } });
  assert.equal(old.activity, 'treadmill');
  assert.deepEqual(old.targets.bike.interval, { level: 12, cadence: 90 });
});

test('activities: plans carry the machine targets of the chosen activity', () => {
  assert.deepEqual(buildPlan(settingsFor('bike')).phases[1].target, { level: 12, cadence: 90 });
  assert.deepEqual(buildPlan(settingsFor('stepmill')).phases[1].target, { level: 10 });
  assert.deepEqual(buildPlan(settingsFor('run')).phases[1].target, {});
  assert.deepEqual(phaseTargets(settingsFor('ride')).interval, {});
});

test('activities: preferred controls follow adjustPref and the activity', () => {
  assert.deepEqual(preferredControls(settingsFor('bike')).map((c) => c.key), ['level']);
  assert.deepEqual(preferredControls(settingsFor('bike', { adjustPref: 'incline' })).map((c) => c.key), ['cadence']);
  assert.deepEqual(preferredControls(settingsFor('rower', { adjustPref: 'both' })).map((c) => c.key), ['power', 'rate']);
  assert.deepEqual(preferredControls(settingsFor('stepmill', { adjustPref: 'incline' })).map((c) => c.key), ['level']);
  assert.deepEqual(preferredControls(settingsFor('run')), []);
});

test('session: a gym bike logs level and cadence with their own limits', () => {
  const settings = settingsFor('bike');
  const session = new WorkoutSession({ settings, plan: buildPlan(settings) });
  const step = driver(session);
  session.start();
  assert.deepEqual(session.treadmillLog[0], { t: 0, level: 6, cadence: 85, src: 'plan' });
  step(3000);
  session.adjust('level', 1);
  session.adjust('cadence', 5);
  session.adjust('speed', 1); // not a bike control
  assert.deepEqual(session.actual, { level: 7, cadence: 90 });
  assert.equal(session.treadmillLog.length, 2);
  assert.deepEqual(session.treadmillLog[1], { t: 3, level: 7, cadence: 90, src: 'user' });
  for (let i = 0; i < 40; i++) session.adjust('level', 1);
  assert.equal(session.actual.level, 30);
  session.dispose();
  const rec = session.toRecord();
  assert.equal(rec.activity, 'bike');
  assert.equal(rec.kind, 'workout');
});

test('session: outdoors there is nothing to log but the workout still runs', () => {
  const settings = settingsFor('run');
  const session = new WorkoutSession({ settings, plan: buildPlan(settings) });
  const step = driver(session);
  session.start();
  assert.deepEqual(session.actual, {});
  session.adjust('speed', 1);
  step(5000, () => session.pushHr(100)); // 50 % HRmax, below the warm-up zone
  assert.deepEqual(session.actual, {});
  assert.equal(session.snapshot().zone, 'below');
  session.dispose();
});

test('coach: bike suggests one level, outdoors a plain "faster" without values', () => {
  const run = (settings, actual) => {
    const coach = new WorkoutCoach();
    const s = {
      state: 'running', phaseIndex: 1, phase: { type: 'interval', zone: [85, 95] }, phaseElapsedSec: 100,
      phaseRemainingSec: 120, elapsedSec: 700, bpm: 150, smooth: 150, trend: 0, actual,
    };
    coach.update(s, settings);
    s.elapsedSec += 20;
    return coach.update(s, settings);
  };
  const bike = run(settingsFor('bike'), { level: 12, cadence: 90 });
  assert.deepEqual([bike.kind, bike.from, bike.to], ['level', 12, 13]);
  const rower = run(settingsFor('rower', { adjustPref: 'incline' }), { power: 200, rate: 26 });
  assert.deepEqual([rower.kind, rower.to], ['rate', 27]);
  const out = run(settingsFor('run'), {});
  assert.equal(out.kind, null);
  assert.equal(out.direction, 1);
});

test('simulator: every machine model rises with effort', () => {
  assert.ok(vo2Machine('bike', { level: 14, cadence: 90 }) > vo2Machine('bike', { level: 8, cadence: 90 }));
  assert.ok(vo2Machine('stepmill', { level: 10 }) > vo2Machine('stepmill', { level: 5 }));
  assert.ok(vo2Machine('rower', { power: 250 }) > vo2Machine('rower', { power: 150 }));
  const sim = new HrSimulator({ maxHr: 190, activity: 'bike', reference: { level: 12, cadence: 90 }, rand: () => 0.5 });
  let hr = 0;
  for (let i = 0; i < 600; i++) hr = sim.step(1, { values: { level: 12, cadence: 90 } });
  assert.ok(hr > 155 && hr < 185, String(hr));
  const out = new HrSimulator({ maxHr: 190, activity: 'run', reference: null, rand: () => 0.5 });
  for (let i = 0; i < 600; i++) hr = out.step(1, { effort: out.zoneEffort([85, 95]) });
  assert.ok(hr > 155 && hr < 185, String(hr));
});

test('recommendNext: bike levels, outdoor effort only', () => {
  const bike = makeRecord({ hr: (p) => (p.type === 'interval' ? 160 : 120), settings: { activity: 'bike' } });
  bike.finalTargets = clone(bike.settings.targets.bike);
  const r = recommendNext(bike);
  assert.equal(r.action, 'harder');
  assert.equal(r.activity, 'bike');
  assert.deepEqual(r.next, { level: 14, cadence: 90 });
  const both = makeRecord({ hr: (p) => (p.type === 'interval' ? 166 : 120), settings: { activity: 'rower', adjustPref: 'both' } });
  both.finalTargets = clone(both.settings.targets.rower);
  assert.deepEqual(recommendNext(both).next, { power: 230, rate: 27 });
  const out = makeRecord({ hr: (p) => (p.type === 'interval' ? 160 : 120), settings: { activity: 'run' } });
  out.finalTargets = { warmup: {}, interval: {}, recovery: {}, cooldown: {} };
  const o = recommendNext(out);
  assert.equal(o.action, 'harder');
  assert.equal(o.applicable, false);
});

test('stats and export: speed-only numbers stay treadmill-only', () => {
  const rec = makeRecord({ hr: () => 170, settings: { activity: 'bike' } });
  rec.treadmillLog = [{ t: 0, level: 10, cadence: 90, src: 'plan' }];
  const o = workoutStats(rec).overall;
  assert.equal(o.efficiency, null);
  assert.equal(o.avgIntervalSpeed, null);
  assert.equal(o.avgInterval.level, 10);
  const tcx = toTcx(rec);
  assert.match(tcx, /Sport="Biking"/);
  assert.doesNotMatch(tcx, /<AltitudeMeters>/);
  assert.match(tcx, /gym bike/);
  assert.equal(samplesCsv(rec).split('\r\n')[0], 'second,time_utc,hr_bpm,phase,phase_number,level,cadence_rpm');
  const head = sessionsCsv([rec]).split('\r\n')[0].split(',');
  const row = sessionsCsv([rec]).split('\r\n')[1].split(',');
  assert.equal(row[head.indexOf('activity')], 'bike');
  assert.equal(row[head.indexOf('avg_interval_level')], '10');
});

test('max HR test: plan, peak and record', () => {
  const settings = clone(DEFAULT_SETTINGS);
  const plan = buildTestPlan(settings);
  assert.equal(plan.kind, 'maxTest');
  assert.deepEqual(plan.phases.map((p) => p.effort), ['easy', 'hard', 'easy', 'max', 'easy']);
  assert.equal(plan.totalSec, 1380);
  const session = new WorkoutSession({ settings, plan });
  assert.equal(session.settings.coachingEnabled, false);
  const step = driver(session);
  session.start();
  let bpm = 120;
  step(1380 * 1000, () => session.pushHr((bpm = Math.min(188, bpm + 0.05))));
  assert.equal(session.state, 'finished');
  assert.equal(session.snapshot().zone, null);
  const rec = session.toRecord();
  assert.equal(rec.kind, 'maxTest');
  assert.ok(rec.peakHr >= 186 && rec.peakHr <= 188, String(rec.peakHr));
  assert.equal(recommendNext(rec).reason, 'test');
  assert.equal(progress([rec, makeRecord({ hr: () => 170 })]).total, 1);
});

test('peakHr ignores a single spike', () => {
  const samples = [150, 150, 150, 150, 150, 230, 150, 150, 150, 150];
  assert.equal(peakHr(samples), 166);
  assert.equal(peakHr([null, null]), null);
});

test('settings: a max test result is a personal HRmax only once it is applied', () => {
  const s = clone(DEFAULT_SETTINGS);
  updateHeartRateSettings(s, 'maxHrSource', 'test');
  assert.equal(hasMaxHr(s), false);
  assert.equal(maxHrTestPending(s), true);
  assert.equal(simMaxHr(s), 190);
  s.age = 40;
  assert.equal(simMaxHr(s), 180);
  assert.equal(applyMaxHrTest(s, 250, 'run'), false);
  assert.equal(applyMaxHrTest(s, 186.4, 'run', '2026-11-15T10:00:00.000Z'), true);
  assert.equal(hasMaxHr(s), true);
  assert.deepEqual(s.maxHrTest, { bpm: 186, at: '2026-11-15T10:00:00.000Z', activity: 'run' });
  updateHeartRateSettings(s, 'maxHrSource', 'age');
  assert.equal(s.maxHr, 180);
  updateHeartRateSettings(s, 'maxHrSource', 'test');
  assert.equal(s.maxHr, 186);
  assert.equal(hasMaxHr(s), true);
  updateHeartRateSettings(s, 'maxHr', 190);
  assert.equal(s.maxHrSource, 'known');
});

test('devices: switching between strap and watch picks a matching model', () => {
  const s = clone(DEFAULT_SETTINGS);
  assert.equal(strapById(s.strapModel).kind, 'strap');
  assert.equal(updateDeviceSettings(s, 'deviceKind', 'watch'), true);
  assert.equal(s.strapModel, 'other-watch');
  s.strapModel = 'garmin-watch';
  updateDeviceSettings(s, 'deviceKind', 'watch');
  assert.equal(s.strapModel, 'garmin-watch');
  updateDeviceSettings(s, 'deviceKind', 'strap');
  assert.equal(s.strapModel, 'other');
  assert.equal(updateDeviceSettings(s, 'maxHr', 190), false);
  assert.ok(devicesOfKind('watch').every((d) => d.tips.length));
});
