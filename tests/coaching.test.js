import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkoutCoach } from '../js/coaching.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';

function make(over = {}) {
  const settings = { ...clone(DEFAULT_SETTINGS), maxHr: 200, maxHrSource: 'known', ...over };
  const coach = new WorkoutCoach();
  const s = { state: 'running', phaseIndex: 1, phase: { type: 'interval', zone: [85, 95] },
    phaseElapsedSec: 100, phaseRemainingSec: 140, elapsedSec: 700, bpm: 160, smooth: 160, trend: 0,
    actual: { speed: 10, incline: 2 } };
  const advance = (sec) => {
    s.phaseElapsedSec += sec;
    s.phaseRemainingSec -= sec;
    s.elapsedSec += sec;
    return coach.update(s, settings);
  };
  return { coach, settings, s, advance };
}

test('coach: persistent low HR suggests one small step without changing the treadmill', () => {
  const { coach, settings, s, advance } = make();
  const original = { ...s.actual };
  assert.equal(coach.update(s, settings), null);
  assert.equal(advance(19), null);
  const p = advance(1);
  assert.deepEqual({ kind: p.kind, from: p.from, to: p.to, reason: p.reason }, { kind: 'speed', from: 10, to: 10.5, reason: 'below' });
  assert.deepEqual(s.actual, original);
  assert.equal(advance(1).id, p.id);
});

test('coach: high HR suggests reducing the preferred incline; configured steps stay small', () => {
  const { coach, settings, s, advance } = make({ adjustPref: 'incline', inclineStep: 2 });
  s.bpm = s.smooth = 196;
  coach.update(s, settings);
  assert.equal(advance(20).to, 1.5);
});

test('coach: low HR in the first 90 seconds of an interval never suggests harder', () => {
  const { coach, settings, s, advance } = make();
  s.phaseElapsedSec = 0;
  s.phaseRemainingSec = 240;
  coach.update(s, settings);
  assert.equal(advance(89), null);
  assert.equal(advance(1), null);
  assert.ok(advance(20));
});

test('coach: wait when the current trend is already heading into the zone', () => {
  for (const [bpm, trend] of [[166, 8], [194, -8]]) {
    const { coach, settings, s, advance } = make();
    s.bpm = s.smooth = bpm;
    s.trend = trend;
    coach.update(s, settings);
    assert.equal(advance(25), null);
  }
});

test('coach: entering the zone clears a suggestion and restarts persistence', () => {
  const { coach, settings, s, advance } = make();
  coach.update(s, settings);
  assert.ok(advance(20));
  s.smooth = s.bpm = 180;
  assert.equal(advance(1), null);
  s.smooth = s.bpm = 160;
  assert.equal(advance(1), null);
  assert.equal(advance(19), null);
  assert.ok(advance(1));
});

test('coach: stale HR, bad signal, pause, unknown max and disabled coaching clear suggestions', () => {
  for (const condition of ['missing', 'contact', 'paused', 'max', 'off', 'trend']) {
    const { coach, settings, s, advance } = make();
    coach.update(s, settings);
    assert.ok(advance(20));
    if (condition === 'missing') s.bpm = null;
    if (condition === 'paused') s.state = 'paused';
    if (condition === 'max') settings.maxHrSource = 'default';
    if (condition === 'off') settings.coachingEnabled = false;
    if (condition === 'trend') s.trend = null;
    assert.equal(coach.update(s, settings, condition !== 'contact'), null);
    assert.equal(coach.suggestion, null);
  }
});

test('coach: acceptance, dismissal and manual edits leave at least 60 seconds to respond', () => {
  const { coach, settings, s, advance } = make();
  s.phaseRemainingSec = 600;
  coach.update(s, settings);
  const first = advance(20);
  coach.defer(s.elapsedSec);
  assert.equal(advance(1), null);
  assert.equal(advance(58), null);
  assert.ok(advance(1).id > first.id);
});

test('coach: phase changes invalidate pending suggestions', () => {
  const { coach, settings, s, advance } = make();
  coach.update(s, settings);
  const old = advance(20);
  s.phaseIndex = 2;
  assert.equal(advance(1), null);
  assert.ok(advance(20).id > old.id);
});

test('coach: no harder suggestions during recovery or cool-down, or at phase end', () => {
  for (const type of ['recovery', 'cooldown']) {
    const { coach, settings, s, advance } = make();
    s.phase.type = type;
    coach.update(s, settings);
    assert.equal(advance(20), null);
  }
  const { coach, settings, s, advance } = make();
  s.phaseRemainingSec = 40;
  coach.update(s, settings);
  assert.equal(advance(20), null);
});

test('coach: limits suppress impossible suggestions; both alternates one control at a time', () => {
  const { coach, settings, s, advance } = make({ adjustPref: 'both' });
  coach.update(s, settings);
  const first = advance(20);
  assert.equal(first.kind, 'speed');
  coach.defer(s.elapsedSec, 0, first.kind);
  advance(1);
  assert.equal(advance(20).kind, 'incline');
  settings.adjustPref = 'speed';
  s.actual.speed = 25;
  assert.equal(coach.update(s, settings), null);
  settings.adjustPref = 'incline';
  s.actual.incline = 0;
  s.bpm = s.smooth = 196;
  assert.equal(coach.update(s, settings), null);
});
