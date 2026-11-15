import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capacityFrom, costAt, solveFor, workoutCapacity, buildModels, estimateInterval, plannedSettings, warmupCheck, median,
} from '../js/estimate.js';
import { vo2Treadmill, vo2Machine, HrSimulator } from '../js/simulator.js';
import { activityById } from '../js/activities.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';
import { WorkoutSession } from '../js/session.js';
import { buildPlan } from '../js/workout.js';
import { makeRecord } from './helpers.js';

// maxHr 200 and the default resting HR of 60: 90 % HRmax = 180 bpm = 6/7 of HR reserve.
const MAX = 200;

/** A treadmill record whose intervals run at `speed` and end at `intervalHr`. */
function record({ speed = 10.5, intervalHr = 180, warmHr = 140, daysAgo = 1, source = 'ble', id } = {}) {
  const startedAt = new Date(Date.UTC(2026, 10, 15, 17) - daysAgo * 86400000).toISOString();
  const rec = makeRecord({
    startedAt,
    structure: { warmupSec: 300 },
    hr: (p) => (p.type === 'interval' ? intervalHr : p.type === 'warmup' ? warmHr : 130),
    tread: (p) => (p.type === 'interval' ? { speed, incline: 2 } : p.target),
  });
  rec.source = source;
  if (id) rec.id = id;
  return rec;
}

const NOW = new Date(Date.UTC(2026, 10, 15, 18));

test('capacity and cost are inverse at the same heart rate', () => {
  const cost = vo2Treadmill(10.5, 2);
  const cap = capacityFrom(cost, 90, MAX, 60);
  assert.ok(Math.abs(costAt(cap, 90, MAX, 60) - cost) < 1e-9);
  // Higher HR for the same cost means a lower capacity.
  assert.ok(capacityFrom(cost, 93, MAX, 60) < cap);
  // Too little of the HR reserve says nothing.
  assert.equal(capacityFrom(cost, 35, MAX, 60), null);
});

test('solveFor finds the preferred control and snaps it to its step', () => {
  const tm = activityById('treadmill');
  const s = clone(DEFAULT_SETTINGS);
  const r = solveFor(tm, s, { speed: 9, incline: 2 }, vo2Treadmill(11.2, 2));
  assert.deepEqual(r, { key: 'speed', value: 11.2, values: { speed: 11.2, incline: 2 } });
  s.adjustPref = 'incline';
  const i = solveFor(tm, s, { speed: 10, incline: 0 }, vo2Treadmill(10, 4));
  assert.equal(i.key, 'incline');
  assert.equal(i.value, 4);
  // A rower's stroke rate does not change the cost: power is solved instead.
  const rw = activityById('rower');
  s.adjustPref = 'incline';
  const p = solveFor(rw, s, { power: 150, rate: 24 }, vo2Machine('rower', { power: 230 }));
  assert.equal(p.key, 'power');
  assert.equal(p.value, 230);
});

test('workoutCapacity: interval and warm-up from the last 2 min', () => {
  const c = workoutCapacity(record());
  assert.ok(Math.abs(c.interval - capacityFrom(vo2Treadmill(10.5, 2), 90, MAX, 60)) < 1e-9);
  assert.ok(c.warmup > 0);
  assert.ok(Math.abs(c.ratio - c.interval / c.warmup) < 1e-9);
});

test('estimateInterval: a plan that hit the middle of the zone stays where it is', () => {
  const models = buildModels([record({ daysAgo: 1 }), record({ daysAgo: 3 })], NOW);
  assert.equal(models.treadmill.n, 2);
  const s = clone(DEFAULT_SETTINGS);
  s.maxHr = MAX;
  s.maxHrSource = 'known';
  const est = estimateInterval(s, models.treadmill);
  assert.equal(est.values.speed, 10.5);
  assert.equal(est.values.incline, 2);
});

