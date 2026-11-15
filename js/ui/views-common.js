// Small pieces shared by the summary, history, detail and progress screens.

import { t } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc, listen } from './dom.js';
import { hasMaxHr, maxHrTestPending } from '../settings.js';
import { activityById } from '../activities.js';
import { vo2Rating, VO2_LEVELS } from '../estimate.js';

export function maxHrText(s) {
  if (!hasMaxHr(s)) return t(maxHrTestPending(s) ? 'hr.testPendingShort' : 'hr.unsetShort');
  const key = s.maxHrSource === 'age' ? 'hr.estimated' : s.maxHrSource === 'test' ? 'hr.tested' : 'hr.known';
  return t(key, { bpm: s.maxHr });
}

export const activityName = (id) => t('act.' + activityById(id).id);

/** One control value with its unit, e.g. "10,5 km/h" or "level 8". */
export function fmtControl(c, v) {
  if (v == null || !Number.isFinite(v)) return '--';
  if (!c.unitKey) return t('ctl.levelValue', { n: fmtNum(v, c.dec) });
  return `${fmtNum(v, c.dec)} ${t(c.unitKey)}`;
}

/** All planned values of an activity, e.g. "10,5 km/h · 2,0 %"; '' outdoors. */
export function fmtTargets(activityId, values) {
  return activityById(activityId).controls.map((c) => fmtControl(c, values && values[c.key])).join(' · ');
}

export const tile = (label, value, sub = '') =>
  `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${
    sub ? `<div class="tile-sub">${esc(sub)}</div>` : ''
  }</div>`;

export const dash = (v, suffix = '') => (v == null ? '--' : `${v}${suffix}`);

export function fmtDate(iso, opts = {}) {
  return new Date(iso).toLocaleDateString(t('locale'), { weekday: 'short', day: 'numeric', month: 'short', ...opts });
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
}

export function backHeader(title, action = 'back') {
  return `<header class="page-head">
      <button class="btn btn-back" data-action="${action}" aria-label="${esc(t('nav.back'))}">‹ ${esc(t('nav.back'))}</button>
      <h1>${esc(title)}</h1>
    </header>`;
}

/** Sentence describing a recommendation from stats.recommendNext(). */
export function recommendationText(r) {
  const pct = r.pct == null ? '' : fmtNum(r.pct, 0);
  if (r.action === 'none') return t(r.reason === 'maxHr' ? 'rec.needMaxHr' : r.reason === 'test' ? 'rec.test' : 'rec.none');
  // Outdoors there is no machine setting to plan, only the effort.
  if (r.applicable === false) return t('rec.' + r.action + 'Free', { pct });
  const next = fmtTargets(r.activity || 'treadmill', r.next);
  return t('rec.' + r.action, { pct, next });
}

export function rpeButtons(value) {
  return `<div class="rpe" role="radiogroup" aria-label="${esc(t('sum.rpe'))}">${Array.from({ length: 10 }, (_, i) => i + 1)
    .map(
      (n) =>
        `<button type="button" role="radio" aria-checked="${n === value}" class="rpe-btn${n === value ? ' is-on' : ''}" data-rpe="${n}">${n}</button>`,
    )
    .join('')}</div>
    <p class="muted small rpe-scale"><span>${esc(t('sum.rpeEasy'))}</span><span>${esc(t('sum.rpeMax'))}</span></p>`;
}

/** Toggle handling for rpeButtons(); returns the getter. */
export function bindRpe(root, initial, onChange) {
  let value = initial ?? null;
  listen(root, 'rpe', 'click', (e) => {
    const b = e.target.closest('[data-rpe]');
    if (!b) return;
    const n = Number(b.dataset.rpe);
    value = value === n ? null : n;
    for (const x of root.querySelectorAll('[data-rpe]')) {
      const on = Number(x.dataset.rpe) === value;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-checked', String(on));
    }
    if (onChange) onChange(value);
  });
  return () => value;
}

/**
 * VO2max value with its Cooper Institute rating on a five-segment scale.
 * est: { value, n?, reason? } (estimate.currentVo2max or one workout's value);
 * s: current settings (age, sex, restHr); source: line under the value, if any.
 */
export function vo2Html(est, s, source = '') {
  if (!est || est.value == null) {
    const key = est && est.reason === 'weight' ? 'vo2.needWeight' : est && est.reason === 'outdoor' ? 'vo2.outdoor' : 'vo2.notYet';
    return `<p class="muted small vo2-empty">${esc(t(key, { need: 2 }))}</p>`;
  }
  const r = vo2Rating(est.value, s.age, s.sex);
  const level = r ? `<span class="vo2-level lv-${r.level}">${esc(t('vo2.level.' + r.level))}</span>` : '';
  const scale = r
    ? `<div class="vo2-scale" role="img" aria-label="${esc(t('vo2.level.' + r.level))}">
        ${VO2_LEVELS.map((l) => `<i class="lv-${l}"></i>`).join('')}
        <b style="left:${(r.position * 100).toFixed(1)}%"></b>
      </div>
      <div class="vo2-ticks">${VO2_LEVELS.map((l) => `<span>${esc(t('vo2.level.' + l))}</span>`).join('')}</div>
      <p class="muted small">${esc(t('vo2.compare', { who: t(s.sex === 'female' ? 'vo2.women' : 'vo2.men'), band: r.band }))}</p>`
    : `<p class="muted small">${esc(t('vo2.needProfile'))}</p>`;
  return `<div class="vo2">
      <div class="vo2-main">
        <span class="vo2-value num">${esc(fmtNum(est.value, 1))}</span>
        <span class="vo2-unit">ml/kg/min</span>
        ${level}
      </div>
      ${scale}
      ${source ? `<p class="muted small">${esc(source)}</p>` : ''}
      ${Number.isFinite(s.restHr) && s.restHr > 0 ? '' : `<p class="muted small">${esc(t('vo2.restHint'))}</p>`}
    </div>`;
}
