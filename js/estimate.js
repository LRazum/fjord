// Interval targets estimated from past workouts, and a warm-up check that corrects
// them for the day. Pure logic, no DOM.
//
// The model: the fraction of heart-rate reserve tracks the fraction of VO2 reserve
// (Swain & Leutholtz), and the oxygen cost of a machine setting comes from the same
// ACSM-style equations the simulator uses. So every steady stretch of a workout
// (a setting held, a heart rate measured) gives an estimate of the athlete's
// "capacity" (VO2max in those equations). The capacity seen at the end of past
// intervals sets the next interval target; the warm-up shows whether today is a
// normal day, and the ratio between the two in past workouts calibrates it.

import { vo2Machine } from './simulator.js';
import { settingsPerSecond, weekKey } from './stats.js';
import { hrTrend } from './hrmath.js';
import { hasMaxHr } from './settings.js';
import { ACTIVITIES, activityOf, phaseTargets, preferredControls, roundTo } from './activities.js';

const REST_VO2 = 3.5;
const DEFAULT_REST_HR = 60;
const TAIL_SEC = 120; // last 2 min of an interval or warm-up
const MIN_INTERVAL_SEC = 150;
const MIN_WARMUP_SEC = 240;
const MAX_WORKOUTS = 5;
const MAX_AGE_DAYS = 56;
export const MIN_WORKOUTS = 2;

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const restOf = (s) => (Number.isFinite(s.restHr) && s.restHr > 0 ? s.restHr : DEFAULT_REST_HR);

/** Fraction of heart-rate reserve at `pct` % HRmax. */
export function hrrFraction(pct, maxHr, restHr = DEFAULT_REST_HR) {
  return ((pct / 100) * maxHr - restHr) / (maxHr - restHr);
}

/** VO2max implied by holding a setting that costs `cost` at `pct` % HRmax; null if unusable. */
export function capacityFrom(cost, pct, maxHr, restHr) {
  const f = hrrFraction(pct, maxHr, restHr);
  if (!(f > 0.25) || !(cost > REST_VO2)) return null;
  return REST_VO2 + (cost - REST_VO2) / f;
}

/** Oxygen cost that lands at `pct` % HRmax for a given capacity. */
export function costAt(capacity, pct, maxHr, restHr) {
  return REST_VO2 + (capacity - REST_VO2) * hrrFraction(pct, maxHr, restHr);
}

const zoneMid = (zone) => (zone[0] + zone[1]) / 2;

/** Snap to the control's settable step, within its recommendation range. */
function snap(c, v) {
  const step = c.setStep || c.step;
  return roundTo(Math.min(c.max, Math.max(c.recMin, Math.round(v / step) * step)), c.dec);
}

/**
 * Change one control of `base` so the setting costs `cost`. Tries the preferred
 * control first, then any other that changes the cost (a rower's stroke rate does
 * not). Returns { key, value, values } or null.
 */
export function solveFor(activity, settings, base, cost) {
  const pref = preferredControls(settings, activity);
  const order = [...pref, ...activity.controls.filter((c) => !pref.includes(c))];
  for (const c of order) {
    if (!Number.isFinite(base[c.key])) continue;
    const at = (v) => vo2Machine(activity.id, { ...base, [c.key]: v });
    let lo = c.recMin;
    let hi = c.max;
    if (!(at(hi) - at(lo) > 1e-6)) continue;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < cost) lo = mid;
      else hi = mid;
    }
    const value = snap(c, (lo + hi) / 2);
    return { key: c.key, value, values: { ...base, [c.key]: value } };
  }
  return null;
}

/** Mean % HRmax and mean oxygen cost over workout seconds [s0, s1). */
function windowLoad(rec, tm, activityId, s0, s1, kg) {
  const hr = [];
  const cost = [];
  const keys = Object.keys(tm);
  for (let s = Math.max(0, s0); s < s1; s++) {
    const bpm = rec.samples[s];
    const values = {};
    for (const k of keys) values[k] = tm[k][s];
    if (bpm == null || keys.some((k) => values[k] == null)) continue;
    hr.push(bpm);
    cost.push(vo2Machine(activityId, values, kg));
  }
  if (hr.length < (s1 - s0) / 2) return null;
  return { pct: (mean(hr) / rec.settings.maxHr) * 100, cost: mean(cost) };
}

/**
 * Interval and warm-up capacity of one finished workout; null when it says nothing.
 * `kg` only matters for the bike and the rower (watts become ml/kg/min).
 */
