// SVG rendering of chart geometry (from charts.js) plus hover/touch read-outs.

import { t } from '../i18n.js';
import { fmtClock, fmtNum } from '../format.js';
import { esc, listen } from './dom.js';
import { workoutChartGeometry, trendChartGeometry } from '../charts.js';

const PHASE_SHORT = { warmup: 'W', interval: 'I', recovery: 'R', cooldown: 'C' };

/** Full-workout heart-rate chart with zone bands and phase markers. */
export function workoutChartSvg(rec, phases) {
  const g = workoutChartGeometry(rec, phases);
  const { left, top, width: pw, height: ph } = g.plot;
  const bands = g.bands
    .map((b) => `<rect class="c-band c-band-${b.type}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"></rect>`)
    .join('');
  const markers = g.markers
    .map(
      (m) =>
        `<line class="c-marker" x1="${m.x}" x2="${m.x}" y1="${top}" y2="${top + ph}"></line>` +
        `<text class="c-marker-label" x="${m.x + 3}" y="${top + 10}">${PHASE_SHORT[m.type]}${m.index || ''}</text>`,
    )
    .join('');
  const grid = g.yTicks
    .map(
      (tk) =>
        `<line class="c-grid" x1="${left}" x2="${left + pw}" y1="${tk.y}" y2="${tk.y}"></line>` +
        `<text class="c-ylabel" x="${left - 5}" y="${tk.y + 3.5}">${tk.label}</text>`,
    )
    .join('');
  const xlabels = g.xTicks.map((tk) => `<text class="c-xlabel" x="${tk.x}" y="${g.height - 5}">${tk.label}</text>`).join('');

  const svg = `
    <svg class="chart chart-workout" viewBox="0 0 ${g.width} ${g.height}" role="img"
         aria-label="${esc(t('det.chartLabel'))}">
      ${grid}${bands}${markers}
      <path class="c-line" d="${g.d}"></path>
      <text class="c-xlabel c-unit" x="${left + pw}" y="${g.height - 5}" text-anchor="end">${esc(t('common.min'))}</text>
      <line class="c-cross" x1="0" x2="0" y1="${top}" y2="${top + ph}" visibility="hidden"></line>
      <circle class="c-dot" r="4" cx="0" cy="0" visibility="hidden"></circle>
      <rect class="c-hit" x="${left}" y="${top}" width="${pw}" height="${ph}"></rect>
    </svg>`;
  return { svg, geometry: g };
}

/** Crosshair + read-out on hover/drag for the workout chart. */
export function bindWorkoutChart(container, rec, geometry, phases) {
  const svg = container.querySelector('svg');
  const tip = container.querySelector('.c-tip');
  if (!svg || !tip) return;
  const cross = svg.querySelector('.c-cross');
  const dot = svg.querySelector('.c-dot');
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * geometry.width;
    const sec = geometry.secAt(px);
    const bpm = rec.samples[sec];
    const x = geometry.xOf(sec);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    cross.setAttribute('visibility', 'visible');
    if (bpm != null) {
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', geometry.yOf(bpm));
      dot.setAttribute('visibility', 'visible');
    } else dot.setAttribute('visibility', 'hidden');
    const ph = phases.find((p) => sec >= p.startSec && sec < p.endSec) || phases[phases.length - 1];
    const name = ph ? t('phase.' + ph.type) + (ph.index ? ' ' + ph.index : '') : '';
    tip.textContent = `${fmtClock(sec)} · ${bpm == null ? '--' : bpm + ' bpm'} · ${name}`;
    tip.hidden = false;
  };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
}

/** Small weekly trend chart (one series, one axis). */
export function trendChartSvg(points, { decimals = 0, unit = '', label = '' } = {}) {
  const g = trendChartGeometry(points);
  if (g.empty) return `<p class="muted chart-empty">${esc(t('prog.noData'))}</p>`;
  const { left, top, width: pw, height: ph } = g.plot;
  const grid = g.yTicks
    .map(
      (tk) =>
        `<line class="c-grid" x1="${left}" x2="${left + pw}" y1="${tk.y}" y2="${tk.y}"></line>` +
        `<text class="c-ylabel" x="${left - 5}" y="${tk.y + 3.5}">${esc(fmtNum(tk.v, decimals))}</text>`,
    )
    .join('');
  const xl = g.xTicks
    .map((tk) => `<text class="c-xlabel" x="${tk.x}" y="${g.height - 5}">${esc(shortWeek(tk.week))}</text>`)
    .join('');
  const dots = g.dots
    .map(
      (d) =>
        `<g class="c-pt" tabindex="0" data-tip="${esc(`${t('prog.weekOf', { date: shortWeek(d.week) })}: ${fmtNum(d.v, decimals)}${unit ? ' ' + unit : ''}`)}">` +
        `<circle class="c-hitdot" cx="${d.x}" cy="${d.y}" r="12"></circle>` +
        `<circle class="c-pdot" cx="${d.x}" cy="${d.y}" r="4"></circle></g>`,
    )
    .join('');
  return `
    <svg class="chart chart-trend" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="${esc(label)}">
      ${grid}${xl}
      <path class="c-line" d="${g.d}"></path>
      ${dots}
    </svg>`;
}

/** Show a dot's data-tip in the container's .c-tip on hover, focus or tap. */
export function bindTrendTips(root) {
  const update = (e) => {
    const pt = e.target.closest && e.target.closest('.c-pt');
    const box = e.target.closest && e.target.closest('.chart-box');
    if (!box) return;
    const tip = box.querySelector('.c-tip');
    if (!tip) return;
    for (const p of box.querySelectorAll('.c-pt.is-on')) p.classList.remove('is-on');
    if (pt) {
      pt.classList.add('is-on');
      tip.textContent = pt.dataset.tip;
      tip.hidden = false;
    } else tip.hidden = true;
  };
  listen(root, 'trend', 'pointerover', update);
  listen(root, 'trend', 'pointerdown', update);
  listen(root, 'trend', 'focusin', update);
}

function shortWeek(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(t('locale'), { day: 'numeric', month: 'numeric' });
}
