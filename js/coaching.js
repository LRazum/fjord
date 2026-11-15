// Optional machine suggestions. Pure logic; accepting never controls the machine.

import { hasMaxHr } from './settings.js';
import { activityOf, controlStep, roundTo } from './activities.js';

const PERSIST_SEC = 20;
const SETTLE_SEC = 60;
// Suggestions never go below these, even where logging can (a walking break, a decline).
const FLOOR = { speed: 1, incline: 0 };

export class WorkoutCoach {
  constructor() {
    this.suggestion = null;
    this._phaseIndex = null;
    this._key = '';
    this._since = 0;
    this._blockedUntil = 0;
    this._id = 0;
    this._lastKind = 'incline';
  }

  _clear() {
    this.suggestion = null;
    this._key = '';
  }

  defer(sec, delay = SETTLE_SEC, acceptedKind = null) {
    this._clear();
    this._blockedUntil = sec + delay;
    if (acceptedKind) this._lastKind = acceptedKind;
  }

  update(s, settings, signalOk = true) {
    if (s.phaseIndex !== this._phaseIndex) {
      this._clear();
      this._phaseIndex = s.phaseIndex;
    }
    if (s.state !== 'running' || settings.coachingEnabled === false || !hasMaxHr(settings)
      || !signalOk || s.bpm == null || !Number.isFinite(s.smooth) || !Number.isFinite(s.trend)
      || !s.phase || s.phaseElapsedSec < 30 || s.phaseRemainingSec <= 30) {
      this._clear();
      return null;
    }
    const pct = s.smooth * 100 / settings.maxHr;
    const [lo, hi] = s.phase.zone;
    const direction = pct < lo - 1 ? 1 : pct > hi + 1 ? -1 : 0;
    // HR needs time to rise after entering an interval; recovery and cool-down
    // never need a suggestion to work harder just to chase their lower zone edge.
    const early = s.phase.type === 'interval' ? 90 : 60;
    const projected = (s.smooth + s.trend * 0.75) * 100 / settings.maxHr;
    if (!direction || (direction > 0 && (s.phaseElapsedSec < early
      || !['warmup', 'interval'].includes(s.phase.type)
      || (s.trend > 0 && projected >= lo)))
      || (direction < 0 && s.trend < 0 && projected <= hi)) {
      this._clear();
      return null;
    }
    const controls = activityOf(settings).controls;
    let kinds = [];
    if (controls.length === 1) kinds = [controls[0]];
    else if (controls.length > 1) {
      const [a, b] = controls;
      if (settings.adjustPref === 'incline') kinds = [b];
      else if (settings.adjustPref === 'both') kinds = this._lastKind === a.key ? [b, a] : [a, b];
      else kinds = [a];
    }
    let candidate = null;
    const reason = direction > 0 ? 'below' : 'above';
    // Outdoors there is no machine: the suggestion is just "a bit faster/easier".
    if (!controls.length) candidate = { kind: null, from: null, to: null, direction, reason };
    for (const c of kinds) {
      const step = Math.min(c.coachMax, controlStep(settings, c));
      const from = s.actual[c.key];
      if (!Number.isFinite(from)) continue;
      const min = Math.max(c.min, FLOOR[c.key] ?? c.min);
      const to = roundTo(Math.max(min, Math.min(c.max, from + direction * step)), c.dec);
      if (direction * (to - from) > 0) {
        candidate = { kind: c.key, from, to, direction, reason };
        break;
      }
    }
    if (!candidate) {
      this._clear();
      return null;
    }
    const key = `${s.phaseIndex}:${candidate.kind}:${candidate.from}:${candidate.to}`;
    if (key !== this._key) {
      this._key = key;
      this._since = s.elapsedSec;
      this.suggestion = null;
    }
    if (s.elapsedSec - this._since < PERSIST_SEC || s.elapsedSec < this._blockedUntil) return null;
    if (!this.suggestion) this.suggestion = { ...candidate, id: ++this._id };
    return this.suggestion;
  }
}