export function workoutCapacity(rec, kg = 75) {
  if (rec.kind === 'maxTest' || !rec.settings || !hasMaxHr(rec.settings)) return null;
  const activity = activityOf(rec.settings);
  if (!activity.controls.length) return null;
  const keys = activity.controls.map((c) => c.key);
  const tm = settingsPerSecond(rec.treadmillLog || [], rec.durationSec, keys);
  const maxHr = rec.settings.maxHr;
  const rest = restOf(rec.settings);
  const caps = [];
  let warm = null;
  for (const p of rec.phases || []) {
    const s0 = Math.round(p.startSec);
    const s1 = Math.round(p.endSec ?? rec.durationSec);
    if (p.type === 'interval' && s1 - s0 >= MIN_INTERVAL_SEC) {
      const w = windowLoad(rec, tm, activity.id, s1 - TAIL_SEC, s1, kg);
      const cap = w && capacityFrom(w.cost, w.pct, maxHr, rest);
      if (cap) caps.push(cap);
    } else if (p.type === 'warmup' && s1 - s0 >= MIN_WARMUP_SEC) {
      const w = windowLoad(rec, tm, activity.id, s1 - TAIL_SEC, s1, kg);
      warm = w && capacityFrom(w.cost, w.pct, maxHr, rest);
    }
  }
  if (caps.length < 2) return null;
  const interval = median(caps);
  return { activity: activity.id, interval, warmup: warm, ratio: warm ? interval / warm : null };
}

/**
 * Per-activity history models from the most recent workouts (at most 5, within
 * 8 weeks). Simulated workouts only count while there are no real ones.
 * Returns { [activityId]: { n, capacity, ratio, nRatio } }.
 */
export function buildModels(records, now = new Date()) {
  const since = now.getTime() - MAX_AGE_DAYS * 86400000;
  const recent = records
    .filter((r) => r && r.kind !== 'maxTest' && Date.parse(r.startedAt) >= since)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const out = {};
  for (const a of ACTIVITIES) {
    if (!a.controls.length) continue;
    const mine = recent.filter((r) => activityOf(r.settings).id === a.id);
    const real = mine.filter((r) => r.source !== 'sim');
    const pool = real.length ? real : mine;
    const caps = [];
    for (const r of pool) {
      const c = workoutCapacity(r);
      if (c) caps.push(c);
      if (caps.length >= MAX_WORKOUTS) break;
    }
    if (!caps.length) continue;
    const ratios = caps.map((c) => c.ratio).filter((v) => v != null);
    out[a.id] = {
      n: caps.length,
      sim: !real.length,
      capacity: median(caps.map((c) => c.interval)),
      ratio: median(ratios),
      nRatio: ratios.length,
    };
  }
  return out;
}

/**
 * The interval target the history points to, for the current activity.
 * Returns { values, key, n } or null (manual plan, too little history, no HRmax).
 */
export function estimateInterval(settings, model) {
  const activity = activityOf(settings);
  if (!activity.controls.length || !model || model.n < MIN_WORKOUTS || !hasMaxHr(settings)) return null;
  const cost = costAt(model.capacity, zoneMid(settings.zones.interval), settings.maxHr, restOf(settings));
  const base = { ...phaseTargets(settings, activity.id).interval };
  const solved = solveFor(activity, settings, base, cost);
  return solved && { values: solved.values, key: solved.key, n: model.n, sim: model.sim };
}

/**
 * Settings for the next workout: with the automatic plan and enough history, the
 * interval target is the estimate. The saved manual plan itself is not changed.
 */
export function plannedSettings(settings, models) {
  const activity = activityOf(settings);
  const est = settings.intervalPlan === 'auto' ? estimateInterval(settings, models && models[activity.id]) : null;
  if (!est) return { settings, estimate: null };
  const s = JSON.parse(JSON.stringify(settings));
  if (activity.id === 'treadmill') s.treadmill.interval = { ...est.values };
  else s.targets[activity.id].interval = { ...est.values };
  return { settings: s, estimate: est };
}

/**
 * Near the end of the warm-up: compare today's warm-up heart rate with what the
 * planned interval target implies, and suggest a correction for the intervals.
 *
 * @param {object} o
 * @param {object} o.settings       session settings
 * @param {Array}  o.samples        1 Hz HR so far
 * @param {Array}  o.log            machine log so far
 * @param {number} o.nowSec         current workout second (samples exist before it)
 * @param {number} o.warmStartSec   when the warm-up began
 * @param {object} o.intervalTarget planned interval values
 * @param {object} [o.model]        history model of this activity
 * @returns {null | {action: 'wait'} | {action: 'keep'|'harder'|'easier', ...}}
 *   null = cannot judge today; 'wait' = not steady yet, try again.
 */
