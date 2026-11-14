// A running workout: ties the engine, the HR source, recording and treadmill logging
// together. Uses timers but no DOM.

import { Emitter } from './emitter.js';
import { WorkoutEngine } from './workout.js';
import { smoothedHr, hrTrend, pctOfMax, zoneStatus } from './hrmath.js';
import { clone } from './settings.js';

const TICK_MS = 200;
const STALE_MS = 5000; // HR older than this (real time) counts as missing
const MERGE_USER_LOG_SEC = 4; // rapid +/- taps collapse into one log entry

const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const LIMITS = {
  speed: [0, 25],
  incline: [-3, 20],
};

function newId(now) {
  return 'w' + now.toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Events: 'tick' snapshot, 'phase' {phase, phaseIndex, prevIndex}, 'cue' {...},
 *         'state' {state}, 'finish' {reason}, 'hr' {bpm}, 'treadmill' {actual}.
 */
export class WorkoutSession extends Emitter {
  constructor({ settings, plan, sim = null, timeScale = 1, now = Date.now }) {
    super();
    this.settings = clone(settings);
    this.plan = plan;
    this.sim = sim;
    this.timeScale = Math.max(1, Math.round(timeScale));
    this.now = now;
    this.id = newId(now());

    this.engine = new WorkoutEngine(plan);
    this.samples = []; // index = workout second, value = bpm | null
    this.treadmillLog = []; // {t, speed, incline, src: 'plan' | 'carry' | 'user'}
    this.actual = { speed: 0, incline: 0 };
    // Current target per phase type. Starts as the plan; when the user changes the
    // treadmill during a phase, the next phase of the same type starts from there.
    this.targets = {};
    for (const p of plan.phases) {
      if (!this.targets[p.type]) this.targets[p.type] = { ...p.target };
    }
    this._adjustedInPhase = false;

    this.lastHr = null;
    this.lastHrAt = -Infinity; // real ms
    this.lastRr = []; // RR intervals (ms) from the most recent strap reading
    this.battery = sim ? sim.battery : null;
    this.smooth = null;
    this.trend = null;
    this.zone = null; // 'below' | 'in' | 'above' | null

    this.startedAt = null;
    this.endedAt = null;
    this._timer = null;
    this._lastTick = 0;
    this._simAccMs = 0;

    this.engine.on('phase', (e) => {
      const prev = plan.phases[e.prevIndex];
      if (prev && this._adjustedInPhase) this.targets[prev.type] = { ...this.actual };
      this._adjustedInPhase = false;
      this._applyTargets(e.phase);
      // Re-evaluate against the new phase's zone right away (no hysteresis carry-over).
      this.zone = zoneStatus(pctOfMax(this.smooth, this.settings.maxHr), e.phase.zone, null);
      this.emit('phase', e);
    });
    this.engine.on('cue', (e) => this.emit('cue', e));
    this.engine.on('state', (e) => this.emit('state', e));
    this.engine.on('finish', (e) => {
      const last = this.engine.phase;
      if (last && this._adjustedInPhase) this.targets[last.type] = { ...this.actual };
      // The engine finishes in the middle of a step, before that second is sampled;
      // take it now so the record handed out on 'finish' is complete.
      this._onSecond(Math.floor(this.engine.elapsedMs / 1000));
      this.endedAt = new Date(this.now()).toISOString();
      this._stopTimer();
      this.emit('tick', this.snapshot());
      this.emit('finish', e);
    });
  }

  get state() {
    return this.engine.state;
  }

  start() {
    if (this.engine.state !== 'ready') return;
    this.startedAt = new Date(this.now()).toISOString();
    this._lastTick = this.now();
    this.engine.start();
    if (this.sim) this._stepSim(0, true);
    this._recordSecond(0);
    this._startTimer();
  }

  pause() {
    this.engine.pause();
    this.emit('tick', this.snapshot());
  }

  resume() {
    this.engine.resume();
    this.emit('tick', this.snapshot());
  }

  togglePause() {
    if (this.state === 'running') this.pause();
    else this.resume();
  }

  skip() {
    this.engine.skip();
    this.emit('tick', this.snapshot());
  }

  end() {
    this.engine.end();
  }

  /** Stop timers without finishing (used when the page is torn down). */
  dispose() {
    this._stopTimer();
  }

  /** A reading from a real strap. */
  pushHr(bpm, rr) {
    if (!(bpm > 0)) return;
    this.lastHr = bpm;
    this.lastHrAt = this.now();
    this.lastRr = rr || [];
    this.emit('hr', { bpm });
  }

  setBattery(level) {
    this.battery = level;
  }

  /** Change the logged treadmill speed or incline by `delta`. */
  adjust(kind, delta) {
    const [lo, hi] = LIMITS[kind];
    const value = round1(clamp(this.actual[kind] + delta, lo, hi));
    if (value === this.actual[kind]) return;
    this.actual[kind] = value;
    this._adjustedInPhase = true;
    const t = Math.floor(this.engine.elapsedMs / 1000);
    const last = this.treadmillLog[this.treadmillLog.length - 1];
    if (last && last.src === 'user' && t - last.t <= MERGE_USER_LOG_SEC) {
      last.speed = this.actual.speed;
      last.incline = this.actual.incline;
      last.t = t;
    } else {
      this.treadmillLog.push({ t, speed: this.actual.speed, incline: this.actual.incline, src: 'user' });
    }
    this.emit('treadmill', { actual: { ...this.actual } });
    this.emit('tick', this.snapshot());
  }

  /** Called every TICK_MS; also callable directly in tests. */
  tick() {
    const now = this.now();
    let dt = (now - this._lastTick) * this.timeScale;
    this._lastTick = now;
    if (!(dt > 0)) dt = 0;

    if (this.engine.state === 'running') {
      this._advance(dt);
    } else if (this.engine.state === 'paused' && this.sim) {
      // Keep the simulated heart beating (standing still) while paused.
      this._simAccMs += dt;
      while (this._simAccMs >= 1000) {
        this._simAccMs -= 1000;
        this._stepSim(1, false);
      }
    }
    if (this.engine.state !== 'finished') this.emit('tick', this.snapshot());
  }

  _advance(dt) {
    const e = this.engine;
    while (dt > 0 && e.state === 'running') {
      const toNextSecond = 1000 - (e.elapsedMs % 1000);
      const step = Math.min(dt, toNextSecond);
      const before = Math.floor(e.elapsedMs / 1000);
      e.advance(step);
      dt -= step;
      const after = Math.floor(e.elapsedMs / 1000);
      if (after > before) this._onSecond(after);
    }
  }

  // Take the sample for a completed workout second (once).
  _onSecond(sec) {
    if (sec < this.samples.length) return;
    if (this.sim) this._stepSim(1, true);
    this._recordSecond(sec);
  }

  _stepSim(dtSec, moving) {
    const bpm = this.sim.step(dtSec, {
      speed: this.actual.speed,
      incline: this.actual.incline,
      moving,
    });
    this.lastHr = bpm;
    this.lastHrAt = this.now();
    this.emit('hr', { bpm });
  }

  currentHr() {
    return this.now() - this.lastHrAt <= STALE_MS ? this.lastHr : null;
  }

  _recordSecond(sec) {
    const bpm = this.currentHr();
    this.samples[sec] = bpm;
    this.smooth = smoothedHr(this.samples, sec, 5);
    this.trend = hrTrend(this.samples, sec, 18);
    const phase = this.engine.phase;
    if (phase) {
      this.zone = zoneStatus(pctOfMax(this.smooth, this.settings.maxHr), phase.zone, this.zone);
    }
  }

  /** Assume the user sets the treadmill to the phase target; they correct it with +/-. */
  _applyTargets(phase) {
    const target = this.targets[phase.type];
    const planned = target.speed === phase.target.speed && target.incline === phase.target.incline;
    this.actual = { ...target };
    this.treadmillLog.push({
      t: Math.floor(this.engine.elapsedMs / 1000),
      speed: this.actual.speed,
      incline: this.actual.incline,
      src: planned ? 'plan' : 'carry',
    });
    this.emit('treadmill', { actual: { ...this.actual } });
  }

  _startTimer() {
    this._stopTimer();
    // Tick faster when time is sped up so the countdown and cues stay evenly spaced.
    this._timer = setInterval(() => this.tick(), Math.max(40, Math.round(TICK_MS / this.timeScale)));
  }

  _stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** Phases so far with their zones, for charts: [{startSec, endSec, zone}]. */
  phaseSpans() {
    const now = this.engine.elapsedMs / 1000;
    return this.engine.phaseLog.map((p) => ({
      startSec: p.startSec,
      endSec: p.endSec == null ? now : p.endSec,
      zone: this.plan.phases[p.i].zone,
    }));
  }

  snapshot() {
    const e = this.engine;
    const phase = e.phase;
    const bpm = this.currentHr();
    return {
      state: e.state,
      phase,
      phaseIndex: e.phaseIndex,
      phaseRemainingSec: e.phaseRemainingMs / 1000,
      phaseElapsedSec: e.phaseElapsedMs / 1000,
      elapsedSec: e.elapsedMs / 1000,
      totalSec: this.plan.totalSec,
      intervalNumber: e.intervalNumber,
      intervals: this.plan.intervals,
      bpm,
      smooth: this.smooth,
      pct: pctOfMax(bpm, this.settings.maxHr),
      zone: bpm == null ? null : this.zone,
      trend: this.trend,
      actual: { ...this.actual },
      target: phase ? { ...this.targets[phase.type] } : null,
      source: this.sim ? 'sim' : 'ble',
      battery: this.battery,
    };
  }

  /** Everything needed to store, analyse or display the finished workout. */
  toRecord() {
    return {
      id: this.id,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationSec: Math.round(this.engine.elapsedMs / 1000),
      finishReason: this.engine.finishReason,
      source: this.sim ? 'sim' : 'ble',
      timeScale: this.timeScale,
      settings: clone(this.settings),
      plan: clone(this.plan),
      phases: clone(this.engine.phaseLog),
      samples: this.samples.slice(),
      treadmillLog: clone(this.treadmillLog),
      finalTargets: clone(this.targets),
    };
  }
}
