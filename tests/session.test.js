import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../js/workout.js';
import { WorkoutSession } from '../js/session.js';
import { HrSimulator } from '../js/simulator.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';

test('session: a restored simulator can resume without consuming time before its creation', () => {
  const { session, clock, step } = make();
  step(5000);
  const snap = session.toSnapshot();
  clock.t += 60000;
  const restored = new WorkoutSession({ settings: snap.settings, plan: snap.plan,
    sim: new HrSimulator({ maxHr: snap.settings.maxHr, reference: snap.settings.treadmill.interval }),
    restore: snap, now: () => clock.t });
  restored.resume();
  assert.equal(restored.engine.elapsedMs, 5000);
  assert.equal(restored.samples.length, 6);
  clock.t += 1000;
  restored.tick();
  assert.equal(restored.engine.elapsedMs, 6000);
});

test('session: a new reading after a timer gap cannot fill earlier workout seconds', () => {
  const { session, clock } = make({ sim: false });
  session.pushHr(100);
  clock.t += 60000;
  session.pushHr(160);
  session.tick();
  assert.deepEqual(session.samples.slice(1, 6), [100, 100, 100, 100, 100]);
  assert.ok(session.samples.slice(6, 60).every((bpm) => bpm === null));
  assert.equal(session.samples[60], 160);
});

test('session: notifications received between delayed ticks retain their timestamps', () => {
  const { session, clock } = make({ sim: false });
  for (const bpm of [120, 125, 130]) {
    clock.t += 1000;
    session.pushHr(bpm);
  }
  clock.t += 500;
  session.tick();
  assert.deepEqual(session.samples.slice(1, 4), [120, 125, 130]);
});

test('session: strap staleness uses real seconds when workout time is accelerated', () => {
  const { session, clock } = make({ sim: false, timeScale: 10 });
  session.pushHr(130);
  clock.t += 10000;
  session.tick();
  assert.ok(session.samples.slice(1, 51).every((bpm) => bpm === 130));
  assert.ok(session.samples.slice(51).every((bpm) => bpm === null));
});

test('session: paused time does not offset timestamps of later HR samples', () => {
  const { session, clock } = make({ sim: false });
  session.pushHr(100);
  clock.t += 2000;
  session.pause();
  clock.t += 60000;
  session.pushHr(160);
  session.resume();
  clock.t += 1000;
  session.tick();
  assert.deepEqual(session.samples.slice(1), [100, 100, 160]);
});

test('session: a Ready reading keeps its original age when recording starts', () => {
  const settings = clone(DEFAULT_SETTINGS);
  let clock = 1700000000000;
  const session = new WorkoutSession({ settings, plan: buildPlan(settings), now: () => clock });
  session.pushHr(120, [], true, clock - 5000);
  session.start();
  session.dispose();
  assert.equal(session.samples[0], 120);
  clock += 1000;
  session.tick();
  assert.equal(session.samples[1], null);
});

test('session: pausing settles pending time and resume excludes an unticked pause', () => {
  for (const timeScale of [1, 10]) {
    const settings = clone(DEFAULT_SETTINGS);
    let clock = 1700000000000;
    const session = new WorkoutSession({ settings, plan: buildPlan(settings), now: () => clock, timeScale });
    session.start();
    session.dispose();
    clock += 1250;
    session.pause();
    assert.equal(session.engine.elapsedMs, 1250 * timeScale);
    const samples = session.samples.length;
    clock += 30000;
    session.resume();
    assert.equal(session.engine.elapsedMs, 1250 * timeScale);
    assert.equal(session.samples.length, samples);
    clock += 1000;
    session.tick();
    assert.equal(session.engine.elapsedMs, 2250 * timeScale);
  }
});

test('session: End includes running time since the previous timer tick', () => {
  const { session, clock } = make({ sim: false });
  clock.t += 6250;
  session.end();
  assert.equal(session.engine.elapsedMs, 6250);
  assert.equal(session.toRecord().phases[0].endSec, 6.25);
  assert.equal(session.samples.length, 7);
});

test('session: Skip logs the actual tap time before entering the next phase', () => {
  const { session, clock } = make({ sim: false });
  clock.t += 1250;
  session.skip();
  assert.equal(session.engine.phaseLog[0].endSec, 1.25);
  assert.equal(session.engine.phaseLog[0].end, 'skipped');
  assert.equal(session.engine.phaseElapsedMs, 0);
  clock.t += 750;
  session.tick();
  assert.equal(session.engine.elapsedMs, 2000);
  assert.equal(session.engine.phaseElapsedMs, 750);
});