export function warmupCheck({ settings, samples, log, nowSec, warmStartSec, intervalTarget, model = null }) {
  const activity = activityOf(settings);
  if (!activity.controls.length || !hasMaxHr(settings)) return null;
  const s0 = nowSec - TAIL_SEC;
  if (s0 - warmStartSec < MIN_WARMUP_SEC - TAIL_SEC) return null;
  // Heart rate needs about two minutes at one setting to settle.
  if (log.some((e) => e.t > s0 && e.t <= nowSec)) return { action: 'wait' };
  const hr = samples.slice(s0, nowSec).filter((v) => v != null);
  if (hr.length < TAIL_SEC * 0.75) return { action: 'wait' };
  const slope = hrTrend(samples, nowSec - 1, 60, 30);
  if (slope == null || Math.abs(slope) > 4) return { action: 'wait' };

  const keys = activity.controls.map((c) => c.key);
  const upTo = log.filter((e) => e.t <= nowSec);
  const last = upTo[upTo.length - 1];
  if (!last || keys.some((k) => !Number.isFinite(last[k]))) return null;
  const cost = vo2Machine(activity.id, last);

  const maxHr = settings.maxHr;
  const rest = restOf(settings);
  const hrNow = mean(hr);
  const capWarm = capacityFrom(cost, (hrNow / maxHr) * 100, maxHr, rest);
  if (!capWarm) return null;

  const calibrated = !!model && model.nRatio >= MIN_WORKOUTS;
  const ratio = calibrated ? model.ratio : 1;
  const mid = zoneMid(settings.zones.interval);
  const capPlanned = capacityFrom(vo2Machine(activity.id, intervalTarget), mid, maxHr, rest);
  if (!capPlanned) return null;

  // Heart rate today's warm-up would show if the planned interval were exactly right.
  const expWarmCap = capPlanned / ratio;
  const expected = rest + ((cost - REST_VO2) / (expWarmCap - REST_VO2)) * (maxHr - rest);
  const delta = Math.round(hrNow - expected);
  const base = { action: 'keep', hr: Math.round(hrNow), expected: Math.round(expected), delta, calibrated };
  if (Math.abs(delta) < (calibrated ? 4 : 6)) return base;

  const target = costAt(capWarm * ratio, mid, maxHr, rest);
  const solved = solveFor(activity, settings, { ...intervalTarget }, target);
  if (!solved) return base;
  const c = activity.controls.find((x) => x.key === solved.key);
  const from = intervalTarget[c.key];
  const dir = Math.sign(solved.value - from);
  if (!dir || dir !== -Math.sign(delta)) return base;
  // At most two of the usual recommendation steps: a warm-up is a rough signal.
  const steps = Math.min(2, Math.max(1, Math.round(Math.abs(solved.value - from) / c.nextStep)));
  const to = roundTo(Math.min(c.max, Math.max(c.recMin, from + dir * steps * c.nextStep)), c.dec);
  if (to === from) return base;
  return { ...base, action: dir > 0 ? 'harder' : 'easier', key: c.key, from, to };
}

// ---------- VO2max ----------
//
// The interval capacity is the VO2max of the ACSM equations: the oxygen cost of the
// setting held over the last 2 min of an interval, extrapolated along the heart-rate
// reserve to HRmax. Intervals run at 85–95 % HRmax, so the extrapolation is short.
// It reads a little low (cardiac drift raises HR late in an interval) and machine
// estimates differ from each other: a bike value is usually below a running one.

const WEIGHT_ACTIVITIES = ['bike', 'rower'];
const validKg = (kg) => Number.isFinite(kg) && kg >= 30 && kg <= 250;

/**
 * VO2max (ml/kg/min) from one workout, or null. Bike and rower need body mass.
 * The current profile fills in body mass and resting HR a workout was saved without.
 */
export function vo2maxOf(rec, fallbackKg = null, fallbackRestHr = null) {
  if (!rec || rec.kind === 'maxTest' || !rec.settings) return null;
  if (!(rec.settings.restHr > 0) && fallbackRestHr > 0) rec = { ...rec, settings: { ...rec.settings, restHr: fallbackRestHr } };
  const activity = activityOf(rec.settings);
  let kg = 75;
  if (WEIGHT_ACTIVITIES.includes(activity.id)) {
    kg = validKg(rec.settings.weightKg) ? rec.settings.weightKg : fallbackKg;
    if (!validKg(kg)) return null;
  }
  const c = workoutCapacity(rec, kg);
  return c ? Math.round(c.interval * 10) / 10 : null;
}

