import { t } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc } from './dom.js';
import { buildPlan } from '../workout.js';
import { zoneBpm } from '../hrmath.js';
import { strapById, deviceFallbackKey } from '../straps.js';
import { ACTIVITIES, activityOf, phaseTargets } from '../activities.js';
import { maxHrTestPending } from '../settings.js';
import { maxHrText, fmtTargets, vo2Html } from './views-common.js';
import { MIN_WORKOUTS } from '../estimate.js';

/**
 * @param {HTMLElement} root
 * @param {object} app  { settings, strap, btSupported, storage, liveBpm }
 * @param {object} on   { start(), startTest(), nav(name), setDev(key, value), setSource(src),
 *                        setActivity(id), connect(), disconnect() }
 */
export function renderHome(root, app, on) {
  // With the automatic plan, the interval target shown is the estimate the workout will use.
  const s = app.next ? app.next.settings : app.settings;
  const estimate = app.next ? app.next.estimate : null;
  const st = s.structure;
  const plan = buildPlan(s);
  const activity = activityOf(s);
  const targets = phaseTargets(s);
  const hasControls = activity.controls.length > 0;
  const min = (sec) => fmtNum(sec / 60, sec % 60 ? 1 : 0);
  const zone = (p) => {
    const [lo, hi] = zoneBpm(s.zones[p], s.maxHr);
    return `${lo}–${hi}`;
  };
  const rows = ['warmup', 'interval', 'recovery', 'cooldown']
    .map((p) => `<tr><th>${esc(t('phase.' + p))}</th><td>${esc(zone(p))}</td>${
      hasControls ? `<td>${esc(fmtTargets(activity.id, targets[p]))}${
        p === 'interval' && estimate ? ' <span class="est-mark" aria-hidden="true">*</span>' : ''}</td>` : ''}</tr>`)
    .join('');
  let planNote = '';
  if (hasControls && s.intervalPlan === 'auto') {
    const n = app.models && app.models[activity.id] ? app.models[activity.id].n : 0;
    planNote = estimate
      ? t(estimate.sim ? 'est.fromHistorySim' : 'est.fromHistory', { n: estimate.n })
      : t('est.notYet', { n, need: MIN_WORKOUTS });
  }
  const testDue = maxHrTestPending(s);
  const activityButtons = ACTIVITIES.map(
    (a) => `<button class="act-btn${a.id === activity.id ? ' is-on' : ''}" data-action="activity" data-value="${a.id}" aria-pressed="${a.id === activity.id}">
        <span class="act-name">${esc(t('act.' + a.id))}</span>
        <span class="act-where">${esc(t(a.indoor ? 'act.indoor' : 'act.outdoor'))}</span>
      </button>`,
  ).join('');

  const seg = (key, value, options) =>
    `<div class="seg" role="group">${options
      .map(
        ([v, label]) =>
          `<button class="seg-btn${String(v) === String(value) ? ' is-on' : ''}" data-action="dev" data-key="${key}" data-value="${v}">${esc(label)}</button>`,
      )
      .join('')}</div>`;

  const intervalZone = zone('interval');
  const intervalTarget = hasControls ? fmtTargets(activity.id, targets.interval) : t('home.hrGuided');
  const stat = (label, value, sub = '') => `<div class="hero-stat">
      <span class="hero-stat-label">${esc(label)}</span>
      <span class="hero-stat-value">${value}</span>
      ${sub ? `<span class="hero-stat-sub">${esc(sub)}</span>` : ''}
    </div>`;

  root.innerHTML = `
    <div class="page home">
      <header class="home-top">
        <div class="wordmark">
          <svg class="wordmark-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 21 L11 11 L15.5 16.5 L21 8 L28 21"/><path d="M5 26 H27"/></svg>
          <span>Fjord</span>
        </div>
        <nav class="nav-pill" aria-label="${esc(t('app.tagline'))}">
          <button data-action="nav" data-to="history">${esc(t('nav.history'))}</button>
          <button data-action="nav" data-to="progress">${esc(t('nav.progress'))}</button>
          <button data-action="nav" data-to="settings">${esc(t('nav.settings'))}</button>
        </nav>
      </header>

      ${app.storage && app.storage.backend === 'memory' ? `<p class="note">${esc(t('home.noStorage'))}</p>` : ''}

      ${testDue ? `<section class="card test-card">
        <h2>${esc(t('test.title'))}</h2>
        <p>${esc(t('test.homeDue'))}</p>
        <p class="muted small">${esc(t('test.about'))}</p>
        <button class="btn btn-primary btn-block" data-action="test">${esc(t('test.start'))}</button>
      </section>` : ''}

      <section class="card hero">
        <div class="hero-eyebrow">
          <span>${esc(t('home.next'))}</span>
          <span class="hero-activity">${esc(t('act.' + activity.id))}</span>
        </div>
        <h2 class="hero-title"><span class="num">${plan.intervals}</span><span class="hero-x">×</span><span class="num">${esc(min(st.intervalSec))}</span><span class="hero-unit">${esc(t('common.min'))}</span></h2>
        <p class="hero-line">${esc(
          t('home.planLine', {
            w: min(st.warmupSec),
            n: plan.intervals,
            i: min(st.intervalSec),
            r: min(st.recoverySec),
            c: min(st.cooldownSec),
          }),
        )}</p>
        <div class="hero-stats">
          ${stat(t('home.intervalTarget'), `<span class="num">${esc(intervalTarget)}</span>${estimate ? ' <span class="est-mark" aria-hidden="true">*</span>' : ''}`)}
          ${stat(t('home.intervalZone'), `<span class="num">${esc(intervalZone)}</span> <small>bpm</small>`, maxHrText(s))}
          ${stat(t('home.totalShort'), `<span class="num">${Math.round(plan.totalSec / 60)}</span> <small>${esc(t('common.min'))}</small>`)}
        </div>
        ${planNote ? `<p class="plan-note">${estimate ? '<span class="est-mark" aria-hidden="true">*</span> ' : ''}${esc(planNote)}</p>` : ''}
        <details class="hero-phases">
          <summary>${esc(t('home.allPhases'))}</summary>
          <table class="plan-table">
            <thead><tr><th></th><th>${esc(t('home.zonesBpm'))}</th>${hasControls ? `<th>${esc(t('home.targets'))}</th>` : ''}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </details>
        <div class="btn-row-inline">
          <button class="btn btn-link" data-action="nav" data-to="settings">${esc(t('home.editPlan'))}</button>
          ${testDue ? '' : `<button class="btn btn-link" data-action="test">${esc(t('test.link'))}</button>`}
        </div>
      </section>

      ${hasControls && app.vo2 ? `<section class="card vo2-card">
        <h2>${esc(t('vo2.title'))} <span class="h2-sub">${esc(t('vo2.estimated'))}</span></h2>
        ${vo2Html(app.vo2, app.settings, app.vo2.value != null
          ? t('vo2.fromWorkouts', { n: app.vo2.n, activity: t('act.' + activity.id) }) : '')}
      </section>` : ''}

      <section class="card" id="strap-card">${strapCardHtml(app)}</section>

      <section class="card">
        <h2>${esc(t('home.activity'))}</h2>
        <div class="act-grid" role="group">${activityButtons}</div>
        <p class="muted small">${esc(t('act.help.' + activity.id))}</p>
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
    else if (a === 'test') on.startTest();
    else if (a === 'activity') on.setActivity(b.dataset.value);
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
  const model = strapById(s.strapModel);
  const isWatch = model.kind === 'watch';
  const modelName = model.name || t(deviceFallbackKey(model));
  const switcher = `
    <div class="seg seg-wide" role="group">
      <button class="seg-btn${useSim ? '' : ' is-on'}" data-action="source" data-value="strap">${esc(t(isWatch ? 'home.watch' : 'home.strap'))}</button>
      <button class="seg-btn${useSim ? ' is-on' : ''}" data-action="source" data-value="sim">${esc(t('home.simulator'))}</button>
    </div>`;
  if (useSim) return `${head}${switcher}<p class="muted small">${esc(t('home.simNote'))}</p>`;

  const strap = app.strap;
  const state = strap ? strap.state : 'idle';
  let status;
  let button;
  if (state === 'connected') {
    const bits = [esc(strap.name || modelName)];
    if (strap.battery != null) bits.push(esc(t('ready.battery', { level: strap.battery })));
    status = `<p class="strap-status"><span class="dot dot-ok"></span><span>${bits.join(' · ')}</span>
      <span class="strap-live"><b data-live-bpm>${app.liveBpm ?? '--'}</b> bpm</span></p>`;
    if (strap.contact === false) status += `<p class="note">${esc(t('strap.noContact'))}</p>`;
    button = `<button class="btn btn-block" data-action="disconnect">${esc(t('home.disconnect'))}</button>`;
  } else if (state === 'connecting' || state === 'reconnecting') {
    status = `<p class="strap-status"><span class="dot dot-wait"></span>${esc(t(state === 'connecting' ? 'strap.connecting' : 'strap.reconnecting'))}</p>`;
    button = `<button class="btn btn-block" data-action="disconnect">${esc(t('wo.cancel'))}</button>`;
  } else {
    status = `<p class="strap-status"><span class="dot"></span>${esc(t('strap.notConnected'))}</p>`;
    button = `<button class="btn btn-primary btn-block" data-action="connect">${esc(t(isWatch ? 'home.connectWatch' : 'home.connect'))}</button>`;
  }
  const tips = model.tips.map((k) => `<li>${esc(t(k))}</li>`).join('');
  const oneConn = isWatch ? t('watch.note') : model.connections > 1 ? t('strap.twoConnections') : t('strap.oneConnection');
  return `${head}${switcher}${status}${button}
    <details class="tips"${isWatch && state !== 'connected' ? ' open' : ''}>
      <summary>${esc(t('strap.tipsFor', { name: modelName }))}</summary>
      <ul>${tips}<li>${esc(oneConn)}</li></ul>
    </details>`;
}
