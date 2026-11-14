import { t } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc } from './dom.js';
import { buildPlan } from '../workout.js';
import { zoneBpm } from '../hrmath.js';
import { strapById } from '../straps.js';

/**
 * @param {HTMLElement} root
 * @param {object} app  { settings, strap, btSupported, storage, liveBpm }
 * @param {object} on   { start(), nav(name), setDev(key, value), setSource(src), connect(), disconnect() }
 */
export function renderHome(root, app, on) {
  const s = app.settings;
  const st = s.structure;
  const plan = buildPlan(s);
  const min = (sec) => fmtNum(sec / 60, sec % 60 ? 1 : 0);
  const tm = (p) => `${fmtNum(s.treadmill[p].speed, 1)} km/h · ${fmtNum(s.treadmill[p].incline, 1)} %`;
  const zone = (p) => {
    const [lo, hi] = zoneBpm(s.zones[p], s.maxHr);
    return `${lo}–${hi}`;
  };
  const rows = ['warmup', 'interval', 'recovery', 'cooldown']
    .map((p) => `<tr><th>${esc(t('phase.' + p))}</th><td>${esc(zone(p))}</td><td>${esc(tm(p))}</td></tr>`)
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

      <nav class="nav-row">
        <button class="btn" data-action="nav" data-to="history">${esc(t('nav.history'))}</button>
        <button class="btn" data-action="nav" data-to="progress">${esc(t('nav.progress'))}</button>
        <button class="btn" data-action="nav" data-to="settings">${esc(t('nav.settings'))}</button>
      </nav>

      ${app.storage && app.storage.backend === 'memory' ? `<p class="note">${esc(t('home.noStorage'))}</p>` : ''}

      <section class="card" id="strap-card">${strapCardHtml(app)}</section>

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
          <thead><tr><th></th><th>${esc(t('home.zonesBpm'))}</th><th>${esc(t('home.targets'))}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="btn btn-link" data-action="nav" data-to="settings">${esc(t('home.editPlan'))}</button>
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

      <div class="sticky-start">
        <button class="btn btn-primary btn-xl btn-block" data-action="start">${esc(t('home.start'))}</button>
      </div>
    </div>`;

  root.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'start') on.start();
    else if (a === 'nav') on.nav(b.dataset.to);
    else if (a === 'source') on.setSource(b.dataset.value);
    else if (a === 'connect') on.connect();
    else if (a === 'disconnect') on.disconnect();
    else if (a === 'dev') {
      const v = b.dataset.key === 'timeScale' ? Number(b.dataset.value) : b.dataset.value;
      on.setDev(b.dataset.key, v);
      for (const x of b.parentElement.children) x.classList.toggle('is-on', x === b);
    }
  };
}

/** Heart-rate source: strap status and controls, or the simulator note. */
export function strapCardHtml(app) {
  const s = app.settings;
  const head = `<h2>${esc(t('home.hrSource'))}</h2>`;
  if (!app.btSupported) {
    return `${head}
      <p class="source-line"><span class="pill pill-sim">${esc(t('wo.sim'))}</span> ${esc(t('home.simulator'))}</p>
      <p class="note">${esc(t('home.noBluetooth'))}</p>`;
  }

  const useSim = s.hrSource === 'sim';
  const switcher = `
    <div class="seg seg-wide" role="group">
      <button class="seg-btn${useSim ? '' : ' is-on'}" data-action="source" data-value="strap">${esc(t('home.strap'))}</button>
      <button class="seg-btn${useSim ? ' is-on' : ''}" data-action="source" data-value="sim">${esc(t('home.simulator'))}</button>
    </div>`;
  if (useSim) return `${head}${switcher}<p class="muted small">${esc(t('home.simNote'))}</p>`;

  const strap = app.strap;
  const model = strapById(s.strapModel);
  const state = strap ? strap.state : 'idle';
  let status;
  let button;
  if (state === 'connected') {
    const bits = [esc(strap.name || model.name || t('strap.other'))];
    if (strap.battery != null) bits.push(`🔋 ${strap.battery} %`);
    status = `<p class="strap-status"><span class="dot dot-ok"></span><span>${bits.join(' · ')}</span>
      <span class="strap-live"><b data-live-bpm>${app.liveBpm ?? '--'}</b> bpm</span></p>`;
    if (strap.contact === false) status += `<p class="note">${esc(t('strap.noContact'))}</p>`;
    button = `<button class="btn btn-block" data-action="disconnect">${esc(t('home.disconnect'))}</button>`;
  } else if (state === 'connecting' || state === 'reconnecting') {
    status = `<p class="strap-status"><span class="dot dot-wait"></span>${esc(t(state === 'connecting' ? 'strap.connecting' : 'strap.reconnecting'))}</p>`;
    button = `<button class="btn btn-block" data-action="disconnect">${esc(t('wo.cancel'))}</button>`;
  } else {
    status = `<p class="strap-status"><span class="dot"></span>${esc(t('strap.notConnected'))}</p>`;
    button = `<button class="btn btn-primary btn-block" data-action="connect">${esc(t('home.connect'))}</button>`;
  }
  const tips = model.tips.map((k) => `<li>${esc(t(k))}</li>`).join('');
  const oneConn = model.connections > 1 ? t('strap.twoConnections') : t('strap.oneConnection');
  return `${head}${switcher}${status}${button}
    <details class="tips">
      <summary>${esc(t('strap.tipsFor', { name: model.name || t('strap.other') }))}</summary>
      <ul>${tips}<li>${esc(oneConn)}</li></ul>
    </details>`;
}
