// Builds synthetic workout records with exactly known numbers.
import { buildPlan } from '../js/workout.js';
import { DEFAULT_SETTINGS, clone } from '../js/settings.js';

/**
 * @param {object} o
 * @param {(phase, secInPhase:number, sec:number) => number|null} o.hr   bpm for each second
 * @param {object} [o.structure]
 * @param {object} [o.settings]  overrides merged onto the defaults
 * @param {string} [o.startedAt]
 * @param {(phase) => {speed:number, incline:number}} [o.tread]  treadmill per phase
 */
export function makeRecord({ hr, structure = {}, settings: over = {}, startedAt = '2026-11-02T17:00:00.000Z', tread } = {}) {
  const settings = clone(DEFAULT_SETTINGS);
  settings.maxHr = 200;
  settings.maxHrSource = 'known';
  Object.assign(settings.structure, { warmupSec: 60, intervals: 2, intervalSec: 240, recoverySec: 120, cooldownSec: 60 }, structure);
  Object.assign(settings, over);
  const plan = buildPlan(settings);
  const samples = [];
  const treadmillLog = [];
  const phases = plan.phases.map((p, i) => ({
    i,
    type: p.type,
    index: p.index,
    startSec: p.startSec,
    endSec: p.startSec + p.durationSec,
    plannedSec: p.durationSec,
    end: 'done',
  }));
  for (const p of plan.phases) {
    const t = tread ? tread(p) : p.target;
    treadmillLog.push({ t: p.startSec, speed: t.speed, incline: t.incline, src: 'plan' });
    for (let k = 0; k < p.durationSec; k++) samples[p.startSec + k] = hr ? hr(p, k, p.startSec + k) : 150;
  }
  samples[plan.totalSec] = samples[plan.totalSec - 1];
  return {
    id: 'w-' + startedAt,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + plan.totalSec * 1000).toISOString(),
    durationSec: plan.totalSec,
    finishReason: 'completed',
    source: 'ble',
    timeScale: 1,
    settings,
    plan,
    phases,
    samples,
    treadmillLog,
    finalTargets: clone(settings.treadmill),
  };
}
