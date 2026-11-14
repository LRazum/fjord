import test from 'node:test';
import assert from 'node:assert/strict';
import { HrSimulator, vo2Treadmill, profileBias, SIM_PROFILES } from '../js/simulator.js';

// Small deterministic PRNG so the tests do not depend on Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REF = { speed: 10.5, incline: 2 };
const WARM = { speed: 7.5, incline: 1, moving: true };
const HARD = { ...REF, moving: true };

function run(sim, ctx, seconds) {
  const out = [];
  for (let i = 0; i < seconds; i++) out.push(sim.step(1, ctx));
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function makeSim(bias, seed = 1) {
  return new HrSimulator({ maxHr: 190, reference: REF, intervalTargetPct: 90, bias, rand: mulberry32(seed) });
}

test('vo2Treadmill: rises with speed and incline, no jump across the walk/run blend', () => {
  assert.equal(vo2Treadmill(0, 5), 3.5);
  let prev = vo2Treadmill(3, 1);
  for (let v = 3.1; v <= 16; v += 0.1) {
    const cur = vo2Treadmill(v, 1);
    assert.ok(cur > prev, `not increasing at ${v.toFixed(1)} km/h`);
    assert.ok(cur - prev < 1.2, `jump at ${v.toFixed(1)} km/h`);
    prev = cur;
  }
  assert.ok(vo2Treadmill(10, 4) > vo2Treadmill(10, 1));
});

test('profileBias: named profiles are fixed, random stays in range', () => {
  assert.equal(profileBias('matched'), 0);
  assert.equal(profileBias('easy'), SIM_PROFILES.easy);
  assert.equal(profileBias('hard'), SIM_PROFILES.hard);
  const rand = mulberry32(7);
  for (let i = 0; i < 50; i++) {
    const b = profileBias('random', rand);
    assert.ok(b >= -0.11 && b <= 0.11);
  }
});

test('simulator: a matched runner settles inside the interval zone', () => {
  const sim = makeSim(0);
  run(sim, WARM, 600);
  const hr = run(sim, HARD, 240);
  const pct = (mean(hr.slice(-120)) / 190) * 100;
  assert.ok(pct > 85 && pct < 95, `last 2 min at ${pct.toFixed(1)} %`);
});

test('simulator: easy plan ends below the zone, hard plan above it', () => {
  const last2 = (bias) => {
    const sim = makeSim(bias);
    run(sim, WARM, 600);
    return (mean(run(sim, HARD, 240).slice(-120)) / 190) * 100;
  };
  assert.ok(last2(SIM_PROFILES.easy) < 85);
  assert.ok(last2(SIM_PROFILES.hard) > 95);
});

test('simulator: heart rate lags behind the effort', () => {
  const sim = makeSim(0);
  run(sim, WARM, 600);
  const hr = run(sim, HARD, 240);
  assert.ok(hr[19] < 0.85 * 190, 'already in the zone after 20 s');
  assert.ok(hr[239] > hr[19] + 15);
  // Recovery: clearly lower after one minute, but not instantly.
  const rec = run(sim, { speed: 6.5, incline: 1, moving: true }, 180);
  assert.ok(rec[9] > hr[239] - 22, 'dropped too fast');
  assert.ok(rec[59] < hr[239] - 20, 'did not recover within a minute');
});

test('simulator: reacts to logged speed and incline changes', () => {
  const settle = (ctx) => {
    const sim = makeSim(-0.11, 3);
    run(sim, WARM, 600);
    return mean(run(sim, ctx, 240).slice(-60));
  };
  const base = settle(HARD);
  assert.ok(settle({ ...HARD, speed: 11.5 }) > base + 4);
  assert.ok(settle({ ...HARD, incline: 4 }) > base + 4);
  assert.ok(settle({ ...HARD, speed: 9.5 }) < base - 4);
});

test('simulator: stays within plausible bounds', () => {
  const sim = makeSim(0.3, 9);
  const hr = run(sim, { speed: 16, incline: 10, moving: true }, 900);
  assert.ok(Math.max(...hr) <= 192);
  const rest = run(sim, { speed: 0, incline: 0, moving: false }, 1800);
  assert.ok(Math.min(...rest) >= 40);
  assert.ok(rest[rest.length - 1] < 90);
});
