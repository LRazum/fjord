// User settings. Small, so they live in localStorage; workouts go to IndexedDB.

const KEY = 'fjord.settings';

export const DEFAULT_SETTINGS = {
  version: 2,
  lang: 'en',
  onboarded: false,

  maxHr: 190,
  maxHrSource: 'default', // 'known' | 'age' | 'default'
  age: null,
  restHr: null,

  strapModel: 'other',
  hrSource: 'strap', // 'strap' | 'sim' (the simulator is always used without Web Bluetooth)
  adjustPref: 'speed', // 'speed' | 'incline' | 'both'
  speedStep: 0.5,
  inclineStep: 0.5,
  coachingEnabled: true,

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

/** 208 − 0.7 × age (Tanaka). */
export function estimateMaxHr(age) {
  return Math.round(208 - 0.7 * age);
}

const validAge = (age) => Number.isFinite(age) && age >= 10 && age <= 99;

/** The fallback value must never silently become a personal HRmax. */
export function hasMaxHr(s) {
  if (!Number.isFinite(s.maxHr) || s.maxHr < 120 || s.maxHr > 230) return false;
  return s.maxHrSource === 'known' || (s.maxHrSource === 'age' && validAge(s.age));
}

/** Shared profile edits keep the source and age-based estimate in step. */
export function updateHeartRateSettings(s, path, value) {
  if (path === 'maxHrSource' && (value === 'known' || value === 'age')) {
    s.maxHrSource = value;
    if (value === 'age' && validAge(s.age)) s.maxHr = estimateMaxHr(s.age);
  } else if (path === 'age') {
    s.age = value;
    if (s.maxHrSource === 'age' && validAge(value)) s.maxHr = estimateMaxHr(value);
  } else if (path === 'maxHr') {
    s.maxHr = value;
    s.maxHrSource = 'known';
  } else return false;
  return true;
}
