// Workout statistics, progress over weeks and next-session recommendations. DOM-free.

import { smoothedHr, zoneStatus } from './hrmath.js';
import { hasMaxHr } from './settings.js';
import { activityOf, phaseTargets, preferredControls, roundTo } from './activities.js';

const LAST_SEC = 120; // "last 2 min" of an interval
const HRR_SEC = 60; // heart-rate recovery after 1 min
const MIN_INTERVAL_SEC = 150; // shorter (skipped) intervals do not count for recommendations

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const round = (v) => (v == null ? null : Math.round(v));

/** Speed that costs the same on the flat (ACSM running: VO2 ∝ v·(1 + 4.5·grade)). */
export function flatEquivalentSpeed(speed, incline) {
  return speed * (1 + 4.5 * (Math.max(0, incline) / 100));
}

/** Machine setting in force at every second [0, n), per control key. */
export function settingsPerSecond(log, n, keys = ['speed', 'incline']) {
  const sorted = log.slice().sort((a, b) => a.t - b.t);
  const out = {};
  for (const key of keys) out[key] = new Array(n);
  let k = -1;
  for (let s = 0; s < n; s++) {
    while (k + 1 < sorted.length && sorted[k + 1].t <= s) k++;
    for (const key of keys) out[key][s] = k >= 0 && Number.isFinite(sorted[k][key]) ? sorted[k][key] : null;
  }
  return out;
}

function hrStats(values) {
  const v = values.filter((x) => x != null);
  if (!v.length) return { avgHr: null, maxHr: null, minHr: null };
  return { avgHr: round(mean(v)), maxHr: Math.max(...v), minHr: Math.min(...v) };
}

/**
 * Everything the summary, detail and progress views need from one workout record.
 * Seconds [startSec, endSec) belong to a phase.
 */