test('session: a late Skip tap does not skip a phase that just started naturally', () => {
  const settings = clone(DEFAULT_SETTINGS);
  settings.structure.warmupSec = 1;
  let clock = 1700000000000;
  const session = new WorkoutSession({ settings, plan: buildPlan(settings), now: () => clock });
  session.start();
  session.dispose();
  clock += 1250;
  session.skip();
  assert.equal(session.engine.phase.type, 'interval');
  assert.equal(session.engine.phaseElapsedMs, 250);
  assert.equal(session.engine.phaseLog[0].end, 'done');
  assert.equal(session.engine.phaseLog.length, 2);
});

test('session: pause cannot overwrite a natural finish while catching up the clock', () => {
  const settings = clone(DEFAULT_SETTINGS);
  Object.assign(settings.structure, { warmupSec: 0, intervals: 1, intervalSec: 1, cooldownSec: 0 });
  let clock = 1700000000000;
  const session = new WorkoutSession({ settings, plan: buildPlan(settings), now: () => clock });
  session.start();
  session.dispose();
  const states = [];
  session.on('state', ({ state }) => states.push(state));
  clock += 1250;
  session.pause();
  assert.equal(session.state, 'finished');
  assert.equal(session.engine.finishReason, 'completed');
  assert.deepEqual(states, ['finished']);
});

// A session driven by a fake clock; the real timer is stopped right after start().
function make({ sim = true, timeScale = 1 } = {}) {
  const settings = clone(DEFAULT_SETTINGS);
  const plan = buildPlan(settings);
  const clock = { t: 1_700_000_000_000 };
  const session = new WorkoutSession({
    settings,
    plan,
    timeScale,
    now: () => clock.t,
    sim: sim ? new HrSimulator({ maxHr: settings.maxHr, reference: settings.treadmill.interval }) : null,
  });
  session.start();
  session.dispose();
  const step = (ms, each) => {
    for (let done = 0; done < ms; done += 1000) {
      clock.t += 1000;
      if (each) each();
      session.tick();
    }
  };
  return { session, clock, step, plan };
}

test('session: records one HR sample per workout second', () => {
  const { session, step, plan } = make();
  step(plan.totalSec * 1000);
  assert.equal(session.state, 'finished');
  const rec = session.toRecord();
  assert.equal(rec.durationSec, plan.totalSec);
  assert.equal(rec.samples.length, plan.totalSec + 1);
  assert.ok(rec.samples.every((v) => Number.isInteger(v) && v >= 40 && v <= 192));
  assert.equal(rec.finishReason, 'completed');
  assert.equal(rec.phases.length, 9);
});

test('session: the record taken in the finish event already has the last sample', () => {
  const { session, step, plan } = make();
  let rec = null;
  session.on('finish', () => {
    rec = session.toRecord();
  });
  step(plan.totalSec * 1000);
  assert.equal(rec.samples.length, plan.totalSec + 1);
  assert.ok(rec.samples[plan.totalSec] > 40);
  assert.ok(rec.endedAt);
});

test('session: time scale multiplies workout time', () => {
  const { session, step } = make({ timeScale: 10 });
  step(60000);
  assert.equal(session.snapshot().elapsedSec, 600);
  assert.equal(session.snapshot().phase.type, 'interval');
  assert.equal(session.samples.length, 601);
});

test('session: nothing is recorded while paused', () => {
  const { session, step } = make();
  step(10000);
  session.pause();
  step(30000);
  assert.equal(session.samples.length, 11);
  session.resume();
  step(5000);
  assert.equal(session.samples.length, 16);
  assert.equal(session.snapshot().elapsedSec, 15);
});

test('session: a catch-up after a long gap still fills every second', () => {
  const { session, clock } = make();
  clock.t += 90000; // tab was in the background
  session.tick();
  assert.equal(session.samples.length, 91);
  assert.equal(session.snapshot().elapsedSec, 90);
});

test('session: phase start logs the planned treadmill setting', () => {
  const { session, step } = make();
  assert.deepEqual(session.treadmillLog, [{ t: 0, speed: 7.5, incline: 1, src: 'plan' }]);
  step(600000);
  assert.deepEqual(session.actual, { speed: 10.5, incline: 2 });
  assert.deepEqual(session.treadmillLog[1], { t: 600, speed: 10.5, incline: 2, src: 'plan' });
});

test('session: rapid +/- taps merge into one log entry, limits are enforced', () => {
  const { session, step } = make();
  step(5000);
  session.adjust('speed', 0.5);
  session.adjust('speed', 0.5);
  step(2000);
  session.adjust('incline', 0.5);
  assert.equal(session.treadmillLog.length, 2);
  assert.deepEqual(session.treadmillLog[1], { t: 7, speed: 8.5, incline: 1.5, src: 'user' });
  step(10000);
  session.adjust('speed', -0.5);
  assert.equal(session.treadmillLog.length, 3);
  for (let i = 0; i < 100; i++) session.adjust('speed', -0.5);
  assert.equal(session.actual.speed, 0);
  for (let i = 0; i < 100; i++) session.adjust('speed', 0.5);
  assert.equal(session.actual.speed, 25);
});

