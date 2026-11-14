// Chart geometry, computed without touching the DOM so it can be unit tested.
// The UI modules turn the returned numbers into SVG.

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Live heart-rate strip ending at `endSec`, anchored to the right edge. Its window
 * grows from 30 seconds to `windowSec`, so early readings do not sit in a tiny sliver.
 * The target zone of each phase is drawn as a band behind the line.
 *
 * @param {object} o
 * @param {(number|null)[]} o.samples  bpm per workout second (null = no reading)
 * @param {number} o.endSec            newest second to draw
 * @param {{startSec:number, endSec:number, zone:[number, number]}[]} o.phases
 * @param {number} o.maxHr
 * @returns {{ d: string, bands: {x:number, y:number, w:number, h:number}[], lo: number, hi: number, windowSec: number }}
 *          `d` is an SVG path (gaps in the data start a new sub-path); lo/hi are the
 *          % HRmax values at the bottom and top edge.
 */
export function liveChartGeometry({ samples, endSec, phases, maxHr, windowSec = 180, width = 180, height = 60 }) {
  const span = Math.min(windowSec, Math.max(30, endSec));
  const from = endSec - span;
  const first = Math.max(0, from);
  const pct = (bpm) => (bpm / maxHr) * 100;

  const visible = phases
    .map((p) => ({ a: Math.max(p.startSec, first), b: Math.min(p.endSec, endSec), zone: p.zone }))
    .filter((p) => p.b >= p.a);

  // Vertical range: fit both the data and the zones on screen, with some headroom.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of visible) {
    lo = Math.min(lo, p.zone[0]);
    hi = Math.max(hi, p.zone[1]);
  }
  for (let t = first; t <= endSec; t++) {
    const v = samples[t];
    if (v == null) continue;
    lo = Math.min(lo, pct(v));
    hi = Math.max(hi, pct(v));
  }
  if (!isFinite(lo)) {
    lo = 50;
    hi = 100;
  }
  lo -= 4;
  hi += 4;
  if (hi - lo < 20) {
    const mid = (hi + lo) / 2;
    lo = mid - 10;
    hi = mid + 10;
  }

  const x = (t) => ((t - from) / span) * width;
  const y = (p) => height - ((p - lo) / (hi - lo)) * height;

  const bands = visible
    .filter((p) => p.b > p.a)
    .map((p) => ({
      x: r1(x(p.a)),
      y: r1(y(p.zone[1])),
      w: r1(x(p.b) - x(p.a)),
      h: r1(y(p.zone[0]) - y(p.zone[1])),
    }));

  let d = '';
  let pen = false;
  for (let t = first; t <= endSec; t++) {
    const v = samples[t];
    if (v == null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${r1(x(t))} ${r1(y(pct(v)))}`;
    pen = true;
  }

  return { d, bands, lo, hi, windowSec: span };
}

/** Round, human-friendly tick values covering [lo, hi]. */
export function niceTicks(lo, hi, count = 4) {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = first; v <= last + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, step, min: first, max: last };
}

// Sized so 10–11 px labels in viewBox units stay readable when scaled to a phone width.
export const WORKOUT_CHART = { width: 400, height: 210, left: 30, right: 6, top: 8, bottom: 18 };

/**
 * Whole-workout HR chart: line, zone band per phase, phase boundaries, axes.
 * @param {object} rec workout record
 * @param {{startSec:number, endSec:number, zone:[number,number], type:string, index:number|null}[]} phases
 */
export function workoutChartGeometry(rec, phases, box = WORKOUT_CHART) {
  const { width, height, left, right, top, bottom } = box;
  const maxHr = rec.settings.maxHr;
  const dur = Math.max(1, rec.durationSec);
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  let lo = Infinity;
  let hi = -Infinity;
  for (let s = 0; s <= dur; s++) {
    const v = rec.samples[s];
    if (v == null) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (const p of phases) {
    lo = Math.min(lo, (p.zone[0] / 100) * maxHr);
    hi = Math.max(hi, (p.zone[1] / 100) * maxHr);
  }
  if (!isFinite(lo)) {
    lo = maxHr * 0.5;
    hi = maxHr;
  }
  const yt = niceTicks(lo - 5, hi + 5, 4);
  const x = (s) => left + (s / dur) * plotW;
  const y = (bpm) => top + plotH - ((bpm - yt.min) / (yt.max - yt.min)) * plotH;

  const bands = phases.map((p) => ({
    x: r1(x(p.startSec)),
    w: r1(x(p.endSec) - x(p.startSec)),
    y: r1(y((p.zone[1] / 100) * maxHr)),
    h: r1(y((p.zone[0] / 100) * maxHr) - y((p.zone[1] / 100) * maxHr)),
    type: p.type,
  }));
  const markers = phases.slice(1).map((p) => ({ x: r1(x(p.startSec)), type: p.type, index: p.index }));

  let d = '';
  let pen = false;
  for (let s = 0; s <= dur; s++) {
    const v = rec.samples[s];
    if (v == null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${r1(x(s))} ${r1(y(v))}`;
    pen = true;
  }

  const minStep = [1, 2, 5, 10, 15, 20, 30, 60].find((m) => (dur / 60 / m) <= 8) || 60;
  const xTicks = [];
  for (let m = 0; m * 60 <= dur; m += minStep) xTicks.push({ x: r1(x(m * 60)), label: String(m) });

  return {
    width,
    height,
    plot: { left, top, width: plotW, height: plotH },
    d,
    bands,
    markers,
    yTicks: yt.ticks.map((v) => ({ y: r1(y(v)), label: String(v) })),
    xTicks,
    secAt: (px) => Math.max(0, Math.min(dur, Math.round(((px - left) / plotW) * dur))),
    xOf: x,
    yOf: y,
  };
}

