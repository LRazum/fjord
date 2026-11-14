import { t, LANGUAGES, getLang } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc } from './dom.js';
import { buildPlan } from '../workout.js';

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

/**
 * @param {HTMLElement} root
 * @param {object} app  { settings }
 * @param {object} on   { start(), setDev(key, value), setLang(lang) }
 */
export function renderHome(root, app, on) {
  const s = app.settings;
  const st = s.structure;
  const plan = buildPlan(s);
  const min = (sec) => fmtNum(sec / 60, sec % 60 ? 1 : 0);
  const tm = (p) => `${fmtNum(s.treadmill[p].speed, 1)} km/h · ${fmtNum(s.treadmill[p].incline, 1)} %`;
  const zone = (p) => `${s.zones[p][0]}–${s.zones[p][1]} %`;
  const rows = ['warmup', 'interval', 'recovery', 'cooldown']
    .map(
      (p) => `<tr><th>${esc(t('phase.' + p))}</th><td>${esc(zone(p))}</td><td>${esc(tm(p))}</td></tr>`,
    )
    .join('');

  const seg = (key, value, options) =>
    `<div class="seg" role="group">${options
      .map(
        ([v, label]) =>
          `<button class="seg-btn${String(v) === String(value) ? ' is-on' : ''}" data-action="dev" data-key="${key}" data-value="${v}">${esc(label)}</button>`,
      )
      .join('')}</div>`;

  root.innerHTML = `
    <div class="page">
      <header class="brand">
        <h1>Fjord</h1>
        <p class="muted">${esc(t('app.tagline'))}</p>
      </header>

      <section class="card">
        <h2>${esc(t('home.plan'))}</h2>
        <p>${esc(
          t('home.planLine', {
            w: min(st.warmupSec),
            n: plan.intervals,
            i: min(st.intervalSec),
            r: min(st.recoverySec),
            c: min(st.cooldownSec),
          }),
        )}</p>
        <p class="muted">${esc(t('home.total', { min: Math.round(plan.totalSec / 60) }))} · ${esc(t('home.maxHr'))} ${s.maxHr} bpm</p>
        <table class="plan-table">
          <thead><tr><th></th><th>${esc(t('home.zones'))}</th><th>${esc(t('home.targets'))}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>

      <section class="card">
        <h2>${esc(t('home.hrSource'))}</h2>
        <p class="source-line"><span class="pill pill-sim">${esc(t('wo.sim'))}</span> ${esc(t('home.simulator'))}</p>
        ${bluetoothAvailable() ? '' : `<p class="note">${esc(t('home.noBluetooth'))}</p>`}
      </section>

      <details class="card dev">
        <summary>${esc(t('dev.title'))}</summary>
        <div class="field">
          <span class="field-label">${esc(t('dev.timeScale'))}</span>
          ${seg('timeScale', s.dev.timeScale, [[1, '1×'], [10, '10×']])}
        </div>
        <div class="field">
          <span class="field-label">${esc(t('dev.simProfile'))}</span>
          ${seg('simProfile', s.dev.simProfile, [
            ['random', t('dev.sim.random')],
            ['matched', t('dev.sim.matched')],
            ['easy', t('dev.sim.easy')],
            ['hard', t('dev.sim.hard')],
          ])}
        </div>
      </details>

      <div class="lang-switch">
        ${LANGUAGES.map(
          (l) =>
            `<button class="seg-btn${l === getLang() ? ' is-on' : ''}" data-action="lang" data-value="${l}">${l.toUpperCase()}</button>`,
        ).join('')}
      </div>

      <div class="sticky-start">
        <button class="btn btn-primary btn-xl btn-block" data-action="start">${esc(t('home.start'))}</button>
      </div>
    </div>`;

  root.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'start') on.start();
    else if (a === 'dev') {
      const v = b.dataset.key === 'timeScale' ? Number(b.dataset.value) : b.dataset.value;
      on.setDev(b.dataset.key, v);
      for (const x of b.parentElement.children) x.classList.toggle('is-on', x === b);
    } else if (a === 'lang') on.setLang(b.dataset.value);
  };
}
