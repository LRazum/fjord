// Simulated heart rate. DOM-free.
//
// Effort comes from the machine settings the user has logged (ACSM-style metabolic
// equations for treadmill, bike, stepmill and rower), relative to a VO2max that is calibrated so the planned interval
// settings land in the middle of the interval zone (optionally biased so the plan is
// too easy or too hard). HR follows a first-order response toward the target with
// different rise/fall time constants, plus a slow "fatigue" component that keeps HR
// elevated in recovery, cardiac drift and Ornstein–Uhlenbeck noise.

const WALK_MAX = 6; // km/h, pure walking equation below this
const RUN_MIN = 8; // km/h, pure running equation above this

/** Oxygen cost (ml/kg/min) on a treadmill; walking/running equations blended 6–8 km/h. */
export function vo2Treadmill(speedKmh, inclinePct) {
  if (!(speedKmh > 0)) return 3.5;
  const v = (speedKmh * 1000) / 60; // m/min
  const g = Math.max(0, inclinePct) / 100;
  const walk = 3.5 + 0.1 * v + 1.8 * v * g;
  const run = 3.5 + 0.2 * v + 0.9 * v * g;
  if (speedKmh <= WALK_MAX) return walk;
  if (speedKmh >= RUN_MIN) return run;
  const w = (speedKmh - WALK_MAX) / (RUN_MIN - WALK_MAX);
  return walk * (1 - w) + run * w;
}

const BODY_KG = 75;

/** Gym-bike watts: roughly 15 W per resistance level at 80 rpm. */
export function bikeWatts(level, cadence) {
  return Math.max(0, level) * 15 * (Math.max(0, cadence) / 80);
}

/**
 * Oxygen cost (ml/kg/min) of a logged machine setting.
 * Bike: ACSM leg cycling 7 + 10.8·W/kg. Stepmill: ACSM stepping with 20 cm steps and
 * about 20 + 7·level steps/min. Rower: about 14 ml/min per watt for a 75 kg rower.
 */
export function vo2Machine(activity, v = {}) {
  if (activity === 'bike') return 7 + (10.8 * bikeWatts(v.level, v.cadence)) / BODY_KG;
  if (activity === 'stepmill') {
    const f = 20 + 7 * Math.max(0, v.level || 0);
    return 3.5 + 0.2 * f + 1.33 * 1.8 * 0.2 * f;
  }
  if (activity === 'rower') return 7 + (14 * Math.max(0, v.power || 0)) / BODY_KG;
  return vo2Treadmill(v.speed, v.incline);
}

export const SIM_PROFILES = {
  matched: 0,
  easy: -0.11, // runner is fitter than the plan assumes → HR ends up below zone
  hard: 0.14, // runner is less fit → HR ends up above zone
};

export function profileBias(profile, rand = Math.random) {
  if (profile in SIM_PROFILES) return SIM_PROFILES[profile];
  return (rand() * 2 - 1) * 0.11;
}

function gauss(rand) {
  // Box–Muller
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export class HrSimulator {
  /**
   * @param {object} o
   * @param {number} o.maxHr
   * @param {number} [o.restHr]
   * @param {object} [o.reference] planned interval setting (e.g. {speed, incline});
   *                              without one (outdoors) effort comes from the phase zone
   * @param {string} [o.activity] an ACTIVITIES id, treadmill by default
   * @param {number} [o.intervalTargetPct] where the reference should land (% HRmax)
   * @param {number} [o.bias] fractional change of effort at the reference setting
   * @param {() => number} [o.rand]
   */
  constructor({ maxHr, restHr, reference, activity = 'treadmill', intervalTargetPct = 90, bias = 0, rand = Math.random }) {
    this.kind = 'sim';
    this.activity = activity;
    this.bias = bias;
    this.maxHr = maxHr;
    this.restHr = restHr || 60;
    this.rand = rand;
    const reserve = this.maxHr - this.restHr;
    // The slow component adds a few bpm by the end of an interval, so aim a bit lower.
    const frac = (((intervalTargetPct - 2.5) / 100) * this.maxHr - this.restHr) / reserve;
    const refVo2 = vo2Machine(activity, reference || {});
    this.vo2max = reference && refVo2 > 3.5 ? 3.5 + (refVo2 - 3.5) / Math.max(0.2, frac * (1 + bias)) : 45;
    this.hr = this.restHr + 8;
    this.fatigue = 0; // bpm
    this.drift = 0; // bpm
    this.noise = 0; // bpm
    this.battery = 87;
  }

  /** Effort (fraction of HR reserve) that would settle in the middle of a zone. */
  zoneEffort(zone) {
    const mid = ((zone[0] + zone[1]) / 2 - 2.5) / 100;
    return ((mid * this.maxHr - this.restHr) / (this.maxHr - this.restHr)) * (1 - this.bias);
  }

  /**
   * ctx: { values?, activity?, moving, effort?, effortFloor? } or the older
   * treadmill form { speed, incline, moving }.
   */
  effort(ctx) {
    const moving = ctx.moving !== false;
    let f;
    if (!moving) f = (3.5 * 0.2) / (this.vo2max - 3.5);
    else if (Number.isFinite(ctx.effort)) f = ctx.effort;
    else {
      const vo2 = vo2Machine(ctx.activity || this.activity, ctx.values || ctx);
      f = (vo2 - 3.5) / (this.vo2max - 3.5);
    }
    if (moving && Number.isFinite(ctx.effortFloor)) f = Math.max(f, ctx.effortFloor);
    return Math.min(1.1, Math.max(0, f));
  }

  targetHr(ctx) {
    const f = this.effort(ctx);
    const hr = this.restHr + (this.maxHr - this.restHr) * f + this.fatigue + this.drift;
    return Math.min(this.maxHr, hr);
  }

  /** Advance by dt seconds under the given machine context; returns integer bpm. */
  step(dt, ctx) {
    const f = this.effort(ctx);
    // Slow component: builds above ~70 % effort, decays over a few minutes.
    this.fatigue += dt * (f > 0.7 ? (f - 0.7) * 0.2 : 0) - (this.fatigue * dt) / 200;
    this.fatigue = Math.max(0, Math.min(25, this.fatigue));
    // Cardiac drift: about +1 bpm per 4 min of hard work, never decays in a session.
    if (f > 0.6) this.drift = Math.min(10, this.drift + (dt * 0.25) / 60);

    const target = this.targetHr(ctx);
    const tau = target > this.hr ? 55 : 45;
    this.hr += (target - this.hr) * (1 - Math.exp(-dt / tau));

    // Ornstein–Uhlenbeck noise, about ±1 bpm (chest straps report a smoothed value).
    this.noise += (-this.noise * dt) / 6 + 0.6 * Math.sqrt(dt) * gauss(this.rand);
    const bpm = Math.round(Math.min(this.maxHr + 2, this.hr + this.noise));
    return Math.max(40, bpm);
  }
}
