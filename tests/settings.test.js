import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, clone, hasMaxHr, updateHeartRateSettings, mergeDeep, loadSettings, saveSettings } from '../js/settings.js';
import { makeBackup, parseBackup } from '../js/backup.js';

test('profile: default HRmax is not personal, even with an age entered', () => {
  const s = clone(DEFAULT_SETTINGS);
  assert.equal(hasMaxHr(s), false);
  updateHeartRateSettings(s, 'age', 40);
  assert.equal(hasMaxHr(s), false);
  assert.equal(s.maxHr, 190);
});

test('profile: age estimation requires an age and follows later age edits', () => {
  const s = clone(DEFAULT_SETTINGS);
  updateHeartRateSettings(s, 'maxHrSource', 'age');
  assert.equal(hasMaxHr(s), false);
  updateHeartRateSettings(s, 'age', 40);
  assert.equal(s.maxHr, 180);
  assert.equal(hasMaxHr(s), true);
  updateHeartRateSettings(s, 'age', 30);
  assert.equal(s.maxHr, 187);
  updateHeartRateSettings(s, 'age', null);
  assert.equal(hasMaxHr(s), false);
});

test('profile: known maximum survives age edits; switching back uses the current age', () => {
  const s = clone(DEFAULT_SETTINGS);
  updateHeartRateSettings(s, 'maxHr', 195);
  updateHeartRateSettings(s, 'age', 50);
  assert.equal(s.maxHrSource, 'known');
  assert.equal(s.maxHr, 195);
  assert.equal(hasMaxHr(s), true);
  updateHeartRateSettings(s, 'maxHrSource', 'age');
  assert.equal(s.maxHr, 173);
});

test('profile: invalid values cannot enable personalized suggestions', () => {
  for (const value of [null, NaN, Infinity, 0, 119, 231, '190']) {
    assert.equal(hasMaxHr({ maxHrSource: 'known', maxHr: value }), false);
  }
  for (const age of [null, 0, NaN, 100, '40']) {
    assert.equal(hasMaxHr({ maxHrSource: 'age', maxHr: 180, age }), false);
  }
});

test('profile: old settings retain their maximum and receive the coaching default', () => {
  const s = mergeDeep(DEFAULT_SETTINGS, { maxHr: 195, maxHrSource: 'known' });
  assert.equal(s.maxHr, 195);
  assert.equal(hasMaxHr(s), true);
  assert.equal(s.coachingEnabled, true);
});

test('profile: age estimate, preference and coaching choice survive storage and backup', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value),
  } });
  try {
    const s = clone(DEFAULT_SETTINGS);
    updateHeartRateSettings(s, 'maxHrSource', 'age');
    updateHeartRateSettings(s, 'age', 40);
    s.coachingEnabled = false;
    s.adjustPref = 'incline';
    assert.equal(saveSettings(s), true);
    const restored = loadSettings();
    assert.equal(restored.maxHrSource, 'age');
    assert.equal(restored.maxHr, 180);
    assert.equal(restored.coachingEnabled, false);
    assert.equal(restored.adjustPref, 'incline');
    const parsed = parseBackup(JSON.stringify(makeBackup({ settings: restored, workouts: [] })));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.settings, restored);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
