import { t } from '../i18n.js';
import { fmtClock, fmtNum, phaseName } from '../format.js';
import { esc, fields, setText } from './dom.js';
import { zoneBpm } from '../hrmath.js';
import { liveChartGeometry } from '../charts.js';
import { maxHrText } from './views-common.js';

const HOLD_DELAY_MS = 450;
const HOLD_REPEAT_MS = 160;
const SKIP_ARM_MS = 2500;

/** The full-screen workout display. Reads session snapshots, sends user actions back. */
export class WorkoutView {
  /**
   * @param {HTMLElement} root
   * @param {import('../session.js').WorkoutSession} session
   * @param {{ requestEnd: () => void, reconnect?: () => void }} on
   * @param {import('../ble.js').StrapConnection|null} strap  null for the simulator
   */
  constructor(root, session, on, strap = null) {
    this.root = root;
    this.session = session;
    this.on = on;
    this.strap = strap;
    this._unsubs = [];
    this._holdTimer = null;
    this._skipTimer = null;
    this._cue = '';
    this._chartKey = '';
    this._chartBands = '';
    this._render();
    this._bind();
    this._unsubs.push(session.on('tick', (s) => this.update(s)));
    if (strap) {
      const refresh = () => this._updateStrap();
      this._unsubs.push(strap.on('state', refresh), strap.on('hr', refresh));
      this._updateStrap();
    }
    this.update(session.snapshot());
  }

  _render() {
    const s = this.session.settings;
    const n = this.session.plan.intervals;
    const dots = Array.from({ length: n }, (_, i) => `<i data-dot="${i + 1}"></i>`).join('');
    const tmBlock = (kind, unitKey, step) => `
      <div class="tm" data-kind="${kind}">
        <div class="tm-head" data-f="${kind}Label">${esc(t(kind === 'speed' ? 'wo.targetSpeed' : 'wo.targetIncline'))}</div>
        <div class="tm-target"><span data-f="${kind}Target">--</span><small>${esc(t(unitKey))}</small></div>
        <div class="tm-set"><span class="tm-set-label">${esc(t('wo.set'))}</span> <span data-f="${kind}Set">--</span></div>
        <div class="tm-row">
          <button class="tm-btn" data-adjust="${kind}" data-delta="${-step}" aria-label="${esc(t('wo.' + kind))} −">−</button>
          <button class="tm-btn" data-adjust="${kind}" data-delta="${step}" aria-label="${esc(t('wo.' + kind))} +">+</button>
        </div>
      </div>`;

    this.root.innerHTML = `
      <div class="wo-progress"><div data-f="progress"></div></div>
      <div class="wo-alert" data-f="alert" role="alert" hidden>
        <span class="wo-alert-text" data-f="alertText"></span>
        <button class="btn wo-alert-btn" data-action="reconnect" data-f="alertBtn"></button>
      </div>
      <header class="wo-top">
        <div class="wo-phase">
          <span class="wo-phase-name" data-f="phaseName"></span>
          <span class="wo-dots" data-f="dots">${dots}</span>
          <span class="wo-hrmax">${esc(maxHrText(s))}</span>
        </div>
        <div class="wo-meta">
          <span class="pill pill-sim" data-f="source" hidden>${esc(t('wo.sim'))}</span>
          <span class="wo-battery" data-f="battery"></span>
          <span class="wo-total"><small>${esc(t('wo.total'))}</small> <span data-f="total">0:00</span></span>
        </div>
      </header>

      <main class="wo-main">
        <div class="wo-countdown"><span data-f="countdown">0:00</span></div>
        <div class="wo-bpm-wrap">
          <div class="wo-bpm" data-f="bpm">--</div>
          <div class="wo-bpm-unit">${esc(t('wo.bpm'))} <span class="wo-trend" data-f="trend"></span></div>
        </div>
        <div class="wo-sub">
          <span class="wo-pct" data-f="pct"></span>
          <span class="wo-zone"><span data-f="zoneText"></span> <span class="wo-zone-pct" data-f="zonePct"></span></span>
        </div>
        <div class="wo-cue" data-f="cue" aria-live="polite"></div>
        <svg class="wo-chart" viewBox="0 0 180 60" preserveAspectRatio="none" aria-hidden="true">
          <g data-f="chartBands"></g>
          <path data-f="chartLine" fill="none" vector-effect="non-scaling-stroke"></path>
        </svg>
        <div class="wo-paused" data-f="paused" hidden>${esc(t('wo.paused'))}</div>
      </main>

      <section class="wo-coach" data-f="coach" hidden>
        <div class="wo-coach-copy" aria-live="polite">
          <span data-f="coachReason"></span>
          <strong data-f="coachChange"></strong>
        </div>
        <div class="wo-coach-actions">
          <button class="btn btn-primary" data-action="coach-accept" data-f="coachAccept">${esc(t('coach.accept'))}</button>
          <button class="btn" data-action="coach-skip" data-f="coachSkip">${esc(t('coach.skip'))}</button>
        </div>
      </section>

      <section class="wo-tread">
        ${tmBlock('speed', 'wo.kmh', s.speedStep)}
        ${tmBlock('incline', 'wo.pct', s.inclineStep)}
      </section>

      <footer class="wo-controls">
        <button class="btn wo-btn" data-action="pause" data-f="pauseBtn">${esc(t('wo.pause'))}</button>
        <button class="btn wo-btn" data-action="skip" data-f="skipBtn">${esc(t('wo.skip'))}</button>
        <button class="btn wo-btn btn-danger" data-action="end">${esc(t('wo.end'))}</button>
      </footer>`;
    this.f = fields(this.root);
  }