export const TREND_CHART = { width: 320, height: 140, left: 34, right: 10, top: 10, bottom: 20 };

/**
 * One-series trend over weeks. Points are placed by real week distance, so a gap
 * of three weeks looks like one. Missing values break the line.
 * @param {{week:string, v:number|null}[]} points  sorted by week (YYYY-MM-DD Mondays)
 */
export function trendChartGeometry(points, box = TREND_CHART) {
  const { width, height, left, right, top, bottom } = box;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const day = (k) => {
    const [yy, mm, dd] = k.split('-').map(Number);
    return Date.UTC(yy, mm - 1, dd) / 86400000;
  };
  const vals = points.filter((p) => p.v != null);
  if (!vals.length) return { width, height, d: '', dots: [], yTicks: [], xTicks: [], empty: true };

  const t0 = day(points[0].week);
  const t1 = day(points[points.length - 1].week);
  const span = Math.max(7, t1 - t0);
  const yt = niceTicks(Math.min(...vals.map((p) => p.v)), Math.max(...vals.map((p) => p.v)), 3);
  const single = points.length === 1;
  const x = (k) => (single ? left + plotW / 2 : left + ((day(k) - t0) / span) * plotW);
  const y = (v) => top + plotH - ((v - yt.min) / (yt.max - yt.min)) * plotH;

  let d = '';
  let pen = false;
  const dots = [];
  for (const p of points) {
    if (p.v == null) {
      pen = false;
      continue;
    }
    const px = r1(x(p.week));
    const py = r1(y(p.v));
    d += `${pen ? 'L' : 'M'}${px} ${py}`;
    pen = true;
    dots.push({ x: px, y: py, week: p.week, v: p.v });
  }

  // At most ~5 week labels.
  const every = Math.max(1, Math.ceil(points.length / 5));
  const xTicks = points.filter((_, i) => i % every === 0).map((p) => ({ x: r1(x(p.week)), week: p.week }));

  return {
    width,
    height,
    plot: { left, top, width: plotW, height: plotH },
    d,
    dots,
    yTicks: yt.ticks.map((v) => ({ y: r1(y(v)), v })),
    xTicks,
    empty: false,
  };
}
