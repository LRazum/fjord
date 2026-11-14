import test from 'node:test';
import assert from 'node:assert/strict';
import { toTcx, trackSeries, exportBaseName } from '../js/export.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';

// A 20 s workout: 10 s "warm-up" at 7.2 km/h (2 m/s), 10 s interval at 10.8 km/h (3 m/s) on 10 %.
function record(overrides = {}) {
  return {
    id: 'w1',
    startedAt: '2026-11-14T13:32:05.123Z',
    endedAt: '2026-11-14T13:32:25.123Z',
    durationSec: 20,
    finishReason: 'completed',
    source: 'ble',
    settings: clone(DEFAULT_SETTINGS),
    plan: { intervals: 1 },
    phases: [
      { i: 0, type: 'warmup', index: null, startSec: 0, endSec: 10, plannedSec: 10, end: 'done' },
      { i: 1, type: 'interval', index: 1, startSec: 10, endSec: 20, plannedSec: 10, end: 'done' },
    ],
    samples: [null, 100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165],
    treadmillLog: [
      { t: 0, speed: 7.2, incline: 0, src: 'plan' },
      { t: 10, speed: 10.8, incline: 10, src: 'plan' },
    ],
    ...overrides,
  };
}

const count = (s, needle) => s.split(needle).length - 1;

test('trackSeries: distance and climb follow the logged treadmill settings', () => {
  const { dist, climb } = trackSeries(record());
  assert.equal(dist.length, 21);
  assert.equal(dist[0], 0);
  assert.ok(Math.abs(dist[10] - 20) < 1e-9);
  assert.ok(Math.abs(dist[20] - 50) < 1e-9);
  assert.equal(climb[10], 0);
  assert.ok(Math.abs(climb[20] - 3) < 1e-9);
});

test('trackSeries: a mid-phase change applies from that second on', () => {
  const rec = record({
    treadmillLog: [
      { t: 0, speed: 7.2, incline: 0, src: 'plan' },
      { t: 5, speed: 3.6, incline: 0, src: 'user' },
      { t: 10, speed: 10.8, incline: 10, src: 'plan' },
    ],
  });
  const { dist } = trackSeries(rec);
  assert.ok(Math.abs(dist[5] - 10) < 1e-9);
  assert.ok(Math.abs(dist[10] - 15) < 1e-9);
});

test('toTcx: one lap per phase, one trackpoint per second, no duplicates', () => {
  const tcx = toTcx(record());
  assert.ok(tcx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.equal(count(tcx, '<Lap '), 2);
  assert.equal(count(tcx, '</Lap>'), 2);
  assert.equal(count(tcx, '<Trackpoint>'), 21);
  assert.equal(count(tcx, '</Trackpoint>'), 21);
  const times = [...tcx.matchAll(/<Trackpoint><Time>([^<]+)<\/Time>/g)].map((m) => m[1]);
  assert.equal(new Set(times).size, 21);
  assert.equal(times[0], '2026-11-14T13:32:05Z');
  assert.equal(times[20], '2026-11-14T13:32:25Z');
  assert.ok(tcx.includes('<Id>2026-11-14T13:32:05Z</Id>'));
  assert.ok(tcx.includes('<Activity Sport="Running">'));
});

test('toTcx: lap totals', () => {
  const tcx = toTcx(record());
  const laps = tcx.split('<Lap ').slice(1);
  assert.ok(laps[0].startsWith('StartTime="2026-11-14T13:32:05Z"'));
  assert.ok(laps[0].includes('<TotalTimeSeconds>10</TotalTimeSeconds>'));
  assert.ok(laps[0].includes('<DistanceMeters>20.0</DistanceMeters>'));
  assert.ok(laps[0].includes('<AverageHeartRateBpm><Value>108</Value></AverageHeartRateBpm>'));
  assert.ok(laps[0].includes('<MaximumHeartRateBpm><Value>116</Value></MaximumHeartRateBpm>'));
  assert.ok(laps[1].startsWith('StartTime="2026-11-14T13:32:15Z"'));
  assert.ok(laps[1].includes('<DistanceMeters>30.0</DistanceMeters>'));
  assert.ok(laps[1].includes('<MaximumHeartRateBpm><Value>165</Value></MaximumHeartRateBpm>'));
  assert.ok(laps[1].includes('<Intensity>Active</Intensity>'));
});

test('toTcx: missing heart rate is left out, not written as zero', () => {
  const tcx = toTcx(record());
  const first = tcx.match(/<Trackpoint>.*?<\/Trackpoint>/)[0];
  assert.ok(!first.includes('HeartRateBpm'));
  assert.equal(count(tcx, '<HeartRateBpm>'), 20);
  const noHr = toTcx(record({ samples: new Array(21).fill(null) }));
  assert.equal(count(noHr, 'HeartRateBpm'), 0);
});

test('toTcx: recovery laps are marked resting, skipped zero-length phases are dropped', () => {
  const rec = record({
    phases: [
      { i: 0, type: 'warmup', index: null, startSec: 0, endSec: 0, plannedSec: 600, end: 'skipped' },
      { i: 1, type: 'interval', index: 1, startSec: 0, endSec: 10, plannedSec: 240, end: 'done' },
      { i: 2, type: 'recovery', index: 1, startSec: 10, endSec: 20, plannedSec: 180, end: 'ended' },
    ],
  });
  const tcx = toTcx(rec);
  assert.equal(count(tcx, '<Lap '), 2);
  assert.equal(count(tcx, '<Intensity>Resting</Intensity>'), 1);
  assert.equal(count(tcx, '<Trackpoint>'), 21);
});

test('toTcx: simulated workouts say so, and the note is escaped', () => {
  assert.ok(toTcx(record({ source: 'sim' })).includes('(simulated heart rate)'));
  assert.ok(!toTcx(record()).includes('simulated'));
  assert.ok(!/<Notes>[^<]*[&](?!amp;|lt;|gt;|quot;|apos;)/.test(toTcx(record())));
});

test('exportBaseName', () => {
  assert.equal(exportBaseName(record()), 'fjord-2026-11-14-1332');
});
