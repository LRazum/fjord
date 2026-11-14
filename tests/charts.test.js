import test from 'node:test';
import assert from 'node:assert/strict';
import { liveChartGeometry } from '../js/charts.js';

const MAX = 200;

// Parse "M10 20L11 21M30 5" into sub-paths of [x, y] points.
function subPaths(d) {
  return d
    .split('M')
    .filter(Boolean)
    .map((s) => s.split('L').map((p) => p.split(' ').map(Number)));
}

test('liveChartGeometry: newest sample sits on the right edge', () => {
  const samples = Array.from({ length: 301 }, () => 160);
  const g = liveChartGeometry({
    samples,
    endSec: 300,
    phases: [{ startSec: 0, endSec: 300, zone: [85, 95] }],
    maxHr: MAX,
  });
  const pts = subPaths(g.d)[0];
  assert.equal(pts.length, 181); // 180 s window, inclusive
  assert.equal(pts[0][0], 0);
  assert.equal(pts[pts.length - 1][0], 180);
});

test('liveChartGeometry: a short workout is anchored to the right', () => {
  const samples = Array.from({ length: 31 }, (_, i) => 100 + i);
  const g = liveChartGeometry({
    samples,
    endSec: 30,
    phases: [{ startSec: 0, endSec: 30, zone: [60, 75] }],
    maxHr: MAX,
  });
  const pts = subPaths(g.d)[0];
  assert.equal(pts.length, 31);
  assert.equal(pts[0][0], 150);
  assert.equal(pts[30][0], 180);
  assert.deepEqual({ x: g.bands[0].x, w: g.bands[0].w }, { x: 150, w: 30 });
  // Rising heart rate goes up the screen (smaller y).
  assert.ok(pts[30][1] < pts[0][1]);
});

test('liveChartGeometry: everything stays inside the box', () => {
  const samples = Array.from({ length: 400 }, (_, i) => 90 + (i % 97));
  const g = liveChartGeometry({
    samples,
    endSec: 399,
    phases: [
      { startSec: 0, endSec: 300, zone: [60, 75] },
      { startSec: 300, endSec: 399, zone: [85, 95] },
    ],
    maxHr: MAX,
  });
  for (const [x, y] of subPaths(g.d).flat()) {
    assert.ok(x >= 0 && x <= 180 && y >= 0 && y <= 60, `point ${x},${y} outside`);
  }
  for (const b of g.bands) {
    assert.ok(b.x >= 0 && b.x + b.w <= 180.01 && b.y >= 0 && b.y + b.h <= 60.01);
    assert.ok(b.h > 0 && b.w > 0);
  }
});

test('liveChartGeometry: one band per phase in the window, clipped to it', () => {
  const samples = Array.from({ length: 700 }, () => 150);
  const g = liveChartGeometry({
    samples,
    endSec: 660,
    phases: [
      { startSec: 0, endSec: 600, zone: [60, 75] }, // only its last 120 s are visible
      { startSec: 600, endSec: 660, zone: [85, 95] },
    ],
    maxHr: MAX,
  });
  assert.equal(g.bands.length, 2);
  assert.deepEqual([g.bands[0].x, g.bands[0].w], [0, 120]);
  assert.deepEqual([g.bands[1].x, g.bands[1].w], [120, 60]);
  assert.ok(g.bands[1].y < g.bands[0].y); // higher zone is drawn higher
  assert.ok(g.lo <= 56 && g.hi >= 99);
});

test('liveChartGeometry: gaps in the data break the line', () => {
  const samples = [150, 151, null, null, 152, 153, 154];
  const g = liveChartGeometry({
    samples,
    endSec: 6,
    phases: [{ startSec: 0, endSec: 6, zone: [60, 75] }],
    maxHr: MAX,
  });
  const paths = subPaths(g.d);
  assert.equal(paths.length, 2);
  assert.deepEqual(
    paths.map((p) => p.length),
    [2, 3],
  );
});

test('liveChartGeometry: no data yet still gives a usable scale', () => {
  const g = liveChartGeometry({ samples: [], endSec: 0, phases: [], maxHr: MAX });
  assert.equal(g.d, '');
  assert.deepEqual(g.bands, []);
  assert.ok(g.hi > g.lo);
});

import { niceTicks, workoutChartGeometry, trendChartGeometry } from '../js/charts.js';
import { workoutStats } from '../js/stats.js';
import { makeRecord } from './helpers.js';

test('niceTicks: round steps that cover the range', () => {
  assert.deepEqual(niceTicks(113, 187, 4), { ticks: [100, 120, 140, 160, 180, 200], step: 20, min: 100, max: 200 });
  assert.deepEqual(niceTicks(0, 100, 4).ticks, [0, 25, 50, 75, 100]);
  const t = niceTicks(9.6, 11.2, 3);
  assert.ok(t.min <= 9.6 && t.max >= 11.2);
  assert.ok(t.ticks.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9));
  const flat = niceTicks(5, 5);
  assert.ok(flat.max > flat.min);
});

test('workoutChartGeometry: bands and markers per phase, line inside the plot', () => {
  const rec = makeRecord({ hr: (p, k) => (p.type === 'interval' ? 150 + k / 4 : 120) });
  const g = workoutChartGeometry(rec, workoutStats(rec).phases);
  assert.equal(g.bands.length, 5);
  assert.equal(g.markers.length, 4);
  assert.equal(g.bands[0].x, g.plot.left);
  const right = g.plot.left + g.plot.width;
  assert.ok(Math.abs(g.bands[4].x + g.bands[4].w - right) < 0.2);
  for (const [x, y] of subPaths(g.d).flat()) {
    assert.ok(x >= g.plot.left - 0.1 && x <= right + 0.1);
    assert.ok(y >= g.plot.top - 0.1 && y <= g.plot.top + g.plot.height + 0.1);
  }
  assert.equal(g.xTicks[0].label, '0');
  assert.equal(g.secAt(g.plot.left), 0);
  assert.equal(g.secAt(right), rec.durationSec);
  assert.equal(g.secAt(g.xOf(300)), 300);
});

test('trendChartGeometry: spacing by real weeks, gaps break the line', () => {
  const g = trendChartGeometry([
    { week: '2026-10-05', v: 10 },
    { week: '2026-10-12', v: 10.5 },
    { week: '2026-10-19', v: null },
    { week: '2026-11-02', v: 11 },
  ]);
  assert.equal(g.dots.length, 3);
  assert.equal(subPaths(g.d).length, 2);
  const [a, b, c] = g.dots.map((d) => d.x);
  assert.ok(Math.abs(c - b - 3 * (b - a)) < 0.3); // 3 weeks vs 1 week
  assert.ok(g.dots[2].y < g.dots[0].y); // higher value drawn higher
  assert.equal(trendChartGeometry([{ week: '2026-10-05', v: null }]).empty, true);
  const one = trendChartGeometry([{ week: '2026-10-05', v: 9 }]);
  assert.equal(one.dots.length, 1);
});
