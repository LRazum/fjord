// Activities (treadmill, gym bike, stepmill, rowing machine, outdoor run/ride) and the
// machine controls each one logs. DOM-free.
//
// Controls are the numbers the user sets on the machine and logs with +/−. Outdoor
// activities have none: the workout is guided by heart rate alone.
//
// Control fields:
//   key        stored key in targets, `actual` and log entries
//   labelKey / targetKey / unitKey   i18n keys ('' unit = no unit)
//   step       +/− step on the workout screen (treadmill steps come from settings)
//   min, max   allowed logged range; dec = decimals shown and stored
//   coachMax   the largest single live suggestion
//   nextStep   change per recommendation step after a workout; bothStep when both change
//   recMin     lowest value a recommendation may plan

const TREADMILL = [
  { key: 'speed', labelKey: 'wo.speed', targetKey: 'wo.targetSpeed', unitKey: 'wo.kmh', unit: 'km/h',
    step: 0.5, setStep: 0.1, min: 0, max: 25, dec: 1, coachMax: 0.5, nextStep: 0.5, bothStep: 0.5, recMin: 1 },
  { key: 'incline', labelKey: 'wo.incline', targetKey: 'wo.targetIncline', unitKey: 'wo.pct', unit: '%',
    step: 0.5, setStep: 0.5, min: -3, max: 20, dec: 1, coachMax: 0.5, nextStep: 1, bothStep: 0.5, recMin: 0 },
];

const level = (max) => ({ key: 'level', labelKey: 'ctl.level', targetKey: 'ctl.targetLevel', unitKey: '', unit: '',
  step: 1, setStep: 1, min: 1, max, dec: 0, coachMax: 1, nextStep: 1, bothStep: 1, recMin: 1 });

export const ACTIVITIES = [
  { id: 'treadmill', indoor: true, sport: 'Running', controls: TREADMILL },
  { id: 'bike', indoor: true, sport: 'Biking', controls: [
    level(30),
    { key: 'cadence', labelKey: 'ctl.cadence', targetKey: 'ctl.targetCadence', unitKey: 'ctl.rpm', unit: 'rpm',
      step: 5, setStep: 5, min: 30, max: 140, dec: 0, coachMax: 5, nextStep: 5, bothStep: 5, recMin: 40 },
  ] },
  { id: 'stepmill', indoor: true, sport: 'Other', controls: [level(20)] },
  { id: 'rower', indoor: true, sport: 'Other', controls: [
    { key: 'power', labelKey: 'ctl.power', targetKey: 'ctl.targetPower', unitKey: 'ctl.watt', unit: 'W',
      step: 10, setStep: 5, min: 0, max: 600, dec: 0, coachMax: 10, nextStep: 10, bothStep: 10, recMin: 20 },
    { key: 'rate', labelKey: 'ctl.rate', targetKey: 'ctl.targetRate', unitKey: 'ctl.spm', unit: 'spm',
      step: 1, setStep: 1, min: 14, max: 40, dec: 0, coachMax: 1, nextStep: 1, bothStep: 1, recMin: 16 },
  ] },
  { id: 'run', indoor: false, sport: 'Running', controls: [] },
  { id: 'ride', indoor: false, sport: 'Biking', controls: [] },
];

export const ACTIVITY_IDS = ACTIVITIES.map((a) => a.id);

export function activityById(id) {
  return ACTIVITIES.find((a) => a.id === id) || ACTIVITIES[0];
}

/** Old settings and records have no activity: they were all treadmill workouts. */
export function activityOf(settings) {
  return activityById(settings && settings.activity);
}

/** Where the planned per-phase targets of an activity live in the settings. */
export function targetsPath(activityId) {
  return activityId === 'treadmill' ? 'treadmill' : 'targets.' + activityId;
}

/** Planned targets per phase type for the current (or given) activity. */
export function phaseTargets(settings, activityId = activityOf(settings).id) {
  const a = activityById(activityId);
  if (!a.controls.length) return { warmup: {}, interval: {}, recovery: {}, cooldown: {} };
  if (a.id === 'treadmill') return settings.treadmill;
  return (settings.targets && settings.targets[a.id]) || {};
}

/** +/− step of a control on the workout screen. The treadmill steps are user settings. */
export function controlStep(settings, control) {
  if (control.key === 'speed' && settings.speedStep > 0) return settings.speedStep;
  if (control.key === 'incline' && settings.inclineStep > 0) return settings.inclineStep;
  return control.step;
}

/**
 * Controls in the order the user prefers to change them. adjustPref keeps its old
 * values: 'speed' = the first control, 'incline' = the second, 'both' = alternate.
 */
export function preferredControls(settings, activity = activityOf(settings)) {
  const c = activity.controls;
  if (c.length < 2) return c.slice();
  if (settings.adjustPref === 'incline') return [c[1]];
  if (settings.adjustPref === 'both') return c.slice();
  return [c[0]];
}

export function roundTo(v, dec) {
  const f = Math.pow(10, dec);
  return Math.round(v * f) / f;
}

/** Only the values of this activity's controls, e.g. {speed, incline}. */
export function pickValues(activity, values) {
  const out = {};
  for (const c of activity.controls) out[c.key] = values && Number.isFinite(values[c.key]) ? values[c.key] : null;
  return out;
}

export function sameValues(activity, a, b) {
  return activity.controls.every((c) => (a && a[c.key]) === (b && b[c.key]));
}
