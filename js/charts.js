// Chart geometry, computed without touching the DOM so it can be unit tested.
// The UI modules turn the returned numbers into SVG.

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Live heart-rate strip: the last `windowSec` seconds ending at `endSec`, anchored to
 * the right edge, with the target zone of each phase drawn as a band behind the line.
 *
 * @param {object} o
 * @param {(number|null)[]} o.samples  bpm per workout second (null = no reading)
 * @param {number} o.endSec            newest second to draw
 * @param {{startSec:number, endSec:number, zone:[number, number]}[]} o.phases
 * @param {number} o.maxHr
 * @returns {{ d: string, bands: {x:number, y:number, w:number, h:number}[], lo: number, hi: number }}
 *          `d` is an SVG path (gaps in the data start a new sub-path); lo/hi are the
 *          % HRmax values at the bottom and top edge.
 */
export function liveChartGeometry({ samples, endSec, phases, maxHr, windowSec = 180, width = 180, height = 60 }) {
  const from = endSec - windowSec;
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

  const x = (t) => ((t - from) / windowSec) * width;
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

  return { d, bands, lo, hi };
}
