// Small pieces shared by the summary, history, detail and progress screens.

import { t } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc, listen } from './dom.js';

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
  const next = `${fmtNum(r.next.speed, 1)} km/h · ${fmtNum(r.next.incline, 1)} %`;
  const pct = r.pct == null ? '' : fmtNum(r.pct, 0);
  if (r.action === 'harder') return t('rec.harder', { pct, next });
  if (r.action === 'easier') return t('rec.easier', { pct, next });
  if (r.action === 'keep') return t('rec.keep', { pct, next });
  return t('rec.none');
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
