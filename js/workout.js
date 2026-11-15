// Workout plan and state machine. Pure logic, no DOM, no timers:
// the caller feeds elapsed workout time in through advance(dtMs).

import { Emitter } from './emitter.js';
import { phaseTargets } from './activities.js';

export const PHASE_TYPES = ['warmup', 'interval', 'recovery', 'cooldown'];

function withStarts(phases) {
  let t = 0;
  for (const p of phases) {
    p.startSec = t;
    t += p.durationSec;
  }
  return t;
}

/** Build the ordered list of phases from settings. */
export function buildPlan(settings) {
  const s = settings.structure;
  const phases = [];
  const n = Math.max(1, Math.round(s.intervals));
  const targets = phaseTargets(settings);
  const mk = (type, durationSec, index) => ({
    type,
    index, // 1-based interval/recovery number, null for warmup/cooldown
    durationSec: Math.round(durationSec),
    zone: settings.zones[type].slice(),
    target: { ...targets[type] },
  });

  if (s.warmupSec > 0) phases.push(mk('warmup', s.warmupSec, null));
  for (let i = 1; i <= n; i++) {
    phases.push(mk('interval', s.intervalSec, i));
    if (i < n && s.recoverySec > 0) phases.push(mk('recovery', s.recoverySec, i));
  }
  if (s.cooldownSec > 0) phases.push(mk('cooldown', s.cooldownSec, null));

  const t = withStarts(phases);
  return { phases, intervals: n, totalSec: t };
}

/**
 * Maximum heart-rate field test: a long warm-up, 3 min hard and steady, 2 min easy,
 * then 3 min building to an all-out final minute. The peak of the 5 s smoothed HR is
 * the result. Zones are only nominal here: the test is run by effort, not by zone.
 */
export const MAX_TEST = [
  { type: 'warmup', index: null, durationSec: 600, zone: [60, 75], effort: 'easy', label: null },
  { type: 'interval', index: 1, durationSec: 180, zone: [85, 92], effort: 'hard', label: 'test.phase.hard' },
  { type: 'recovery', index: 1, durationSec: 120, zone: [60, 75], effort: 'easy', label: 'test.phase.easy' },
  { type: 'interval', index: 2, durationSec: 180, zone: [92, 100], effort: 'max', label: 'test.phase.max' },
  { type: 'cooldown', index: null, durationSec: 300, zone: [50, 65], effort: 'easy', label: null },
];

export function buildTestPlan(settings) {
  const targets = phaseTargets(settings);
  const phases = MAX_TEST.map((p) => ({ ...p, zone: p.zone.slice(), target: { ...targets[p.type] } }));
  const t = withStarts(phases);
  return { kind: 'maxTest', phases, intervals: 2, totalSec: t };
}

// Remaining-time thresholds (ms) that fire 'cue' events.
const CUE_THRESHOLDS = [
  { ms: 30000, kind: 'thirty', minPhaseSec: 50 },
  { ms: 3000, kind: 'count', n: 3 },
  { ms: 2000, kind: 'count', n: 2 },
  { ms: 1000, kind: 'count', n: 1 },
];

/**
 * States: 'ready' → 'running' ⇄ 'paused' → 'finished'.
 * Events: 'state' {state}, 'phase' {phase, phaseIndex, prevIndex},
 *         'cue' {kind, n, phase}, 'finish' {reason}.
 */
export class WorkoutEngine extends Emitter {
  constructor(plan) {
    super();
    this.plan = plan;
    this.state = 'ready';
    this.elapsedMs = 0;
    this.phaseIndex = -1;
    this.phaseStartMs = 0;
    this.phaseLog = []; // {i, type, index, startSec, endSec, plannedSec, end}
    this.finishReason = null;
  }

  get phase() {
    return this.plan.phases[this.phaseIndex] || null;
  }

  get phaseElapsedMs() {
    return this.elapsedMs - this.phaseStartMs;
  }

