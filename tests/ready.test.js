import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadySession } from '../js/ready.js';
import { WorkoutSession } from '../js/session.js';
import { buildPlan } from '../js/workout.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';

function make(sim = null) {
  const clock = { t: 1_700_000_000_000 };
  const ready = new ReadySession({ sim, now: () => clock.t });
  const step = (ms) => {
    clock.t += ms;
    ready.tick();
  };
  return { ready, clock, step };
}

test('ready: waiting never starts the countdown or workout', () => {
  const { ready, step } = make();
  step(60000);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.snapshot().remainingSec, null);
});

test('ready: shows 5-4-3-2-1 for five real seconds, then finishes once', () => {
  const { ready, step } = make();
  let finishes = 0;
  ready.on('finish', () => finishes++);
  ready.startCountdown();
  assert.equal(ready.snapshot().remainingSec, 5);
  step(999);
  assert.equal(ready.snapshot().remainingSec, 5);
  step(1);
  for (const n of [4, 3, 2, 1]) {
    assert.equal(ready.snapshot().remainingSec, n);
    assert.equal(finishes, 0);
    step(1000);
  }
  assert.equal(ready.state, 'finished');
  assert.equal(finishes, 1);
  step(10000);
  ready.startCountdown();
  assert.equal(finishes, 1);
});

test('ready: repeated Start does not restart or shorten the countdown', () => {
  const { ready, step } = make();
  ready.startCountdown();
  step(3000);
  ready.startCountdown();
  assert.equal(ready.snapshot().remainingSec, 2);
  step(1999);
  assert.equal(ready.state, 'counting');
  step(1);
  assert.equal(ready.state, 'finished');
});

test('ready: delayed ticks respect elapsed time without duplicate completion', () => {
  const { ready, step } = make();
  let finishes = 0;
  ready.on('finish', () => finishes++);
  ready.startCountdown();
  step(8000);
  step(8000);
  assert.equal(finishes, 1);
  assert.equal(ready.remainingMs, 0);
});

test('ready: Cancel works before Start and during countdown', () => {
  for (const counting of [false, true]) {
    const { ready, step } = make();
    let finishes = 0;
    ready.on('finish', () => finishes++);
    if (counting) {
      ready.startCountdown();
      step(2000);
    }
    ready.cancel();
    ready.startCountdown();
    step(10000);
    assert.equal(ready.state, 'cancelled');
    assert.equal(finishes, 0);
  }
});

test('ready: background reset requires a fresh five-second countdown', () => {
  const { ready, step } = make();
  ready.startCountdown();
  step(3000);
  ready.resetCountdown();
  step(60000);
  assert.equal(ready.state, 'ready');
  ready.startCountdown();
  step(4999);
  assert.equal(ready.snapshot().remainingSec, 1);
  step(1);
  assert.equal(ready.state, 'finished');
});

test('ready: HR becomes missing only after five seconds, then recovers', () => {
  const { ready, step } = make();
  assert.equal(ready.snapshot().bpm, null);
  ready.pushHr(123, [900]);
  step(5000);
  assert.equal(ready.snapshot().bpm, 123);
  step(1);
  assert.equal(ready.snapshot().bpm, null);
  ready.pushHr(125);
  assert.equal(ready.snapshot().bpm, 125);
  assert.deepEqual(ready.lastRr, []);
});

test('ready: seeding a home-screen reading preserves its original age', () => {
  const { ready, clock, step } = make();
  ready.pushHr(120, [], clock.t - 4000);
  step(1001);
  assert.equal(ready.snapshot().bpm, null);
  for (const invalid of [0, -1, null, NaN, Infinity, '120']) ready.pushHr(invalid);
  assert.equal(ready.snapshot().bpm, null);
});

test('ready: missing HR does not block Start', () => {
  const { ready, step } = make();
  ready.startCountdown();
  step(5000);
  assert.equal(ready.state, 'finished');
  assert.equal(ready.snapshot().bpm, null);
});

test('ready: simulator previews a standing runner without workout time scaling', () => {
  const steps = [];
  const sim = { step: (dt, ctx) => { steps.push({ dt, ctx }); return 72 + steps.length; } };
  const { ready, step } = make(sim);
  assert.equal(ready.snapshot().bpm, 73);
  step(1000);
  assert.equal(ready.snapshot().bpm, 74);
  assert.equal(ready.snapshot().source, 'sim');
  assert.deepEqual(steps.map((s) => s.dt), [0, 1]);
  assert.ok(steps.every((s) => s.ctx.moving === false && s.ctx.speed === 0));
  ready.startCountdown();
  step(4999);
  assert.equal(ready.state, 'counting');
  step(1);
  assert.equal(ready.state, 'finished');
});

test('ready: preview and countdown add no time or samples to the workout', () => {
  const { ready, clock, step } = make();
  const settings = clone(DEFAULT_SETTINGS);
  let session = null;
  ready.on('finish', () => {
    session = new WorkoutSession({ settings, plan: buildPlan(settings), timeScale: 10, now: () => clock.t });
    session.pushHr(ready.snapshot().bpm);
    session.start();
    session.dispose();
  });
  step(60000);
  assert.equal(session, null);
  ready.startCountdown();
  step(4999);
  assert.equal(session, null);
  ready.pushHr(120);
  step(1);
  assert.equal(session.startedAt, new Date(clock.t).toISOString());
  assert.equal(session.engine.elapsedMs, 0);
  assert.deepEqual(session.samples, [120]);
  assert.equal(session.engine.phase.type, 'warmup');
});