test('estimateInterval: below the zone points faster, above points slower', () => {
  const s = clone(DEFAULT_SETTINGS);
  s.maxHr = MAX;
  s.maxHrSource = 'known';
  const low = buildModels([record({ intervalHr: 166, daysAgo: 1 }), record({ intervalHr: 166, daysAgo: 2 })], NOW);
  const high = buildModels([record({ intervalHr: 192, daysAgo: 1 }), record({ intervalHr: 192, daysAgo: 2 })], NOW);
  assert.ok(estimateInterval(s, low.treadmill).values.speed > 11);
  assert.ok(estimateInterval(s, high.treadmill).values.speed < 10);
});

test('buildModels: needs two workouts, ignores old, max tests and (while real exist) simulated ones', () => {
  const s = clone(DEFAULT_SETTINGS);
  s.maxHr = MAX;
  s.maxHrSource = 'known';
  const one = buildModels([record()], NOW);
  assert.equal(one.treadmill.n, 1);
  assert.equal(estimateInterval(s, one.treadmill), null);

  const old = record({ daysAgo: 70 });
  const test = { ...record({ daysAgo: 2 }), kind: 'maxTest' };
  assert.equal(buildModels([record(), old, test], NOW).treadmill.n, 1);

  const sims = [record({ daysAgo: 1, source: 'sim', intervalHr: 150 }), record({ daysAgo: 2, source: 'sim', intervalHr: 150 })];
  const mixed = buildModels([...sims, record({ daysAgo: 4 }), record({ daysAgo: 5 })], NOW);
  assert.equal(mixed.treadmill.sim, false);
  assert.equal(estimateInterval(s, mixed.treadmill).values.speed, 10.5);
  assert.equal(buildModels(sims, NOW).treadmill.sim, true);
});

test('buildModels: the most recent five workouts, by median', () => {
  const recs = [1, 2, 3, 4, 5, 6, 7].map((d) => record({ daysAgo: d, intervalHr: d <= 5 ? 180 : 140, id: 'r' + d }));
  const m = buildModels(recs, NOW).treadmill;
  assert.equal(m.n, 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Math.abs(m.capacity - capacityFrom(vo2Treadmill(10.5, 2), 90, MAX, 60)) < 1e-9);
});

test('plannedSettings: only the automatic plan with an estimate changes the interval target', () => {
  const s = clone(DEFAULT_SETTINGS);
  s.maxHr = MAX;
  s.maxHrSource = 'known';
  s.treadmill.interval = { speed: 9, incline: 2 };
  const models = buildModels([record({ daysAgo: 1 }), record({ daysAgo: 2 })], NOW);
  const auto = plannedSettings(s, models);
  assert.equal(auto.settings.treadmill.interval.speed, 10.5);
  assert.equal(s.treadmill.interval.speed, 9, 'saved plan untouched');
  s.intervalPlan = 'manual';
  const manual = plannedSettings(s, models);
  assert.equal(manual.estimate, null);
  assert.equal(manual.settings, s);
  s.intervalPlan = 'auto';
  s.activity = 'run';
  assert.equal(plannedSettings(s, models).estimate, null);
});

// ---------- warm-up check ----------

function warmCase({ warmHr, model = null, settled = true, steady = true }) {
  const s = clone(DEFAULT_SETTINGS);
  s.maxHr = MAX;
  s.maxHrSource = 'known';
  const samples = [];
  for (let i = 0; i < 540; i++) samples[i] = steady ? warmHr : warmHr - 54 + i / 10;
  const log = [{ t: 0, speed: 7.5, incline: 1, src: 'plan' }];
  if (!settled) log.push({ t: 500, speed: 8, incline: 1, src: 'user' });
  return warmupCheck({ settings: s, samples, log, nowSec: 540, warmStartSec: 0, intervalTarget: { speed: 10.5, incline: 2 }, model });
}

/** Warm-up HR the planned 10.5 km/h · 2 % implies, without history (ratio 1). */
function expectedWarmHr() {
  const cap = capacityFrom(vo2Treadmill(10.5, 2), 90, MAX, 60);
  return 60 + ((vo2Treadmill(7.5, 1) - 3.5) / (cap - 3.5)) * 140;
}

test('warmupCheck: waits for a steady heart rate at one setting', () => {
  assert.equal(warmCase({ warmHr: 140, settled: false }).action, 'wait');
  assert.equal(warmCase({ warmHr: 140, steady: false }).action, 'wait');
});