  get phaseRemainingMs() {
    const p = this.phase;
    return p ? Math.max(0, p.durationSec * 1000 - this.phaseElapsedMs) : 0;
  }

  /** 1-based number of the current or most recent interval (0 before the first). */
  get intervalNumber() {
    for (let i = Math.min(this.phaseIndex, this.plan.phases.length - 1); i >= 0; i--) {
      const p = this.plan.phases[i];
      if (p.type === 'interval') return p.index;
    }
    return 0;
  }

  start() {
    if (this.state !== 'ready') return;
    this._setState('running');
    this._enterPhase(0);
  }

  pause() {
    if (this.state !== 'running') return;
    this._setState('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this._setState('running');
  }

  togglePause() {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  /** End the current phase now and move to the next one. */
  skip() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this._exitPhase('skipped');
    this._enterPhase(this.phaseIndex + 1);
  }

  /** Stop the workout early. */
  end() {
    if (this.state === 'finished' || this.state === 'ready') return;
    this._exitPhase('ended');
    this._finish('ended');
  }

  /** Advance workout time. Crosses phase boundaries and fires cues as needed. */
  advance(dtMs) {
    if (this.state !== 'running' || !(dtMs > 0)) return;
    while (dtMs > 0 && this.state === 'running') {
      const before = this.phaseRemainingMs;
      const step = Math.min(dtMs, before);
      this.elapsedMs += step;
      dtMs -= step;
      const after = this.phaseRemainingMs;
      this._checkCues(before, after);
      if (after <= 0) {
        this._exitPhase('done');
        this._enterPhase(this.phaseIndex + 1);
      }
    }
  }

  _checkCues(beforeMs, afterMs) {
    const p = this.phase;
    for (const c of CUE_THRESHOLDS) {
      if (c.minPhaseSec && p.durationSec < c.minPhaseSec) continue;
      if (beforeMs > c.ms && afterMs <= c.ms) {
        this.emit('cue', { kind: c.kind, n: c.n, phase: p, phaseIndex: this.phaseIndex });
      }
    }
  }

  _enterPhase(i) {
    const prevIndex = this.phaseIndex;
    if (i >= this.plan.phases.length) {
      this._finish('completed');
      return;
    }
    this.phaseIndex = i;
    this.phaseStartMs = this.elapsedMs;
    const p = this.phase;
    this.phaseLog.push({
      i,
      type: p.type,
      index: p.index,
      startSec: this.elapsedMs / 1000,
      endSec: null,
      plannedSec: p.durationSec,
      end: null,
    });
    this.emit('phase', { phase: p, phaseIndex: i, prevIndex });
  }

  _exitPhase(reason) {
    const entry = this.phaseLog[this.phaseLog.length - 1];
    if (entry && entry.endSec === null) {
      entry.endSec = this.elapsedMs / 1000;
      entry.end = reason;
    }
  }

  _finish(reason) {
    this.finishReason = reason;
    this._setState('finished');
    this.emit('finish', { reason });
  }

  _setState(state) {
    this.state = state;
    this.emit('state', { state });
  }

  toJSON() {
    return {
      state: this.state,
      elapsedMs: this.elapsedMs,
      phaseIndex: this.phaseIndex,
      phaseStartMs: this.phaseStartMs,
      phaseLog: this.phaseLog,
      finishReason: this.finishReason,
    };
  }

  /** Recreate an engine from toJSON() output (used for crash recovery). Restores paused. */
  static restore(plan, data) {
    const e = new WorkoutEngine(plan);
    e.elapsedMs = data.elapsedMs;
    e.phaseIndex = data.phaseIndex;
    e.phaseStartMs = data.phaseStartMs;
    e.phaseLog = data.phaseLog.map((x) => ({ ...x }));
    e.finishReason = data.finishReason || null;
    e.state = data.state === 'finished' ? 'finished' : 'paused';
    return e;
  }
}
