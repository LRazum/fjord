import { t } from '../i18n.js';
import { fmtNum, phaseName } from '../format.js';
import { esc, fields, setText } from './dom.js';

/** Live HR check before any workout time or samples are recorded. */
export class ReadyView {
  constructor(root, ready, plan, strap, on) {
    this.root = root;
    this.ready = ready;
    this.strap = strap;
    const phase = plan.phases[0];
    root.innerHTML = `
      <header class="ready-top">
        <h1>${esc(t('ready.title'))}</h1>
        ${ready.sim ? `<span class="pill pill-sim">${esc(t('wo.sim'))}</span>` : ''}
      </header>
      <div class="ready-status">
        <div class="ready-source">
          <span class="ready-name" data-f="name"></span>
          <span class="ready-battery" data-f="battery"></span>
        </div>
        <div class="ready-connection" data-f="connection"></div>
      </div>
      <main class="ready-main">
        <div class="ready-pulse">
          <div class="ready-bpm" data-f="bpm">--</div>
          <div class="wo-bpm-unit">${esc(t('wo.bpm'))}</div>
        </div>
        <div class="ready-countdown" data-f="countdownWrap" hidden>
          <div class="ready-count-label">${esc(t('ready.starting'))}</div>
          <div class="ready-count" data-f="countdown" role="timer" aria-live="assertive" aria-atomic="true"></div>
        </div>
      </main>
      <div class="ready-warning" data-f="warning" role="alert" hidden>
        <span data-f="contactWarning" hidden>${esc(t('strap.noContact'))}</span>
        <span data-f="hrWarning" hidden>${esc(t('ready.noHr'))}</span>
      </div>
      <section class="ready-setup">
        <h2>${esc(phaseName(phase, plan.intervals))}</h2>
        <div class="ready-targets">
          <div><span>${esc(t('wo.targetSpeed'))}</span><strong>${esc(fmtNum(phase.target.speed, 1))} <small>${esc(t('wo.kmh'))}</small></strong></div>
          <div><span>${esc(t('wo.targetIncline'))}</span><strong>${esc(fmtNum(phase.target.incline, 1))} <small>${esc(t('wo.pct'))}</small></strong></div>
        </div>
        <p>${esc(t('ready.instruction'))}</p>
      </section>
      <footer class="ready-controls">
        <button class="btn" data-action="cancel">${esc(t('wo.cancel'))}</button>
        <button class="btn btn-primary" data-action="start" data-f="start">${esc(t('ready.start'))}</button>
      </footer>`;
    this.f = fields(root);
    root.onclick = (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'cancel') on.cancel();
      else if (b.dataset.action === 'start') on.start();
    };
    const refresh = () => this.update(ready.snapshot());
    this._unsubs = [ready.on('tick', (s) => this.update(s))];
    if (strap) {
      this._unsubs.push(strap.on('state', refresh), strap.on('hr', refresh), strap.on('battery', refresh));
    }
    refresh();
  }

  update(s) {
    const f = this.f;
    const strap = this.strap;
    const connected = !strap || strap.state === 'connected';
    const battery = strap ? strap.battery : this.ready.sim.battery;
    setText(f.name, strap ? strap.name || t('strap.other') : t('home.simulator'));
    setText(f.battery, battery == null ? '' : t('ready.battery', { level: battery }));
    setText(f.connection, !strap ? t('ready.simStatus') : t(strap.state === 'connected' ? 'ready.connected'
      : strap.state === 'connecting' ? 'strap.connecting'
      : strap.state === 'reconnecting' ? 'strap.reconnecting' : 'strap.notConnected'));
    const missing = !connected || s.bpm == null;
    setText(f.bpm, missing ? '--' : s.bpm);
    f.contactWarning.hidden = !strap || strap.contact !== false;
    f.hrWarning.hidden = !missing;
    f.warning.hidden = f.contactWarning.hidden && f.hrWarning.hidden;
    const counting = s.state === 'counting';
    f.start.disabled = counting;
    f.countdownWrap.hidden = !counting;
    setText(f.countdown, counting ? s.remainingSec : '');
    this.root.classList.toggle('is-counting', counting);
  }

  destroy() {
    this._unsubs.forEach((off) => off());
    this.root.onclick = null;
    this.root.classList.remove('is-counting');
    this.root.innerHTML = '';
  }
}
