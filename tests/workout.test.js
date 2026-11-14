import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, WorkoutEngine } from '../js/workout.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';

function settings(structure = {}) {
  const s = clone(DEFAULT_SETTINGS);
  Object.assign(s.structure, structure);
  return s;
}

function record(engine) {
  const log = { phases: [], cues: [], states: [], finish: [] };
  engine.on('phase', (e) => log.phases.push(e.phase.type + (e.phase.index || '')));
  engine.on('cue', (e) => log.cues.push(`${e.phaseIndex}:${e.kind}${e.n || ''}`));
  engine.on('state', (e) => log.states.push(e.state));
  engine.on('finish', (e) => log.finish.push(e.reason));
  return log;
}

test('buildPlan: default 4x4 structure', () => {
  const plan = buildPlan(settings());
  assert.deepEqual(
    plan.phases.map((p) => p.type + (p.index || '')),
    ['warmup', 'interval1', 'recovery1', 'interval2', 'recovery2', 'interval3', 'recovery3', 'interval4', 'cooldown'],
  );
  assert.equal(plan.intervals, 4);
  assert.equal(plan.totalSec, 600 + 4 * 240 + 3 * 180 + 300);
  assert.deepEqual(
    plan.phases.map((p) => p.startSec),
    [0, 600, 840, 1020, 1260, 1440, 1680, 1860, 2100],
  );
  assert.deepEqual(plan.phases[1].zone, [85, 95]);
  assert.deepEqual(plan.phases[1].target, { speed: 10.5, incline: 2 });
});

test('buildPlan: zero-length phases are left out', () => {
  const plan = buildPlan(settings({ warmupSec: 0, cooldownSec: 0, recoverySec: 0, intervals: 2 }));
  assert.deepEqual(
    plan.phases.map((p) => p.type),
    ['interval', 'interval'],
  );
  assert.equal(plan.totalSec, 480);
});

test('buildPlan: at least one interval', () => {
  const plan = buildPlan(settings({ intervals: 0 }));
  assert.equal(plan.intervals, 1);
});

test('engine: runs through every phase and finishes', () => {
  const plan = buildPlan(settings());
  const e = new WorkoutEngine(plan);
  const log = record(e);
  e.start();
  let guard = 0;
  while (e.state === 'running' && guard++ < 100000) e.advance(250);
  assert.equal(e.state, 'finished');
  assert.deepEqual(log.finish, ['completed']);
  assert.equal(e.elapsedMs, plan.totalSec * 1000);
  assert.equal(log.phases.length, 9);
  assert.deepEqual(log.states, ['running', 'finished']);
  // Phase log is contiguous and matches the plan.
  e.phaseLog.forEach((p, i) => {
    assert.equal(p.startSec, plan.phases[i].startSec);
    assert.equal(p.endSec, plan.phases[i].startSec + plan.phases[i].durationSec);
    assert.equal(p.end, 'done');
  });
});

test('engine: 30 s and 3-2-1 cues fire once per phase', () => {
  const plan = buildPlan(settings());
  const e = new WorkoutEngine(plan);
  const log = record(e);
  e.start();
  while (e.state === 'running') e.advance(200);
  assert.equal(log.cues.length, 9 * 4);
  assert.deepEqual(log.cues.slice(0, 4), ['0:thirty', '0:count3', '0:count2', '0:count1']);
});

test('engine: no 30 s cue in short phases', () => {
  const plan = buildPlan(settings({ warmupSec: 40, intervals: 1, cooldownSec: 0 }));
  const e = new WorkoutEngine(plan);
  const log = record(e);
  e.start();
  e.advance(40000);
  assert.deepEqual(log.cues, ['0:count3', '0:count2', '0:count1']);
});

test('engine: one large step crosses several phases without losing events', () => {
  const plan = buildPlan(settings());
  const e = new WorkoutEngine(plan);
  const log = record(e);
  e.start();
  e.advance(900 * 1000); // into recovery 1
  assert.equal(e.phase.type, 'recovery');
  assert.equal(e.phaseElapsedMs, 60000);
  assert.deepEqual(log.phases, ['warmup', 'interval1', 'recovery1']);
  assert.equal(log.cues.length, 8);
  e.advance(1e9);
  assert.equal(e.state, 'finished');
  assert.equal(e.elapsedMs, plan.totalSec * 1000);
});

test('engine: time does not advance while paused', () => {
  const e = new WorkoutEngine(buildPlan(settings()));
  e.start();
  e.advance(5000);
  e.pause();
  e.advance(60000);
  assert.equal(e.elapsedMs, 5000);
  assert.equal(e.state, 'paused');
  e.resume();
  e.advance(1000);
  assert.equal(e.elapsedMs, 6000);
});

test('engine: skip ends the phase early and logs it', () => {
  const plan = buildPlan(settings());
  const e = new WorkoutEngine(plan);
  e.start();
  e.advance(30000);
  e.skip();
  assert.equal(e.phase.type, 'interval');
  assert.equal(e.phaseElapsedMs, 0);
  assert.equal(e.phaseRemainingMs, 240000);
  assert.deepEqual(
    { end: e.phaseLog[0].end, endSec: e.phaseLog[0].endSec },
    { end: 'skipped', endSec: 30 },
  );
  // Skipping also works while paused, and stays paused.
  e.pause();
  e.skip();
  assert.equal(e.phase.type, 'recovery');
  assert.equal(e.state, 'paused');
});

test('engine: skipping the last phase finishes the workout', () => {
  const e = new WorkoutEngine(buildPlan(settings({ warmupSec: 0, cooldownSec: 0, intervals: 1 })));
  const log = record(e);
  e.start();
  e.skip();
  assert.equal(e.state, 'finished');
  assert.deepEqual(log.finish, ['completed']);
});

test('engine: end stops early', () => {
  const e = new WorkoutEngine(buildPlan(settings()));
  const log = record(e);
  e.start();
  e.advance(700000);
  e.end();
  assert.equal(e.state, 'finished');
  assert.deepEqual(log.finish, ['ended']);
  assert.equal(e.phaseLog[e.phaseLog.length - 1].end, 'ended');
  e.advance(5000);
  assert.equal(e.elapsedMs, 700000);
});

test('engine: intervalNumber follows the current or last interval', () => {
  const e = new WorkoutEngine(buildPlan(settings()));
  assert.equal(e.intervalNumber, 0);
  e.start();
  assert.equal(e.intervalNumber, 0); // warm-up
  e.skip();
  assert.equal(e.intervalNumber, 1);
  e.skip();
  assert.equal(e.intervalNumber, 1); // recovery after interval 1
  e.skip();
  assert.equal(e.intervalNumber, 2);
});

test('engine: toJSON/restore round trip resumes paused at the same point', () => {
  const plan = buildPlan(settings());
  const e = new WorkoutEngine(plan);
  e.start();
  e.advance(650000);
  const copy = WorkoutEngine.restore(plan, JSON.parse(JSON.stringify(e.toJSON())));
  assert.equal(copy.state, 'paused');
  assert.equal(copy.elapsedMs, 650000);
  assert.equal(copy.phase.type, 'interval');
  assert.equal(copy.phaseRemainingMs, 190000);
  copy.resume();
  copy.advance(190000);
  assert.equal(copy.phase.type, 'recovery');
});