/**
 * Current VO2max for one activity: the median of the last 5 workouts within 8 weeks
 * (real ones when there are any). Returns { value, n, sim } or { value: null, reason }.
 */
export function currentVo2max(records, activityId, { now = new Date(), kg = null, restHr = null } = {}) {
  const a = ACTIVITIES.find((x) => x.id === activityId);
  if (!a || !a.controls.length) return { value: null, reason: 'outdoor' };
  if (WEIGHT_ACTIVITIES.includes(a.id) && !validKg(kg)
    && !records.some((r) => activityOf(r.settings).id === a.id && validKg(r.settings.weightKg))) {
    return { value: null, reason: 'weight' };
  }
  const since = now.getTime() - MAX_AGE_DAYS * 86400000;
  const mine = records
    .filter((r) => r && r.kind !== 'maxTest' && Date.parse(r.startedAt) >= since && activityOf(r.settings).id === a.id)
    .sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt));
  const real = mine.filter((r) => r.source !== 'sim');
  const pool = real.length ? real : mine;
  const values = [];
  for (const r of pool) {
    const v = vo2maxOf(r, kg, restHr);
    if (v != null) values.push(v);
    if (values.length >= MAX_WORKOUTS) break;
  }
  if (values.length < MIN_WORKOUTS) return { value: null, reason: 'notYet', n: values.length };
  return { value: Math.round(median(values) * 10) / 10, n: values.length, sim: !real.length };
}

/** Weekly mean VO2max of the given workouts: { 'YYYY-MM-DD' (Monday): value }. */
export function vo2maxByWeek(records, kg = null, restHr = null) {
  const byWeek = {};
  for (const r of records) {
    const v = vo2maxOf(r, kg, restHr);
    if (v == null) continue;
    const k = weekKey(r.startedAt);
    (byWeek[k] = byWeek[k] || []).push(v);
  }
  const out = {};
  for (const k of Object.keys(byWeek)) out[k] = Math.round(mean(byWeek[k]) * 10) / 10;
  return out;
}

/**
 * VO2max standard ratings (ml/kg/min), The Cooper Institute, as published by Garmin.
 * Per age band 20–29 … 70–79: lower bounds of superior (95th percentile), excellent
 * (80th), good (60th) and fair (40th); below fair is poor.
 */
export const VO2_NORMS = {
  male: [[55.4, 51.1, 45.4, 41.7], [54, 48.3, 44, 40.5], [52.5, 46.4, 42.4, 38.5],
    [48.9, 43.4, 39.2, 35.6], [45.7, 39.5, 35.5, 32.3], [42.1, 36.7, 32.3, 29.4]],
  female: [[49.6, 43.9, 39.5, 36.1], [47.4, 42.4, 37.8, 34.4], [45.3, 39.7, 36.3, 33],
    [41.1, 36.7, 33, 30.1], [37.8, 33, 30, 27.5], [36.7, 30.9, 28.1, 25.9]],
};
export const VO2_LEVELS = ['poor', 'fair', 'good', 'excellent', 'superior'];

/**
 * Rating of a VO2max for an age and sex, or null without both. Ages outside 20–79 use
 * the nearest band. `position` (0–1) places the value on a five-segment scale.
 */
export function vo2Rating(value, age, sex) {
  if (!Number.isFinite(value) || !Number.isFinite(age) || !VO2_NORMS[sex]) return null;
  const band = Math.max(0, Math.min(5, Math.floor((age - 20) / 10)));
  const [sup, exc, good, fair] = VO2_NORMS[sex][band];
  // Segment edges from poor to superior; the open ends get a width like their neighbours.
  const edges = [fair - (good - fair), fair, good, exc, sup, sup + (sup - exc)];
  let i = 0;
  while (i < 4 && value >= edges[i + 1]) i++;
  const f = Math.max(0, Math.min(1, (value - edges[i]) / (edges[i + 1] - edges[i])));
  return {
    level: VO2_LEVELS[i],
    band: `${20 + band * 10}–${29 + band * 10}`,
    thresholds: { superior: sup, excellent: exc, good, fair },
    position: (i + f) / 5,
  };
}