export function workoutStats(rec) {
  const maxHr = rec.settings.maxHr;
  const n = rec.durationSec;
  const samples = rec.samples;
  const activity = activityOf(rec.settings);
  const keys = activity.controls.map((c) => c.key);
  const tm = settingsPerSecond(rec.treadmillLog, n, keys);
  const isTreadmill = activity.id === 'treadmill';

  const phases = rec.phases
    .map((p) => {
      const s0 = Math.round(p.startSec);
      const s1 = Math.round(p.endSec ?? n);
      const zone = rec.plan.phases && rec.plan.phases[p.i] ? rec.plan.phases[p.i].zone : rec.settings.zones[p.type];
      return { ...p, s0, s1, zone };
    })
    .filter((p) => p.s1 > p.s0)
    .map((p) => {
      const secs = [];
      for (let s = p.s0; s < p.s1; s++) secs.push(s);
      const hr = secs.map((s) => samples[s]);
      const out = {
        type: p.type,
        index: p.index,
        startSec: p.s0,
        endSec: p.s1,
        durationSec: p.s1 - p.s0,
        plannedSec: p.plannedSec,
        end: p.end,
        zone: p.zone,
        ...hrStats(hr),
      };

      // Time in zone, on the 5 s smoothed HR with the same hysteresis as the live view.
      let status = null;
      let inZone = 0;
      let measured = 0;
      let firstIn = null;
      for (const s of secs) {
        const sm = smoothedHr(samples, s, 5);
        if (sm == null || samples[s] == null) continue;
        measured++;
        status = zoneStatus((sm / maxHr) * 100, p.zone, status);
        if (status === 'in') {
          inZone++;
          if (firstIn == null) firstIn = s - p.s0;
        }
      }
      out.timeInZoneSec = inZone;
      out.timeInZonePct = measured ? round((inZone / measured) * 100) : null;

      out.avg = {};
      for (const key of keys) out.avg[key] = r1(mean(secs.map((s) => tm[key][s]).filter((v) => v != null)));
      out.avgSpeed = isTreadmill ? out.avg.speed : null;
      out.avgIncline = isTreadmill ? out.avg.incline : null;

      if (p.type === 'interval') {
        out.timeToZoneSec = firstIn;
        const tail = secs.slice(-LAST_SEC);
        const tailHr = tail.map((s) => samples[s]).filter((v) => v != null);
        out.last2Pct = tailHr.length ? r1((mean(tailHr) / maxHr) * 100) : null;
        // Speed efficiency only means something on a treadmill.
        const tailEq = !isTreadmill ? [] : tail
          .filter((s) => tm.speed[s] != null)
          .map((s) => flatEquivalentSpeed(tm.speed[s], tm.incline[s]));
        out.last2FlatSpeed = tailEq.length ? mean(tailEq) : null;
        out.counts = out.durationSec >= MIN_INTERVAL_SEC && tailHr.length >= LAST_SEC / 2;
      }
      return out;
    });

  // HR recovery: drop in bpm one minute after each interval ends.
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p.type !== 'recovery' && p.type !== 'cooldown') continue;
    const prev = phases[i - 1];
    if (!prev || prev.type !== 'interval') continue;
    const atEnd = smoothedHr(samples, p.startSec, 5);
    const after = p.startSec + HRR_SEC < n + 1 ? smoothedHr(samples, p.startSec + HRR_SEC, 5) : null;
    p.hrr60 = atEnd != null && after != null && p.durationSec >= HRR_SEC ? round(atEnd - after) : null;
  }

  const intervals = phases.filter((p) => p.type === 'interval');
  const counted = intervals.filter((p) => p.counts);
  const allHr = hrStats(samples.slice(0, n + 1));
  const intervalSecs = intervals.reduce((a, p) => a + p.durationSec, 0);
  const intervalInZone = intervals.reduce((a, p) => a + p.timeInZoneSec, 0);

  const efficiency = efficiencyOf(counted, maxHr);
  const avgInterval = {};
  for (const key of keys) avgInterval[key] = r1(mean(intervals.map((p) => p.avg[key]).filter((v) => v != null)));

  return {
    phases,
    intervals,
    recoveries: phases.filter((p) => p.hrr60 != null),
    overall: {
      durationSec: n,
      ...allHr,
      intervalsDone: intervals.filter((p) => p.end === 'done').length,
      intervalsPlanned: rec.plan.intervals,
      intervalSec: intervalSecs,
      avgIntervalHr: round(mean(intervals.map((p) => p.avgHr).filter((v) => v != null))),
      avgIntervalPct: r1(mean(counted.map((p) => p.last2Pct).filter((v) => v != null))),
      timeInZoneSec: intervalInZone,
      timeInZonePct: intervalSecs ? round((intervalInZone / intervalSecs) * 100) : null,
      avgIntervalSpeed: isTreadmill ? avgInterval.speed : null,
      avgIntervalIncline: isTreadmill ? avgInterval.incline : null,
      avgInterval,
      activity: activity.id,
      avgHrr60: round(mean(phases.map((p) => p.hrr60).filter((v) => v != null))),
      efficiency,
      peakHr: rec.kind === 'maxTest' ? rec.peakHr ?? null : null,
    },
  };
}

/**
 * "Speed at 90 % HRmax": flat-equivalent treadmill speed in the last 2 min of each
 * interval, scaled to what it would be at 90 % HRmax. Higher means fitter.
 */
function efficiencyOf(intervals, maxHr) {
  const vals = intervals
    .filter((p) => p.last2FlatSpeed != null && p.last2Pct > 50)
    .map((p) => (p.last2FlatSpeed * 90) / p.last2Pct);
  return r1(mean(vals));
}

/**
 * Next-session recommendation from the last 2 min of each full interval.
 * Below the zone → harder; above → easier. The change is expressed in the user's
 * preferred way (speed, incline or both) and starts from what they actually ran.
 */
