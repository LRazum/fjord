import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothedHr, hrTrend, pctOfMax, zoneStatus, zoneBpm } from '../js/hrmath.js';

test('smoothedHr: mean of the last 5 samples, ignoring gaps', () => {
  const s = [100, 110, 120, 130, 140, 150];
  assert.equal(smoothedHr(s, 5), 130);
  assert.equal(smoothedHr(s, 1), 105);
  assert.equal(smoothedHr([100, null, 120, null, 140], 4), 120);
  assert.equal(smoothedHr([null, null], 1), null);
});

test('hrTrend: slope in bpm per minute', () => {
  const up = Array.from({ length: 30 }, (_, i) => 120 + i); // +1 bpm/s
  assert.ok(Math.abs(hrTrend(up, 29) - 60) < 1e-6);
  const flat = Array.from({ length: 30 }, () => 150);
  assert.equal(hrTrend(flat, 29), 0);
  const down = Array.from({ length: 30 }, (_, i) => 170 - i * 0.5);
  assert.ok(Math.abs(hrTrend(down, 29) + 30) < 1e-6);
});

test('hrTrend: needs enough samples', () => {
  assert.equal(hrTrend([120, 121, 122], 2), null);
  const gappy = Array.from({ length: 18 }, (_, i) => (i % 3 === 0 ? 120 + i : null));
  assert.equal(hrTrend(gappy, 17), null);
});

test('pctOfMax', () => {
  assert.equal(pctOfMax(171, 190), 90);
  assert.equal(pctOfMax(null, 190), null);
});

test('zoneStatus: plain classification', () => {
  const z = [85, 95];
  assert.equal(zoneStatus(80, z), 'below');
  assert.equal(zoneStatus(85, z), 'in');
  assert.equal(zoneStatus(95, z), 'in');
  assert.equal(zoneStatus(95.1, z), 'above');
  assert.equal(zoneStatus(null, z), null);
});

test('zoneStatus: hysteresis when leaving the zone', () => {
  const z = [85, 95];
  assert.equal(zoneStatus(84.5, z, 'in'), 'in'); // inside the 1-point band
  assert.equal(zoneStatus(83.9, z, 'in'), 'below');
  assert.equal(zoneStatus(95.8, z, 'in'), 'in');
  assert.equal(zoneStatus(96.1, z, 'in'), 'above');
  // Coming back in happens at the edge itself.
  assert.equal(zoneStatus(84.5, z, 'below'), 'below');
  assert.equal(zoneStatus(85, z, 'below'), 'in');
  assert.equal(zoneStatus(95, z, 'above'), 'in');
});

test('zoneBpm: whole beats that are inside the zone', () => {
  assert.deepEqual(zoneBpm([85, 95], 190), [162, 180]); // 161.5 and 180.5
  assert.deepEqual(zoneBpm([85, 95], 200), [170, 190]); // exact edges are included
  assert.deepEqual(zoneBpm([60, 70], 187), [113, 130]);
  // Agrees with zoneStatus on both sides of every edge.
  for (const max of [171, 185, 190, 200]) {
    const z = [85, 95];
    const [lo, hi] = zoneBpm(z, max);
    assert.equal(zoneStatus(pctOfMax(lo, max), z), 'in');
    assert.equal(zoneStatus(pctOfMax(lo - 1, max), z), 'below');
    assert.equal(zoneStatus(pctOfMax(hi, max), z), 'in');
    assert.equal(zoneStatus(pctOfMax(hi + 1, max), z), 'above');
  }
});