test('warmupCheck: an ordinary warm-up keeps the plan', () => {
  const r = warmCase({ warmHr: Math.round(expectedWarmHr()) });
  assert.equal(r.action, 'keep');
  assert.ok(Math.abs(r.delta) <= 1);
});

test('warmupCheck: a high warm-up suggests easier, a low one harder, at most two steps', () => {
  const e = expectedWarmHr();
  const hi = warmCase({ warmHr: Math.round(e + 9) });
  assert.equal(hi.action, 'easier');
  assert.equal(hi.key, 'speed');
  assert.equal(hi.from, 10.5);
  assert.ok(hi.to === 10 || hi.to === 9.5);
  const lo = warmCase({ warmHr: Math.round(e - 9) });
  assert.equal(lo.action, 'harder');
  assert.ok(lo.to === 11 || lo.to === 11.5);
  const wild = warmCase({ warmHr: Math.round(e + 30) });
  assert.equal(wild.to, 9.5);
});

test('warmupCheck: without history it needs a bigger difference than with it', () => {
  const e = expectedWarmHr();
  assert.equal(warmCase({ warmHr: Math.round(e + 5) }).action, 'keep');
  const model = { n: 3, capacity: 50, ratio: 1, nRatio: 3 };
  assert.equal(warmCase({ warmHr: Math.round(e + 5), model }).action, 'easier');
});

test('warmupCheck: the history ratio calibrates what a normal warm-up looks like', () => {
  // This athlete's warm-up usually reads 10 % "fitter" than their intervals.
  const e = expectedWarmHr();
  const model = { n: 3, capacity: 50, ratio: 1 / 1.1, nRatio: 3 };
  const normal = warmCase({ warmHr: Math.round(e), model });
  // Its warm-up HR should be lower than an uncalibrated guess, so that guess now reads as high.
  assert.equal(normal.action, 'easier', 'without the ratio this would look like a normal day');
  const r = warmCase({ warmHr: Math.round(60 + (e - 60) / 1.1), model });
  assert.equal(r.action, 'keep');
});

// ---------- in a session ----------

function simSession(bias) {
  const s = clone(DEFAULT_SETTINGS);
  s.maxHr = MAX;
  s.maxHrSource = 'known';
  s.coachingEnabled = false;
  Object.assign(s.structure, { warmupSec: 480, intervals: 2 });
  const rand = (() => {
    let x = 7;
    return () => ((x = (x * 16807) % 2147483647) / 2147483647);
  })();
  const sim = new HrSimulator({ maxHr: MAX, reference: s.treadmill.interval, intervalTargetPct: 90, bias, rand });
  const clock = { t: 1700000000000 };
  const session = new WorkoutSession({ settings: s, plan: buildPlan(s), sim, now: () => clock.t });
  session.start();
  session.dispose();
  const step = (sec) => {
    for (let i = 0; i < sec * 5; i++) {
      clock.t += 200;
      session.tick();
    }
  };
  return { session, step };
}

test('session: a less fit simulated runner gets an easier interval offer near the end of the warm-up', () => {
  const { session, step } = simSession(0.2);
  step(400);
  assert.equal(session.snapshot().planSuggestion, null);
  step(30);
  const p = session.snapshot().planSuggestion;
  assert.ok(p, 'offered');
  assert.equal(p.action, 'easier');
  assert.ok(session.acceptPlanSuggestion(p.id));
  assert.equal(session.targets.interval.speed, p.to);
  step(60);
  assert.equal(session.snapshot().phase.type, 'interval');
  assert.equal(session.actual.speed, p.to);
  session.end();
  const rec = session.toRecord();
  assert.equal(rec.warmupCheck.outcome, 'accepted');
  assert.equal(rec.warmupCheck.to, p.to);
});

