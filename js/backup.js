// CSV export and JSON backup/restore. DOM-free.

import { workoutStats } from './stats.js';
import { DEFAULT_SETTINGS, mergeDeep } from './settings.js';
import { activityOf } from './activities.js';

// Every machine control across activities, as CSV columns.
const CONTROL_COLUMNS = [
  ['speed', 'speed_kmh'],
  ['incline', 'incline_pct'],
  ['level', 'level'],
  ['cadence', 'cadence_rpm'],
  ['power', 'power_w'],
  ['rate', 'stroke_rate_spm'],
];

export const BACKUP_FORMAT = 1;

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** One row per workout, oldest first. */
export function sessionsCsv(records) {
  const head = [
    'date',
    'start_time_utc',
    'duration_min',
    'intervals_done',
    'intervals_planned',
    'avg_hr',
    'max_hr',
    'avg_interval_hr',
    'interval_last2min_pct_hrmax',
    'interval_time_in_zone_pct',
    'avg_interval_speed_kmh',
    'avg_interval_incline_pct',
    'avg_interval_level',
    'avg_interval_cadence_rpm',
    'avg_interval_power_w',
    'avg_interval_stroke_rate_spm',
    'speed_at_90pct_hrmax_kmh',
    'avg_hr_recovery_60s',
    'max_hr_setting',
    'rpe',
    'note',
    'source',
    'activity',
    'kind',
    'test_peak_hr',
  ];
  const rows = records
    .slice()
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((rec) => {
      const o = workoutStats(rec).overall;
      return [
        rec.startedAt.slice(0, 10),
        rec.startedAt,
        (rec.durationSec / 60).toFixed(1),
        o.intervalsDone,
        o.intervalsPlanned,
        o.avgHr,
        o.maxHr,
        o.avgIntervalHr,
        o.avgIntervalPct,
        o.timeInZonePct,
        o.avgIntervalSpeed,
        o.avgIntervalIncline,
        o.avgInterval.level ?? null,
        o.avgInterval.cadence ?? null,
        o.avgInterval.power ?? null,
        o.avgInterval.rate ?? null,
        o.efficiency,
        o.avgHrr60,
        rec.settings.maxHr,
        rec.rpe ?? null,
        rec.note || null,
        rec.source,
        activityOf(rec.settings).id,
        rec.kind || 'workout',
        o.peakHr,
      ];
    });
  return toCsv([head, ...rows]);
}

/** One row per second of a single workout. */
export function samplesCsv(rec) {
  const phaseAt = [];
  for (const p of rec.phases) {
    const end = Math.round(p.endSec ?? rec.durationSec);
    for (let s = Math.round(p.startSec); s < end; s++) phaseAt[s] = p;
  }
  const sorted = rec.treadmillLog.slice().sort((a, b) => a.t - b.t);
  const keys = activityOf(rec.settings).controls.map((c) => c.key);
  const cols = CONTROL_COLUMNS.filter(([key]) => keys.includes(key));
  const rows = [['second', 'time_utc', 'hr_bpm', 'phase', 'phase_number', ...cols.map((c) => c[1])]];
  const start = Date.parse(rec.startedAt);
  let k = -1;
  for (let s = 0; s <= rec.durationSec; s++) {
    while (k + 1 < sorted.length && sorted[k + 1].t <= s) k++;
    const p = phaseAt[s] || phaseAt[s - 1];
    rows.push([
      s,
      new Date(start + s * 1000).toISOString(),
      rec.samples[s] ?? null,
      p ? p.type : null,
      p ? p.index : null,
      ...cols.map(([key]) => (k >= 0 ? sorted[k][key] ?? null : null)),
    ]);
  }
  return toCsv(rows);
}

export function makeBackup({ settings, workouts }, now = new Date()) {
  return {
    app: 'fjord',
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    settings,
    workouts,
  };
}

function validWorkout(w) {
  return (
    w &&
    typeof w.id === 'string' &&
    typeof w.startedAt === 'string' &&
    !isNaN(Date.parse(w.startedAt)) &&
    Number.isFinite(w.durationSec) &&
    Array.isArray(w.samples) &&
    Array.isArray(w.phases) &&
    Array.isArray(w.treadmillLog) &&
    w.settings &&
    w.plan
  );
}

/**
 * Parse and check a backup file.
 * @returns {{ ok: true, settings: object|null, workouts: object[], skipped: number } | { ok: false, error: string }}
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return { ok: false, error: 'notJson' };
  }
  if (!data || data.app !== 'fjord' || !Array.isArray(data.workouts)) return { ok: false, error: 'notFjord' };
  if (data.format > BACKUP_FORMAT) return { ok: false, error: 'newer' };
  const workouts = data.workouts.filter(validWorkout);
  return {
    ok: true,
    settings: data.settings && typeof data.settings === 'object' ? mergeDeep(DEFAULT_SETTINGS, data.settings) : null,
    workouts,
    skipped: data.workouts.length - workouts.length,
  };
}
