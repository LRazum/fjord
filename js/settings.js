// User settings. Small, so they live in localStorage; workouts go to IndexedDB.

const KEY = 'fjord.settings';

export const DEFAULT_SETTINGS = {
  version: 2,
  lang: 'en',
  onboarded: false,

  maxHr: 190,
  maxHrSource: 'default', // 'known' | 'age' | 'test' | 'default'
  maxHrTest: null, // {bpm, at, activity} from the in-app max HR test
  age: null,
  restHr: null,
  sex: null, // 'male' | 'female' | null: only for comparing VO2max with the norms
  weightKg: null, // body mass: only needed for VO2max from the bike and the rower

  strapModel: 'other', // a STRAPS id: a chest strap or a watch broadcasting heart rate
  hrSource: 'strap', // 'strap' | 'sim' (the simulator is always used without Web Bluetooth)
  activity: 'treadmill', // an ACTIVITIES id (activities.js)
  // 'speed' = the activity's first control, 'incline' = its second, 'both' = alternate.
  adjustPref: 'speed', // 'speed' | 'incline' | 'both'
  speedStep: 0.5,
  inclineStep: 0.5,
  coachingEnabled: true,
  // 'auto' = interval target estimated from recent workouts (estimate.js) once there
  // are enough; the planned values below are the fallback. 'manual' = always the plan.
  intervalPlan: 'auto', // 'auto' | 'manual'
  warmupCheck: true, // suggest an interval correction near the end of the warm-up

  // Durations in seconds.
  structure: {
    warmupSec: 600,
    intervals: 4,
    intervalSec: 240,
    recoverySec: 180,
    cooldownSec: 300,
  },

  // Percent of HRmax, [low, high].
  zones: {
    warmup: [60, 75],
    interval: [85, 95],
    recovery: [60, 70],
    cooldown: [50, 65],
  },

  // Planned treadmill settings per phase type.
  treadmill: {
    warmup: { speed: 7.5, incline: 1 },
    interval: { speed: 10.5, incline: 2 },
    recovery: { speed: 6.5, incline: 1 },
    cooldown: { speed: 5.5, incline: 0 },
  },

  // Planned machine settings per phase type for the other indoor activities.
  targets: {
    bike: {
      warmup: { level: 6, cadence: 85 },
      interval: { level: 12, cadence: 90 },
      recovery: { level: 5, cadence: 80 },
      cooldown: { level: 4, cadence: 80 },
    },
    stepmill: {
      warmup: { level: 5 },
      interval: { level: 10 },
      recovery: { level: 4 },
      cooldown: { level: 3 },
    },
    rower: {
      warmup: { power: 120, rate: 20 },
      interval: { power: 220, rate: 26 },
      recovery: { power: 90, rate: 18 },
      cooldown: { power: 80, rate: 18 },
    },
  },

  dev: {
    timeScale: 1,
    simProfile: 'random', // 'random' | 'matched' | 'easy' | 'hard'
  },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge `src` onto a copy of `base`; arrays and primitives are replaced. */
export function mergeDeep(base, src) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isObj(src)) return out;
  for (const k of Object.keys(src)) {
    const b = base[k];
    const s = src[k];
    out[k] = isObj(b) && isObj(s) ? mergeDeep(b, s) : clone(s);
  }
  return out;
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function loadSettings() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (_) {
    stored = null;
  }
  // v1 defaulted to Croatian; v2 switches everyone to English once.
  if (stored && (stored.version || 1) < 2) {
    stored.lang = 'en';
    stored.version = 2;
  }
  return mergeDeep(DEFAULT_SETTINGS, stored);
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch (_) {
    return false;
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch (_) {
    // Nothing stored or storage blocked: either way there is nothing left to remove.
  }
}

/** 208 − 0.7 × age (Tanaka). */
export function estimateMaxHr(age) {
  return Math.round(208 - 0.7 * age);
}

const validAge = (age) => Number.isFinite(age) && age >= 10 && age <= 99;
const validMax = (bpm) => Number.isFinite(bpm) && bpm >= 120 && bpm <= 230;

/** The fallback value must never silently become a personal HRmax. */
export function hasMaxHr(s) {
  if (!validMax(s.maxHr)) return false;
  if (s.maxHrSource === 'test') return !!s.maxHrTest && s.maxHrTest.bpm === s.maxHr;
  return s.maxHrSource === 'known' || (s.maxHrSource === 'age' && validAge(s.age));
}

/** Chosen "test" but no test result yet. */
export function maxHrTestPending(s) {
  return s.maxHrSource === 'test' && !hasMaxHr(s);
}

/** An HRmax a simulated runner can use even before the user has set one. */
export function simMaxHr(s) {
  if (hasMaxHr(s)) return s.maxHr;
  return validAge(s.age) ? estimateMaxHr(s.age) : 190;
}

/** Keep the peak of a max HR test as the personal HRmax. */
export function applyMaxHrTest(s, bpm, activity, at = new Date().toISOString()) {
  const v = Math.round(bpm);
  if (!validMax(v)) return false;
  s.maxHrTest = { bpm: v, at, activity };
  s.maxHr = v;
  s.maxHrSource = 'test';
  return true;
}

/** Shared profile edits keep the source and age-based estimate in step. */
export function updateHeartRateSettings(s, path, value) {
  if (path === 'maxHrSource' && (value === 'known' || value === 'age' || value === 'test')) {
    s.maxHrSource = value;
    if (value === 'age' && validAge(s.age)) s.maxHr = estimateMaxHr(s.age);
    if (value === 'test' && s.maxHrTest && validMax(s.maxHrTest.bpm)) s.maxHr = s.maxHrTest.bpm;
  } else if (path === 'age') {
    s.age = value;
    if (s.maxHrSource === 'age' && validAge(value)) s.maxHr = estimateMaxHr(value);
  } else if (path === 'maxHr') {
    s.maxHr = value;
    s.maxHrSource = 'known';
  } else return false;
  return true;
}