export function recommendNext(rec, stats = workoutStats(rec)) {
  const s = rec.settings;
  const zone = s.zones.interval;
  const activity = activityOf(s);
  const counted = stats.intervals.filter((p) => p.counts && p.last2Pct != null);
  const base = { ...((rec.finalTargets && rec.finalTargets.interval) || phaseTargets(s, activity.id).interval) };
  const out = (o) => ({ activity: activity.id, applicable: activity.controls.length > 0, ...o });
  if (rec.kind === 'maxTest') return out({ action: 'none', reason: 'test', base, next: base, pct: null });
  if (!hasMaxHr(s)) return out({ action: 'none', reason: 'maxHr', base, next: base, pct: null });
  if (counted.length < 2) return out({ action: 'none', reason: 'tooShort', base, next: base, pct: null });

  const pct = r1(mean(counted.map((p) => p.last2Pct)));
  let dir = 0;
  if (pct < zone[0]) dir = 1;
  else if (pct > zone[1]) dir = -1;
  if (!dir) return out({ action: 'keep', pct, base, next: base });

  const off = dir > 0 ? zone[0] - pct : pct - zone[1];
  const steps = off >= 4 ? 2 : 1;
  const next = { ...base };
  const chosen = preferredControls(s, activity);
  const both = chosen.length > 1;
  chosen.forEach((c, i) => {
    if (!Number.isFinite(base[c.key])) return;
    // With both, the first control takes the full step and the second a single one.
    const change = both ? (i === 0 ? steps : 1) * c.bothStep : steps * c.nextStep;
    next[c.key] = Math.min(c.max, Math.max(c.recMin, roundTo(base[c.key] + dir * change, c.dec)));
  });
  return out({ action: dir > 0 ? 'harder' : 'easier', pct, base, next });
}

// ---------- progress over weeks ----------

function avgByKey(overalls) {
  const out = {};
  for (const o of overalls) {
    for (const key of Object.keys(o.avgInterval || {})) {
      if (!out[key]) out[key] = [];
      if (o.avgInterval[key] != null) out[key].push(o.avgInterval[key]);
    }
  }
  for (const key of Object.keys(out)) out[key] = r1(mean(out[key]));
  return out;
}

/** Monday 00:00 local time of the week `date` falls in, as YYYY-MM-DD. */
export function weekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nextWeek(key) {
  const [y, m, d] = key.split('-').map(Number);
  return weekKey(new Date(y, m - 1, d + 7, 12));
}

/**
 * @param {object[]} records  workout records (any order)
 * @param {Date} [today]
 */
export function progress(records, today = new Date()) {
  // A max test is not a training session: it would distort the weekly trends.
  const items = records
    .filter((rec) => rec.kind !== 'maxTest')
    .map((rec) => ({ rec, stats: workoutStats(rec) }))
    .sort((a, b) => Date.parse(a.rec.startedAt) - Date.parse(b.rec.startedAt));

  const byWeek = new Map();
  for (const it of items) {
    const k = weekKey(it.rec.startedAt);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(it);
  }

  const weeks = [...byWeek.keys()].sort().map((week) => {
    const list = byWeek.get(week);
    const o = list.map((x) => x.stats.overall);
    const pick = (f) => r1(mean(o.map(f).filter((v) => v != null)));
    return {
      week,
      workouts: list.length,
      avgIntervalPct: pick((x) => x.avgIntervalPct),
      avgIntervalHr: round(pick((x) => x.avgIntervalHr)),
      timeInZonePct: round(pick((x) => x.timeInZonePct)),
      avgSpeed: pick((x) => x.avgIntervalSpeed),
      avgIncline: pick((x) => x.avgIntervalIncline),
      avg: avgByKey(o),
      efficiency: pick((x) => x.efficiency),
      intervalMin: Math.round(o.reduce((a, x) => a + x.intervalSec, 0) / 60),
    };
  });

  // Week streaks: consecutive calendar weeks with at least one workout.
  let best = 0;
  let run = 0;
  let prev = null;
  for (const w of weeks) {
    run = prev && nextWeek(prev) === w.week ? run + 1 : 1;
    best = Math.max(best, run);
    prev = w.week;
  }
  const thisWeek = weekKey(today);
  const lastWeek = weekKey(new Date(new Date(today).setDate(new Date(today).getDate() - 7)));
  // The current streak stays alive through the current week until it is over.
  const current = prev === thisWeek || prev === lastWeek ? run : 0;

  return {
    weeks,
    total: items.length,
    thisWeek: (byWeek.get(thisWeek) || []).length,
    intervalMin: weeks.reduce((a, w) => a + w.intervalMin, 0),
    streak: { current, best },
    perWorkout: items.map(({ rec, stats }) => ({
      id: rec.id,
      startedAt: rec.startedAt,
      efficiency: stats.overall.efficiency,
      avgIntervalPct: stats.overall.avgIntervalPct,
    })),
  };
}