  _bind() {
    const root = this.root;

    // +/- buttons: act on press, repeat while held.
    const stopHold = () => {
      clearTimeout(this._holdTimer);
      clearInterval(this._holdTimer);
      this._holdTimer = null;
    };
    root.onpointerdown = (e) => {
      const b = e.target.closest('[data-adjust]');
      if (!b) return;
      e.preventDefault();
      const fire = () => this.session.adjust(b.dataset.adjust, Number(b.dataset.delta));
      fire();
      stopHold();
      this._holdTimer = setTimeout(() => {
        this._holdTimer = setInterval(fire, HOLD_REPEAT_MS);
      }, HOLD_DELAY_MS);
    };
    root.onpointerup = stopHold;
    root.onpointercancel = stopHold;
    root.onpointerout = (e) => {
      if (e.target.closest('[data-adjust]')) stopHold();
    };
    root.oncontextmenu = (e) => {
      if (e.target.closest('[data-adjust]')) e.preventDefault();
    };

    root.onclick = (e) => {
      // Keyboard activation of +/- (pointer presses are handled above).
      const adj = e.target.closest('[data-adjust]');
      if (adj) {
        if (e.detail === 0) this.session.adjust(adj.dataset.adjust, Number(adj.dataset.delta));
        return;
      }
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const a = b.dataset.action;
      if (a === 'pause') this.session.togglePause();
      else if (a === 'skip') this._skip(b);
      else if (a === 'end') this.on.requestEnd();
      else if (a === 'reconnect' && this.on.reconnect) this.on.reconnect();
      else if (a === 'coach-accept') this.session.confirmSuggestion(Number(b.dataset.id));
      else if (a === 'coach-skip') this.session.dismissSuggestion(Number(b.dataset.id));
    };
  }

