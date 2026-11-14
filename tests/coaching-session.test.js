import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkoutSession } from '../js/session.js';
import { buildPlan } from '../js/workout.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';

function make() {
  const settings = clone(DEFAULT_SETTINGS);
  settings.maxHr = 200;
  settings.maxHrSource = 'known';
  Object.assign(settings.structure, { warmupSec: 0, recoverySec: 120 });
  settings.treadmill.interval = { speed: 10, incline: 2 };
  const clock = { t: 1700000000000 };
  const session = new WorkoutSession({ settings, plan: buildPlan(settings), now: () => clock.t });
  session.start();
  session.dispose();
  const step = (seconds, bpm = 160) => {
    for (let i = 0; i < seconds; i++) {
      clock.t += 1000;
      session.pushHr(bpm, [], true);
      session.tick();
    }
  };
  step(110);
  assert.ok(session.snapshot().suggestion);
  return { session, clock, step };
}

test('coaching session: only confirmation logs a change, once, and it carries to the next interval', () => {
  const { session, step } = make();
  const p = session.snapshot().suggestion;
  assert.equal(session.actual.speed, 10);
  assert.equal(session.treadmillLog.length, 1);
  assert.equal(session.confirmSuggestion(p.id), true);
  assert.equal(session.actual.speed, 10.5);
  assert.equal(session.treadmillLog.length, 2);
  assert.equal(session.treadmillLog[1].src, 'user');
  assert.equal(session.confirmSuggestion(p.id), false);
  step(250);
  assert.equal(session.snapshot().phase.type, 'interval');
  assert.equal(session.actual.speed, 10.5);
  assert.equal(session.treadmillLog[session.treadmillLog.length - 1].src, 'carry');
});

test('coaching session: Skip leaves the treadmill and log untouched, with a response delay', () => {
  const { session, step } = make();
  const log = JSON.stringify(session.treadmillLog);
  session.dismissSuggestion(session.snapshot().suggestion.id);
  assert.equal(session.snapshot().suggestion, null);
  step(59);
  assert.equal(session.snapshot().suggestion, null);
  assert.equal(JSON.stringify(session.treadmillLog), log);
  step(1);
  assert.ok(session.snapshot().suggestion);
});

test('coaching session: a manual adjustment invalidates the old confirmation', () => {
  const { session, step } = make();
  const p = session.snapshot().suggestion;
  session.adjust('incline', 0.5);
  assert.equal(session.confirmSuggestion(p.id), false);
  step(59);
  assert.equal(session.snapshot().suggestion, null);
});

test('coaching session: a reading that went stale before the tap cannot be accepted', () => {
  const { session, clock } = make();
  const p = session.snapshot().suggestion;
  clock.t += 5001;
  assert.equal(session.confirmSuggestion(p.id), false);
  assert.equal(session.actual.speed, 10);
});

test('coaching session: no skin contact and disconnection invalidate pending changes immediately', () => {
  for (const lost of ['contact', 'connection']) {
    const { session } = make();
    const p = session.snapshot().suggestion;
    if (lost === 'contact') session.pushHr(160, [], false);
    else session.setStrapStatus(false);
    assert.equal(session.snapshot().suggestion, null);
    assert.equal(session.confirmSuggestion(p.id), false);
    assert.equal(session.actual.speed, 10);
  }
});

test('coaching session: pause and phase changes remove the suggestion', () => {
  for (const action of ['pause', 'skip']) {
    const { session } = make();
    const p = session.snapshot().suggestion;
    session[action]();
    assert.equal(session.snapshot().suggestion, null);
    assert.equal(session.confirmSuggestion(p.id), false);
  }
});

test('coaching session: crash recovery never restores a pending suggestion', () => {
  const { session, clock } = make();
  const snap = JSON.parse(JSON.stringify(session.toSnapshot()));
  const restored = new WorkoutSession({ settings: snap.settings, plan: snap.plan, restore: snap, now: () => clock.t });
  assert.equal(restored.state, 'paused');
  assert.equal(restored.snapshot().suggestion, null);
  assert.equal(restored.confirmSuggestion(session.snapshot().suggestion.id), false);
});
