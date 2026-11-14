// Form helpers shared by Settings and onboarding: steppers bound to a settings path.

import { t } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc, listen } from './dom.js';

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

const decimals = (step) => (String(step).split('.')[1] || '').length;

/**
 * A number with big −/+ buttons.
 * kind: 'num' (stored as is) or 'min' (stored in seconds, shown in minutes).
 */
export function stepper({ label, path, value, step = 1, min = 0, max = 999, unit = '', kind = 'num', hint = '', nullable = false }) {
  const shown = kind === 'min' ? value / 60 : value;
  const d = decimals(step);
  return `
    <div class="field">
      <label class="field-label" for="f-${esc(path)}">${esc(label)}</label>
      <div class="stepper" data-path="${esc(path)}" data-kind="${kind}" data-step="${step}" data-min="${min}" data-max="${max}" data-dec="${d}" data-nullable="${nullable}">
        <button type="button" class="stepper-btn" data-delta="-1" aria-label="${esc(label)} −">−</button>
        <span class="stepper-value">
          <input id="f-${esc(path)}" type="text" inputmode="decimal" autocomplete="off" value="${esc(shown == null ? '' : fmtNum(shown, d))}">
          ${unit ? `<span class="stepper-unit">${esc(unit)}</span>` : ''}
        </span>
        <button type="button" class="stepper-btn" data-delta="1" aria-label="${esc(label)} +">+</button>
      </div>
      ${hint ? `<p class="field-hint">${esc(hint)}</p>` : ''}
    </div>`;
}

/** Pill buttons that set `path` to one of the option values. */
export function segmented({ label, path, value, options }) {
  return `
    <div class="field">
      ${label ? `<span class="field-label">${esc(label)}</span>` : ''}
      <div class="seg" role="radiogroup" data-seg="${esc(path)}">
        ${options
          .map(
            ([v, text]) =>
              `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" class="seg-btn${String(v) === String(value) ? ' is-on' : ''}" data-value="${esc(v)}">${esc(text)}</button>`,
          )
          .join('')}
      </div>
    </div>`;
}

function parseNum(text) {
  const v = parseFloat(String(text).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/**
 * Wire steppers and segmented controls inside `root`.
 * onChange(path, value) receives stored units (seconds for 'min' fields) and
 * numbers for steppers; segmented values come back as strings unless numeric.
 */
export function bindForm(root, onChange) {
  const commit = (box, raw) => {
    const step = Number(box.dataset.step);
    const min = Number(box.dataset.min);
    const max = Number(box.dataset.max);
    const dec = Number(box.dataset.dec);
    const input = box.querySelector('input');
    let v = raw;
    if (v == null) {
      if (box.dataset.nullable === 'true' && !input.value.trim()) {
        input.classList.remove('invalid');
        onChange(box.dataset.path, null);
        return;
      }
      input.classList.add('invalid');
      return;
    }
    input.classList.remove('invalid');
    v = Math.min(max, Math.max(min, Math.round(v / step) * step));
    v = Number(v.toFixed(dec));
    input.value = fmtNum(v, dec);
    onChange(box.dataset.path, box.dataset.kind === 'min' ? Math.round(v * 60) : v);
  };

  listen(root, 'form', 'click', (e) => {
    const b = e.target.closest('.stepper-btn');
    if (b) {
      const box = b.closest('.stepper');
      const cur = parseNum(box.querySelector('input').value) ?? Number(box.dataset.min);
      commit(box, cur + Number(b.dataset.delta) * Number(box.dataset.step));
      return;
    }
    const s = e.target.closest('[data-seg] .seg-btn');
    if (s) {
      const group = s.closest('[data-seg]');
      for (const x of group.children) {
        x.classList.toggle('is-on', x === s);
        x.setAttribute('aria-checked', String(x === s));
      }
      const raw = s.dataset.value;
      onChange(group.dataset.seg, /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw);
    }
  });
  listen(root, 'form', 'change', (e) => {
    const box = e.target.closest('.stepper');
    if (box) commit(box, parseNum(e.target.value));
  });
}

export const minutesLabel = () => t('common.min');
