// Heart-rate math on 1 Hz sample arrays (index = workout second, value = bpm or null).
// DOM-free.

/** Mean of non-null samples in (endIdx − windowSec, endIdx]. */
export function smoothedHr(samples, endIdx, windowSec = 5) {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, endIdx - windowSec + 1); i <= endIdx; i++) {
    const v = samples[i];
    if (v != null) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : null;
}

/**
 * Least-squares slope of HR over the last `windowSec` seconds, in bpm per minute.
 * Returns null when there are fewer than `minPoints` samples.
 */
export function hrTrend(samples, endIdx, windowSec = 18, minPoints = 8) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = Math.max(0, endIdx - windowSec + 1); i <= endIdx; i++) {
    const v = samples[i];
    if (v == null) continue;
    n++;
    sx += i;
    sy += v;
    sxx += i * i;
    sxy += i * v;
  }
  if (n < minPoints) return null;
  const den = n * sxx - sx * sx;
  if (den === 0) return 0;
  return ((n * sxy - sx * sy) / den) * 60;
}

/** Whole-bpm range that counts as inside a [low %, high %] zone, e.g. [162, 180]. */
export function zoneBpm(zone, maxHr) {
  return [Math.ceil((zone[0] / 100) * maxHr - 1e-9), Math.floor((zone[1] / 100) * maxHr + 1e-9)];
}

export function pctOfMax(bpm, maxHr) {
  return bpm == null || !maxHr ? null : (bpm / maxHr) * 100;
}

/**
 * Zone status with hysteresis: entering a state happens at the zone edge,
 * leaving the zone needs to overshoot the edge by `hyst` percentage points.
 */
export function zoneStatus(pct, zone, prev = null, hyst = 1) {
  if (pct == null) return null;
  const [lo, hi] = zone;
  if (prev === 'in') {
    if (pct < lo - hyst) return 'below';
    if (pct > hi + hyst) return 'above';
    return 'in';
  }
  if (pct > hi) return 'above';
  if (pct >= lo) return 'in';
  return 'below';
}
