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
