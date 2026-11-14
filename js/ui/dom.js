// Small DOM helpers shared by the UI modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * addEventListener that replaces the listener previously registered under `key`, so
 * screens can re-render into the same root without stacking handlers.
 */
export function listen(root, key, type, fn) {
  const store = (root.__fjordListeners = root.__fjordListeners || {});
  const id = key + ':' + type;
  if (store[id]) root.removeEventListener(type, store[id]);
  store[id] = fn;
  root.addEventListener(type, fn);
}

/** Set textContent only when it changed (avoids layout work on every tick). */
export function setText(el, text) {
  const s = String(text);
  if (el && el.textContent !== s) el.textContent = s;
}

/** Map of [data-f] name → element inside root. */
export function fields(root) {
  const out = {};
  for (const el of $$('[data-f]', root)) out[el.dataset.f] = el;
  return out;
}

const SCREENS = ['home', 'ready', 'workout', 'summary', 'history', 'detail', 'progress', 'settings', 'onboarding'];

export function showScreen(name) {
  for (const id of SCREENS) {
    const el = document.getElementById('screen-' + id);
    if (el) el.hidden = id !== name;
  }
  document.body.classList.toggle('in-workout', name === 'workout' || name === 'ready');
  window.scrollTo(0, 0);
}

let toastTimer = null;
export function toast(text, ms = 4000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}
