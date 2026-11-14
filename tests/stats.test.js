import test from 'node:test';
import assert from 'node:assert/strict';
import { workoutStats, recommendNext, progress, weekKey, flatEquivalentSpeed, settingsPerSecond } from '../js/stats.js';
import { makeRecord } from './helpers.js';

// maxHr 200: interval zone 85–95 % = 170–190 bpm, recovery zone 60–70 % = 120–140 bpm.
// Layout: warmup 0–60, interval1 60–300, recovery1 300–420, interval2 420–660, cooldown 660–720.

const ramp = (p, k) => {
  if (p.type === 'warmup') return 120;
  if (p.type === 'interval') return Math.min(180, 130 + k); // reaches 170 (zone) at k = 40
  if (p.type === 'recovery') return Math.max(120, 180 - k); // drops 1 bpm/s
  return 110;
};

test('flatEquivalentSpeed', () => {
  assert.equal(flatEquivalentSpeed(10, 0), 10);
  assert.ok(Math.abs(flatEquivalentSpeed(10, 2) - 10.9) < 1e-9);
  assert.equal(flatEquivalentSpeed(10, -2), 10);
});

test('settingsPerSecond follows the log', () => {
  const s = settingsPerSecond(
    [
      { t: 3, speed: 9, incline: 1 },
      { t: 0, speed: 8, incline: 0 },
    ],
    5,
  );
  assert.deepEqual(s.speed, [8, 8, 8, 9, 9]);
  assert.deepEqual(s.incline, [0, 0, 0, 1, 1]);
});

test('workoutStats: per-phase HR', () => {
  const st = workoutStats(makeRecord({ hr: ramp }));
  assert.equal(st.phases.length, 5);
  const [w, i1, r1, i2, c] = st.phases;
  assert.deepEqual([w.avgHr, w.maxHr, w.minHr], [120, 120, 120]);
  assert.equal(i1.minHr, 130);
  assert.equal(i1.maxHr, 180);
  assert.equal(r1.maxHr, 180);
  assert.equal(r1.minHr, 120);
  assert.equal(c.avgHr, 110);
  assert.equal(i2.durationSec, 240);
});

test('workoutStats: time to zone and time in zone per interval', () => {
  const st = workoutStats(makeRecord({ hr: ramp }));
  const i1 = st.intervals[0];
  // Smoothed (5 s mean) HR reaches 170 two seconds after the raw value does.
  assert.equal(i1.timeToZoneSec, 42);
  assert.equal(i1.timeInZoneSec, 240 - 42);
  assert.equal(i1.timeInZonePct, Math.round((198 / 240) * 100));
  assert.equal(st.overall.timeInZoneSec, 2 * 198);
  assert.equal(st.overall.timeInZonePct, Math.round((396 / 480) * 100));
});

test('workoutStats: last 2 min, speed, incline, efficiency', () => {
  const st = workoutStats(makeRecord({ hr: ramp }));
  const i1 = st.intervals[0];
  assert.equal(i1.last2Pct, 90); // 180 / 200
  assert.equal(i1.avgSpeed, 10.5);
  assert.equal(i1.avgIncline, 2);
  assert.ok(i1.counts);
  // flat-equivalent 10.5 × 1.09 = 11.445, scaled from 90 % to 90 % → 11.4 (rounded)
  assert.equal(st.overall.efficiency, 11.4);
  assert.equal(st.overall.avgIntervalPct, 90);
  assert.equal(st.overall.intervalsDone, 2);
  assert.equal(st.overall.intervalsPlanned, 2);
});

test('workoutStats: HR recovery after 1 min', () => {
  const st = workoutStats(makeRecord({ hr: ramp }));
  const rec = st.phases[2];
  // smoothed at recovery start: interval end samples 180,180,180,180 + 180 (k=0) = 180;
  // at +60 s: mean of 180-56..180-60 = 122 → drop 58
  assert.equal(rec.hrr60, 58);
  // The cool-down after the last interval counts too: (180·4 + 110) / 5 = 166 → 110 a minute later.
  assert.equal(st.phases[4].hrr60, 56);
  assert.equal(st.recoveries.length, 2);
  assert.equal(st.overall.avgHrr60, 57);
});

test('workoutStats: missing samples are ignored, not counted as zero', () => {
  const st = workoutStats(makeRecord({ hr: (p, k) => (k % 2 ? null : ramp(p, k)) }));
  assert.equal(st.phases[0].avgHr, 120);
  assert.ok(st.intervals[0].timeInZonePct > 70);
});

