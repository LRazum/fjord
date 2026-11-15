// A running workout: ties the engine, the HR source, recording and treadmill logging
// together. Uses timers but no DOM.

import { Emitter } from './emitter.js';
import { WorkoutEngine } from './workout.js';
import { smoothedHr, hrTrend, pctOfMax, zoneStatus } from './hrmath.js';
import { clone } from './settings.js';
import { WorkoutCoach } from './coaching.js';
import { activityOf, pickValues, sameValues, roundTo } from './activities.js';

const TICK_MS = 200;
const STALE_MS = 5000; // HR older than this (real time) counts as missing
const MERGE_USER_LOG_SEC = 4; // rapid +/- taps collapse into one log entry

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Highest 5 s smoothed HR: a single spurious strap value cannot set the test result.
export function peakHr(samples, end = samples.length - 1) {
  let peak = null;
  for (let i = 0; i <= end; i++) {
    if (samples[i] == null) continue;
    const v = smoothedHr(samples, i, 5);
    if (v != null && (peak == null || v > peak)) peak = v;
  }
  return peak == null ? null : Math.round(peak);
}

function newId(now) {
  return 'w' + now.toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Events: 'tick' snapshot, 'phase' {phase, phaseIndex, prevIndex}, 'cue' {...},
 *         'state' {state}, 'finish' {reason}, 'hr' {bpm}, 'treadmill' {actual}.
 */
export class WorkoutSession extends Emitter {
  /**
   * @param {object} o
   * @param {object} [o.restore]  a toSnapshot() result to continue from (crash recovery);
   *                              the session then starts paused and needs attach().
   */
  constructor({ settings, plan, sim = null, timeScale = 1, now = Date.now, restore = null }) {
    super();
    this.settings = clone(settings);
    this.plan = plan;
    this.activity = activityOf(this.settings);
    this.isTest = plan.kind === 'maxTest';
    // A max test is run by effort; zone suggestions would only get in the way.
    if (this.isTest) this.settings.coachingEnabled = false;
    this.sim = sim;
    this.timeScale = Math.max(1, Math.round(timeScale));
    this.now = now;
    this.id = newId(now());

    this.engine = new WorkoutEngine(plan);
    this.samples = []; // index = workout second, value = bpm | null
    // Machine log: {t, ...control values (e.g. speed, incline), src: 'plan' | 'carry' | 'user'}.
    this.treadmillLog = [];
    this.actual = pickValues(this.activity, {});
    for (const k of Object.keys(this.actual)) this.actual[k] = 0;
    // Current target per phase type. Starts as the plan; when the user changes the
    // treadmill during a phase, the next phase of the same type starts from there.
    this.targets = {};
    for (const p of plan.phases) {
      if (!this.targets[p.type]) this.targets[p.type] = { ...p.target };
    }
    this._adjustedInPhase = false;

    this.lastHr = null;
    this.lastHrAt = -Infinity; // real ms
    this._hrReadings = []; // unconsumed, timestamped strap readings
    this._sampleClock = { wallMs: now(), workoutMs: 0 };
    this.lastRr = []; // RR intervals (ms) from the most recent strap reading
    this.battery = sim ? sim.battery : null;
    this.smooth = null;
    this.trend = null;
    this.zone = null; // 'below' | 'in' | 'above' | null
    this.peak = null; // highest 5 s smoothed HR so far (shown during a max test)
    this._simNudge = 0; // outdoor simulator only: accepted "faster/easier" suggestions
    this.coach = new WorkoutCoach();
    this.hrConnected = true;
    this.contact = null;

    this.startedAt = null;
    this.endedAt = null;
    this._timer = null;
    this._lastTick = now();
    this._simAccMs = 0;

    if (restore) this._restore(restore);
    this._bindEngine();
  }

  _restore(snap) {
    this.id = snap.id;
    this.startedAt = snap.startedAt;
    this.engine = WorkoutEngine.restore(this.plan, snap.engine);
    this.samples = snap.samples.slice();
    this.treadmillLog = snap.treadmillLog.map((x) => ({ ...x }));
    this.actual = { ...snap.actual };
    this.targets = clone(snap.targets);
    this._adjustedInPhase = !!snap.adjustedInPhase;
    const sec = this.samples.length - 1;
    this.smooth = smoothedHr(this.samples, sec, 5);
    this.trend = hrTrend(this.samples, sec, 18);
    this.peak = peakHr(this.samples);
    if (this.sim) {
      const last = [...this.samples].reverse().find((v) => v != null);
      if (last) this.sim.hr = last;
    }
  }

  _bindEngine() {
    const plan = this.plan;
    this.engine.on('phase', (e) => {
      const prev = plan.phases[e.prevIndex];
      if (prev && this._adjustedInPhase) this.targets[prev.type] = { ...this.actual };
      this._adjustedInPhase = false;
      this._simNudge = 0;
      this._applyTargets(e.phase);
      // Re-evaluate against the new phase's zone right away (no hysteresis carry-over).
      this.zone = this._zoneFor(e.phase, null);
      this._updateCoaching();
      this.emit('phase', e);
    });
    this.engine.on('cue', (e) => this.emit('cue', e));
    this.engine.on('state', (e) => {
      if (e.state !== 'running') this.coach.defer(this.engine.elapsedMs / 1000);
      this.emit('state', e);
    });
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

  /** Start ticking a restored (paused) session. The user resumes it with resume(). */
  attach() {
    this._lastTick = this.now();
    if (this.engine.state !== 'finished') this._startTimer();
    this.emit('tick', this.snapshot());
  }

  /** Everything needed to continue this workout after a reload or crash. */
  toSnapshot() {
    return {
      v: 1,
      id: this.id,
      startedAt: this.startedAt,
      savedAt: new Date(this.now()).toISOString(),
      settings: this.settings,
      plan: this.plan,
      timeScale: this.timeScale,
      source: this.sim ? 'sim' : 'ble',
      engine: this.engine.toJSON(),
      samples: this.samples.slice(),
      treadmillLog: this.treadmillLog.map((x) => ({ ...x })),
      actual: { ...this.actual },
      targets: clone(this.targets),
      adjustedInPhase: this._adjustedInPhase,
    };
  }

  /**
   * The record of a crashed workout that the user chose to save without resuming.
   * Ends it at the last saved moment.
   */
  static recordFromSnapshot(snap) {
    const s = new WorkoutSession({ settings: snap.settings, plan: snap.plan, restore: snap, now: () => Date.parse(snap.savedAt) });
    if (s.engine.state !== 'finished') s.engine.end();
    const rec = s.toRecord();
    rec.source = snap.source;
    rec.endedAt = snap.savedAt;
    return rec;
  }

  get state() {
    return this.engine.state;
  }

  start() {
    if (this.engine.state !== 'ready') return;
    this.startedAt = new Date(this.now()).toISOString();
    this._lastTick = this.now();
    this._sampleClock = { wallMs: this._lastTick, workoutMs: 0 };
    this.engine.start();
    if (this.sim) this._stepSim(0, true);
    this._recordSecond(0);
    this._startTimer();
  }

  pause() {
    if (this.state !== 'running') return;
    this.tick();
    this.engine.pause();
    this.emit('tick', this.snapshot());
  }

  resume() {
    if (this.state !== 'paused') return;
    // A suspended browser may not have ticked at all while paused. Consume that
    // wall-clock gap in the paused state before allowing workout time to advance.
    this.tick();
    this.engine.resume();
    this.emit('tick', this.snapshot());
  }

  togglePause() {
    if (this.state === 'running') this.pause();
    else this.resume();
  }

  skip() {
    const phaseIndex = this.engine.phaseIndex;
    this.tick();
    // If the phase ended naturally since the last paint, do not also skip the
    // new phase that the user has not had a chance to see yet.
    if (this.engine.phaseIndex !== phaseIndex) return;
    this.engine.skip();
    this.emit('tick', this.snapshot());
  }

  end() {
    this.tick();
    this.engine.end();
  }

  /** Stop timers without finishing (used when the page is torn down). */
  dispose() {
    this._stopTimer();
  }

  /** A reading from a real strap. */
  pushHr(bpm, rr, contact = this.contact, at = this.now()) {
    if (!Number.isFinite(bpm) || !(bpm > 0) || !Number.isFinite(at)) return;
    this.lastHr = bpm;
    this.lastHrAt = at;
    let i = this._hrReadings.length;
    while (i > 0 && this._hrReadings[i - 1].at > at) i--;
    this._hrReadings.splice(i, 0, { at, bpm });
    this._pruneHr(this._lastTick - STALE_MS);
    this.lastRr = rr || [];
    this.contact = contact;
    this._updateCoaching();
    this.emit('hr', { bpm });
  }

  setBattery(level) {
    this.battery = level;
  }

  setStrapStatus(connected, contact = null) {
    this.hrConnected = connected;
    this.contact = contact;
    this._updateCoaching();
    this.emit('tick', this.snapshot());
  }

  _updateCoaching() {
    this.coach.update(this.snapshot(), this.settings, this.hrConnected && this.contact !== false);
  }

  confirmSuggestion(id) {
    // Recheck the clock, phase and signal at the tap, not just at the last paint.
    this.tick();
    const p = this.coach.suggestion;
    if (!p || p.id !== id) return false;
    this.coach.defer(this.engine.elapsedMs / 1000, 60, p.kind);
    if (p.kind) this.adjust(p.kind, p.to - this.actual[p.kind]);
    else {
      // Outdoors there is nothing to log; only the simulated runner reacts.
      this._simNudge += p.direction * 0.04;
      this.emit('tick', this.snapshot());
    }
    return true;
  }

  dismissSuggestion(id) {
    this.tick();
    if (!this.coach.suggestion || this.coach.suggestion.id !== id) return;
    this.coach.defer(this.engine.elapsedMs / 1000);
    this.emit('tick', this.snapshot());
  }

  /** Change a logged machine setting (e.g. treadmill speed) by `delta`. */
  adjust(kind, delta) {
    const c = this.activity.controls.find((x) => x.key === kind);
    if (!c || !Number.isFinite(delta)) return;
    const value = roundTo(clamp(this.actual[kind] + delta, c.min, c.max), c.dec);
    if (value === this.actual[kind]) return;
    this.coach.defer(this.engine.elapsedMs / 1000);
    this.actual[kind] = value;
    this._adjustedInPhase = true;
    const t = Math.floor(this.engine.elapsedMs / 1000);
    const last = this.treadmillLog[this.treadmillLog.length - 1];
    if (last && last.src === 'user' && t - last.t <= MERGE_USER_LOG_SEC) {
      Object.assign(last, this.actual);
      last.t = t;
    } else {
      this.treadmillLog.push({ t, ...this.actual, src: 'user' });
    }
    this.emit('treadmill', { actual: { ...this.actual } });
    this.emit('tick', this.snapshot());
  }

  /** Called every TICK_MS; also callable directly in tests. */
  tick() {
    const now = this.now();
    this._sampleClock = { wallMs: this._lastTick, workoutMs: this.engine.elapsedMs };
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
    this._pruneHr(now - STALE_MS);
    this._updateCoaching();
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
    const e = this.engine;
    const phase = e.phase;
    const ctx = { activity: this.activity.id, values: this.actual, moving };
    if (phase && moving) {
      const progress = phase.durationSec ? Math.min(1, e.phaseElapsedMs / 1000 / phase.durationSec) : 0;
      // Without machine settings, the simulated athlete follows the phase's intent.
      if (!this.activity.controls.length) ctx.effort = this.sim.zoneEffort(phase.zone) + this._simNudge;
      if (phase.effort === 'hard') ctx.effortFloor = 0.88;
      if (phase.effort === 'max') ctx.effortFloor = 0.9 + 0.2 * progress;
    }
    const bpm = this.sim.step(dtSec, ctx);
    this.lastHr = bpm;
    this.lastHrAt = this.now();
    this.emit('hr', { bpm });
  }

  currentHr() {
    return this.now() - this.lastHrAt <= STALE_MS ? this.lastHr : null;
  }

  _hrAt(at) {
    let low = 0;
    let high = this._hrReadings.length - 1;
    let reading = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = this._hrReadings[mid];
      if (value.at <= at) {
        reading = value;
        low = mid + 1;
      } else high = mid - 1;
    }
    return reading && at - reading.at <= STALE_MS ? reading.bpm : null;
  }

  _pruneHr(before) {
    let count = 0;
    while (count < this._hrReadings.length && this._hrReadings[count].at < before) count++;
    if (count) this._hrReadings.splice(0, count);
  }

  _recordSecond(sec) {
    // Use the time this workout second actually occurred, rather than a fresh
    // reading that may have arrived only after the browser resumed its timer.
    const at = this._sampleClock.wallMs + (this.engine.elapsedMs - this._sampleClock.workoutMs) / this.timeScale;
    const bpm = this.sim ? this.currentHr() : this._hrAt(at);
    this.samples[sec] = bpm;
    this.smooth = smoothedHr(this.samples, sec, 5);
    this.trend = hrTrend(this.samples, sec, 18);
    if (bpm != null && this.smooth != null && (this.peak == null || this.smooth > this.peak)) {
      this.peak = Math.round(this.smooth);
    }
    const phase = this.engine.phase;
    if (phase) this.zone = this._zoneFor(phase, this.zone);
    this._updateCoaching();
  }

  // A max test has no personal HRmax to compare against yet.
  _zoneFor(phase, prev) {
    if (this.isTest) return null;
    return zoneStatus(pctOfMax(this.smooth, this.settings.maxHr), phase.zone, prev);
  }

  /** Assume the user sets the machine to the phase target; they correct it with +/-. */
  _applyTargets(phase) {
    const target = this.targets[phase.type] || {};
    const planned = sameValues(this.activity, target, phase.target);
    this.actual = { ...target };
    this.treadmillLog.push({
      t: Math.floor(this.engine.elapsedMs / 1000),
      ...this.actual,
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
      suggestion: this.coach.suggestion,
      peak: this.peak,
      isTest: this.isTest,
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
      activity: this.activity.id,
      kind: this.isTest ? 'maxTest' : 'workout',
      ...(this.isTest ? { peakHr: peakHr(this.samples) } : {}),
    };
  }
}