test('session: a matched runner is left alone; an unanswered offer expires with the warm-up', () => {
  const ok = simSession(0);
  ok.step(500);
  assert.equal(ok.session.snapshot().planSuggestion, null);
  ok.session.end();
  assert.equal(ok.session.toRecord().warmupCheck.action, 'keep');

  const { session, step } = simSession(-0.2);
  step(440);
  const p = session.snapshot().planSuggestion;
  assert.equal(p.action, 'harder');
  step(60);
  assert.equal(session.snapshot().planSuggestion, null);
  assert.equal(session.actual.speed, 10.5);
  session.end();
  assert.equal(session.toRecord().warmupCheck.outcome, 'expired');
});

// ---------- VO2max ----------

test('vo2maxOf: the interval capacity, in ml/kg/min', async () => {
  const { vo2maxOf } = await import('../js/estimate.js');
  const v = vo2maxOf(record());
  const expected = capacityFrom(vo2Treadmill(10.5, 2), 90, MAX, 60);
  assert.ok(Math.abs(v - expected) <= 0.05, `${v} vs ${expected}`);
  assert.equal(vo2maxOf({ ...record(), kind: 'maxTest' }), null);
});

test('vo2maxOf: bike and rower need body mass; a lighter rider at the same watts is fitter', async () => {
  const { vo2maxOf } = await import('../js/estimate.js');
  const bike = makeRecord({
    settings: { activity: 'bike' },
    hr: (p) => (p.type === 'interval' ? 180 : 130),
  });
  bike.treadmillLog = bike.plan.phases.map((p) => ({ t: p.startSec, level: p.type === 'interval' ? 14 : 6, cadence: 90, src: 'plan' }));
  assert.equal(vo2maxOf(bike), null);
  const heavy = vo2maxOf(bike, 90);
  const light = vo2maxOf(bike, 60);
  assert.ok(heavy > 0 && light > heavy);
  bike.settings.weightKg = 60;
  assert.equal(vo2maxOf(bike, 90), light, 'the weight stored with the workout wins');
});

test('currentVo2max: median of recent workouts, needs two, nothing outdoors', async () => {
  const { currentVo2max } = await import('../js/estimate.js');
  assert.equal(currentVo2max([record()], 'treadmill', { now: NOW }).reason, 'notYet');
  const r = currentVo2max([record({ daysAgo: 1 }), record({ daysAgo: 2, intervalHr: 176 }), record({ daysAgo: 3, intervalHr: 184 })], 'treadmill', { now: NOW });
  assert.equal(r.n, 3);
  assert.ok(Math.abs(r.value - capacityFrom(vo2Treadmill(10.5, 2), 90, MAX, 60)) <= 0.05);
  assert.equal(currentVo2max([], 'run').reason, 'outdoor');
  assert.equal(currentVo2max([], 'rower').reason, 'weight');
});

test('vo2Rating: Cooper Institute bands by age and sex', async () => {
  const { vo2Rating } = await import('../js/estimate.js');
  assert.equal(vo2Rating(47, 35, 'male').level, 'good');
  assert.equal(vo2Rating(48.3, 35, 'male').level, 'excellent', 'a threshold belongs to the higher level');
  assert.equal(vo2Rating(40, 35, 'male').level, 'poor');
  assert.equal(vo2Rating(50, 25, 'female').level, 'superior');
  assert.equal(vo2Rating(30, 75, 'female').level, 'good');
  assert.equal(vo2Rating(40, 15, 'male').band, '20–29');
  assert.equal(vo2Rating(40, 90, 'male').band, '70–79');
  assert.equal(vo2Rating(40, 35, null), null);
  assert.equal(vo2Rating(40, null, 'male'), null);
  const p = vo2Rating(44, 35, 'male').position;
  assert.ok(p >= 0.4 && p < 0.6, 'good is the middle segment');
  assert.equal(vo2Rating(80, 35, 'male').position, 1);
  assert.equal(vo2Rating(10, 35, 'male').position, 0);
});

test('vo2maxOf: the profile resting HR fills in for a workout saved without one', async () => {
  const { vo2maxOf } = await import('../js/estimate.js');
  const rec = record();
  const base = vo2maxOf(rec);
  assert.notEqual(vo2maxOf(rec, null, 45), base);
  rec.settings.restHr = 60;
  assert.equal(vo2maxOf(rec, null, 45), base, 'the resting HR stored with the workout wins');
});
