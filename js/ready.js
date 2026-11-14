// Pre-workout HR preview and five real seconds of countdown. No DOM or timers.

import { Emitter } from './emitter.js';

const COUNTDOWN_MS = 5000;
const STALE_MS = 5000;

export class ReadySession extends Emitter {
  constructor({ sim = null, now = Date.now } = {}) {
    super();
    this.sim = sim;
    this.now = now;
    this.state = 'ready';
    this.remainingMs = COUNTDOWN_MS;
    this.lastHr = null;
    this.lastHrAt = -Infinity;
    this.lastRr = [];
    this._lastTick = now();
    this._simAccMs = 0;
    if (sim) this.pushHr(sim.step(0, { speed: 0, incline: 0, moving: false }));
  }

  pushHr(bpm, rr = [], at = this.now()) {
    if (!Number.isFinite(bpm) || !(bpm > 0)) return;
    this.lastHr = bpm;
    this.lastHrAt = at;
    this.lastRr = rr;
    this.emit('tick', this.snapshot());
  }

  startCountdown() {
    if (this.state !== 'ready') return;
    this.state = 'counting';
    this.remainingMs = COUNTDOWN_MS;
    this._lastTick = this.now();
    this.emit('tick', this.snapshot());
  }

  // Returning from the background requires another deliberate Start tap.
  resetCountdown() {
    if (this.state !== 'counting') return;
    this.state = 'ready';
    this.remainingMs = COUNTDOWN_MS;
    this._lastTick = this.now();
    this.emit('tick', this.snapshot());
  }

  cancel() {
    if (this.state === 'finished') return;
    this.state = 'cancelled';
  }

  tick() {
    if (this.state === 'finished' || this.state === 'cancelled') return;
    const now = this.now();
    const dt = Math.max(0, now - this._lastTick);
    this._lastTick = now;
    if (this.sim) {
      // A long background stay does not need hours of standing-still simulation.
      this._simAccMs = Math.min(5000, this._simAccMs + dt);
      while (this._simAccMs >= 1000) {
        this._simAccMs -= 1000;
        this.pushHr(this.sim.step(1, { speed: 0, incline: 0, moving: false }));
      }
    }
    if (this.state === 'counting') {
      this.remainingMs = Math.max(0, this.remainingMs - dt);
      if (this.remainingMs === 0) this.state = 'finished';
    }
    this.emit('tick', this.snapshot());
    if (this.state === 'finished') this.emit('finish', {});
  }

  snapshot() {
    return {
      state: this.state,
      remainingSec: this.state === 'counting' ? Math.ceil(this.remainingMs / 1000) : null,
      bpm: this.now() - this.lastHrAt <= STALE_MS ? this.lastHr : null,
      source: this.sim ? 'sim' : 'ble',
    };
  }
}