test('workoutStats: skipped interval does not count for recommendations', () => {
  const rec = makeRecord({ hr: ramp });
  rec.phases[3].endSec = rec.phases[3].startSec + 60;
  rec.phases[3].end = 'skipped';
  rec.phases[4].startSec = rec.phases[3].endSec;
  const st = workoutStats(rec);
  assert.equal(st.intervals[1].counts, false);
  assert.equal(st.overall.intervalsDone, 1);
});

test('recommendNext: keep when in zone', () => {
  const rec = makeRecord({ hr: ramp });
  const r = recommendNext(rec);
  assert.equal(r.action, 'keep');
  assert.deepEqual(r.next, { speed: 10.5, incline: 2 });
});

test('recommendNext: below zone → faster (speed preference)', () => {
  const rec = makeRecord({ hr: (p, k) => (p.type === 'interval' ? 160 : 120) }); // 80 %
  const r = recommendNext(rec);
  assert.equal(r.action, 'harder');
  assert.equal(r.pct, 80);
  assert.deepEqual(r.next, { speed: 11.5, incline: 2 }); // 5 points under → two steps
});

test('recommendNext: slightly below zone → one step', () => {
  const rec = makeRecord({ hr: (p) => (p.type === 'interval' ? 166 : 120) }); // 83 %
  assert.deepEqual(recommendNext(rec).next, { speed: 11, incline: 2 });
});

test('recommendNext: above zone → easier, incline preference', () => {
  const rec = makeRecord({ hr: (p) => (p.type === 'interval' ? 194 : 120), settings: { adjustPref: 'incline' } }); // 97 %
  const r = recommendNext(rec);
  assert.equal(r.action, 'easier');
  assert.deepEqual(r.next, { speed: 10.5, incline: 1 });
});

test('recommendNext: both preference, starts from what was actually run, never negative', () => {
  const rec = makeRecord({ hr: (p) => (p.type === 'interval' ? 199 : 120), settings: { adjustPref: 'both' } });
  rec.finalTargets.interval = { speed: 12, incline: 0 };
  const r = recommendNext(rec);
  assert.deepEqual(r.base, { speed: 12, incline: 0 });
  assert.deepEqual(r.next, { speed: 11, incline: 0 });
});

test('recommendNext: too little data', () => {
  const rec = makeRecord({ hr: ramp, structure: { intervals: 1 } });
  assert.equal(recommendNext(rec).action, 'none');
});

test('weekKey: Monday of the week, local time', () => {
  assert.equal(weekKey(new Date(2026, 10, 14, 12)), '2026-11-09'); // Saturday
  assert.equal(weekKey(new Date(2026, 10, 9, 0, 30)), '2026-11-09'); // Monday
  assert.equal(weekKey(new Date(2026, 10, 15, 23)), '2026-11-09'); // Sunday
  assert.equal(weekKey(new Date(2027, 0, 1, 12)), '2026-12-28'); // across New Year
});

test('progress: weeks, totals and streaks', () => {
  const at = (y, m, d) => new Date(y, m - 1, d, 18).toISOString();
  const recs = [
    makeRecord({ hr: ramp, startedAt: at(2026, 10, 6) }),
    makeRecord({ hr: ramp, startedAt: at(2026, 10, 13) }),
    makeRecord({ hr: ramp, startedAt: at(2026, 10, 15) }),
    makeRecord({ hr: ramp, startedAt: at(2026, 10, 20) }),
    // gap: week of Oct 26 missing
    makeRecord({ hr: ramp, startedAt: at(2026, 11, 3) }),
    makeRecord({ hr: ramp, startedAt: at(2026, 11, 12) }),
  ];
  const pr = progress(recs, new Date(2026, 10, 14, 12));
  assert.equal(pr.total, 6);
  assert.deepEqual(
    pr.weeks.map((w) => [w.week, w.workouts]),
    [
      ['2026-10-05', 1],
      ['2026-10-12', 2],
      ['2026-10-19', 1],
      ['2026-11-02', 1],
      ['2026-11-09', 1],
    ],
  );
  assert.deepEqual(pr.streak, { current: 2, best: 3 });
  assert.equal(pr.thisWeek, 1);
  assert.equal(pr.weeks[1].avgIntervalPct, 90);
  assert.equal(pr.weeks[1].intervalMin, 16);
  assert.equal(pr.perWorkout.length, 6);
});

test('progress: streak survives the current week until it ends, then breaks', () => {
  const recs = [makeRecord({ hr: ramp, startedAt: new Date(2026, 10, 3, 18).toISOString() })];
  assert.equal(progress(recs, new Date(2026, 10, 14)).streak.current, 1); // last week → still alive
  assert.equal(progress(recs, new Date(2026, 10, 18)).streak.current, 0); // two weeks later
  assert.equal(progress([], new Date()).streak.best, 0);
});