test('session: a change made in one interval carries over to the next one', () => {
  const { session, step } = make();
  step(600000); // interval 1
  step(60000);
  session.adjust('speed', 0.5);
  session.adjust('incline', 1);
  step(180000); // recovery 1
  assert.deepEqual(session.actual, { speed: 6.5, incline: 1 }); // recovery plan untouched
  step(180000); // interval 2
  const snap = session.snapshot();
  assert.equal(snap.phase.index, 2);
  assert.deepEqual(snap.target, { speed: 11, incline: 3 });
  assert.deepEqual(snap.actual, { speed: 11, incline: 3 });
  const last = session.treadmillLog[session.treadmillLog.length - 1];
  assert.deepEqual(last, { t: 1020, speed: 11, incline: 3, src: 'carry' });
  assert.deepEqual(session.toRecord().finalTargets.interval, { speed: 11, incline: 3 });
});

test('session: zone status follows the phase zone', () => {
  const { session, step } = make();
  step(600000 + 230000); // near the end of interval 1
  const snap = session.snapshot();
  assert.equal(snap.phase.type, 'interval');
  assert.ok(['in', 'above', 'below'].includes(snap.zone));
  assert.ok(snap.pct > 80);
  assert.ok(typeof snap.trend === 'number');
});

test('session: strap readings are recorded and go stale after a few seconds', () => {
  const { session, step } = make({ sim: false });
  assert.equal(session.snapshot().bpm, null);
  step(3000, () => session.pushHr(150));
  assert.equal(session.snapshot().bpm, 150);
  assert.deepEqual(session.samples.slice(1, 4), [150, 150, 150]);
  step(10000); // strap silent
  assert.equal(session.snapshot().bpm, null);
  assert.equal(session.samples[13], null);
  assert.equal(session.snapshot().zone, null);
  step(1000, () => session.pushHr(152));
  assert.equal(session.samples[14], 152);
});

test('session: ending early produces a usable record', () => {
  const { session, step } = make();
  let finished = 0;
  session.on('finish', () => finished++);
  step(700000);
  session.end();
  assert.equal(finished, 1);
  const rec = session.toRecord();
  assert.equal(rec.finishReason, 'ended');
  assert.equal(rec.durationSec, 700);
  assert.equal(rec.phases[rec.phases.length - 1].end, 'ended');
  assert.ok(rec.startedAt && rec.endedAt);
});

test('session: snapshot → restore continues exactly where it stopped, paused', () => {
  const { session, step, clock } = make();
  step(700000); // interval 1, 100 s in
  session.adjust('speed', 0.5);
  step(3000);
  const snap = JSON.parse(JSON.stringify(session.toSnapshot()));
  const settings = snap.settings;
  const sim = new HrSimulator({ maxHr: settings.maxHr, reference: settings.treadmill.interval });
  const again = new WorkoutSession({ settings, plan: snap.plan, sim, now: () => clock.t, restore: snap });
  assert.equal(again.id, session.id);
  assert.equal(again.state, 'paused');
  assert.equal(again.snapshot().elapsedSec, 703);
  assert.equal(again.snapshot().phase.type, 'interval');
  assert.deepEqual(again.actual, { speed: 11, incline: 2 });
  assert.equal(again.samples.length, 704);
  assert.ok(Math.abs(sim.hr - again.samples[703]) < 1e-9); // simulator picks up from the last value
  // Carry-over still works after the restore.
  again.attach();
  again.dispose();
  again.resume();
  for (let i = 0; i < 140 + 180; i++) {
    clock.t += 1000;
    again.tick();
  }
  const s = again.snapshot();
  assert.equal(s.phase.index, 2);
  assert.deepEqual(s.target, { speed: 11, incline: 2 });
  assert.equal(again.samples.length, 704 + 320);
});

test('session: recordFromSnapshot ends the workout at the last save', () => {
  const { session, step } = make();
  step(650000);
  const snap = JSON.parse(JSON.stringify(session.toSnapshot()));
  const rec = WorkoutSession.recordFromSnapshot(snap);
  assert.equal(rec.finishReason, 'ended');
  assert.equal(rec.durationSec, 650);
  assert.equal(rec.endedAt, snap.savedAt);
  assert.equal(rec.source, 'sim');
  assert.equal(rec.phases[rec.phases.length - 1].end, 'ended');
  assert.equal(rec.samples.length, 651);
});