  // Skipping needs a second tap within a short window so a stray touch while running
  // does not throw away an interval.
  _skip(btn) {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      clearTimeout(this._skipTimer);
      setText(btn, t('wo.skip'));
      this.session.skip();
      return;
    }
    btn.dataset.armed = '1';
    setText(btn, t('wo.skipConfirm'));
    clearTimeout(this._skipTimer);
    this._skipTimer = setTimeout(() => {
      delete btn.dataset.armed;
      setText(btn, t('wo.skip'));
    }, SKIP_ARM_MS);
  }

  // Strap problems are shown as a banner over the top of the screen; the timer keeps going.
  _updateStrap() {
    const st = this.strap;
    const f = this.f;
    let text = '';
    let btn = '';
    if (st.state === 'reconnecting') {
      text = t('wo.strapLost');
      btn = t('wo.reconnect');
    } else if (st.state === 'connecting') {
      text = t('strap.connecting');
    } else if (st.state === 'idle') {
      text = t('wo.strapNone');
      btn = t('home.connect');
    } else if (st.contact === false) {
      text = t('strap.noContact');
    }
    f.alert.hidden = !text;
    setText(f.alertText, text);
    f.alertBtn.hidden = !btn;
    setText(f.alertBtn, btn);
    this.root.classList.toggle('strap-lost', st.state === 'reconnecting' || st.state === 'idle');
  }

  /** Show a coaching line (unused for now). */
  setCue(text, kind = '') {
    this._cue = text || '';
    this.f.cue.dataset.kind = this._cue ? kind : '';
    if (this._cue) setText(this.f.cue, this._cue);
  }

  update(s) {
    const f = this.f;
    const phase = s.phase;
    if (!phase) return;

    setText(f.phaseName, phaseName(phase, s.intervals));
    setText(f.total, fmtClock(s.elapsedSec));
    setText(f.countdown, fmtClock(s.phaseRemainingSec, { ceil: true }));
    setText(f.bpm, s.bpm == null ? '--' : s.bpm);
    setText(f.pct, s.pct == null ? '' : t('wo.pctMax', { pct: Math.round(s.pct) }));
    const [bpmLo, bpmHi] = zoneBpm(phase.zone, this.session.settings.maxHr);
    setText(f.zoneText, t('wo.zone', { lo: bpmLo, hi: bpmHi }));
    setText(f.zonePct, t('wo.zonePct', { lo: phase.zone[0], hi: phase.zone[1] }));
    this._updateChart(s);
    this._updateSuggestion(s.suggestion);
    // Zone state in words too, so it does not depend on telling the colours apart.
    // A coaching cue (milestone 3) takes over this line while it is active.
    setText(f.cue, this._cue || (s.zone ? t('wo.zone.' + s.zone) : ''));
    setText(f.trend, s.trend == null ? '' : s.trend > 4 ? '▲' : s.trend < -4 ? '▼' : '');
    f.progress.style.width = `${Math.min(100, (s.elapsedSec / s.totalSec) * 100).toFixed(2)}%`;

    f.source.hidden = s.source !== 'sim';
    setText(f.battery, s.battery == null ? '' : `🔋 ${s.battery} %`);

    for (const kind of ['speed', 'incline']) {
      setText(f[kind + 'Target'], fmtNum(s.target[kind], 1));
      setText(f[kind + 'Set'], fmtNum(s.actual[kind], 1));
      f[kind + 'Set'].parentElement.classList.toggle('differs', s.actual[kind] !== s.target[kind]);
    }

    // Interval dots: done / current / upcoming.
    for (const dot of f.dots.children) {
      const i = Number(dot.dataset.dot);
      const cur = phase.type === 'interval' && phase.index === i;
      dot.className = cur ? 'cur' : i <= s.intervalNumber && !cur ? 'done' : '';
    }

    const paused = s.state === 'paused';
    f.paused.hidden = !paused;
    setText(f.pauseBtn, paused ? t('wo.resume') : t('wo.pause'));
    f.pauseBtn.classList.toggle('btn-primary', paused);

    const root = this.root;
    const zone = s.zone || 'none';
    if (root.dataset.zone !== zone) root.dataset.zone = zone;
    if (root.dataset.phase !== phase.type) root.dataset.phase = phase.type;
    root.classList.toggle('is-paused', paused);
    root.classList.toggle('last-seconds', s.state === 'running' && s.phaseRemainingSec <= 3.05);
  }

  _updateSuggestion(p) {
    const f = this.f;
    f.coach.hidden = !p;
    this.root.classList.toggle('has-suggestion', !!p);
    for (const kind of ['speed', 'incline']) {
      setText(f[kind + 'Label'], t(p ? 'wo.' + kind : kind === 'speed' ? 'wo.targetSpeed' : 'wo.targetIncline'));
    }
    if (!p) return;
    setText(f.coachReason, t('coach.' + p.reason));
    setText(f.coachChange, t('coach.change', { kind: t('wo.' + p.kind),
      from: fmtNum(p.from, 1), to: fmtNum(p.to, 1), unit: t(p.kind === 'speed' ? 'wo.kmh' : 'wo.pct') }));
    f.coachAccept.dataset.id = p.id;
    f.coachSkip.dataset.id = p.id;
  }

  // Last three minutes of heart rate against the zone; redrawn once per workout second.
  _updateChart(s) {
    const sec = Math.floor(s.elapsedSec);
    const key = `${sec}:${s.phaseIndex}`;
    if (key === this._chartKey) return;
    this._chartKey = key;
    const g = liveChartGeometry({
      samples: this.session.samples,
      endSec: sec,
      phases: this.session.phaseSpans(),
      maxHr: this.session.settings.maxHr,
    });
    this.f.chartLine.setAttribute('d', g.d);
    const bands = g.bands.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"></rect>`).join('');
    if (bands !== this._chartBands) {
      this._chartBands = bands;
      this.f.chartBands.innerHTML = bands;
    }
  }

  destroy() {
    this._unsubs.forEach((u) => u());
    clearTimeout(this._skipTimer);
    clearTimeout(this._holdTimer);
    clearInterval(this._holdTimer);
    const r = this.root;
    r.onpointerdown = r.onpointerup = r.onpointercancel = r.onpointerout = r.oncontextmenu = r.onclick = null;
    delete r.dataset.zone;
    delete r.dataset.phase;
    r.classList.remove('is-paused', 'last-seconds', 'has-suggestion');
    this.root.innerHTML = '';
  }
}
