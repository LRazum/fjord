import { t, LANGUAGES, getLang } from '../i18n.js';
import { esc } from './dom.js';
import { stepper, segmented, bindForm } from './form.js';
import { hasMaxHr } from '../settings.js';
import { strapById, devicesOfKind, deviceFallbackKey } from '../straps.js';
import { ACTIVITIES, activityOf, phaseTargets, targetsPath } from '../activities.js';
import { backHeader, activityName, fmtDate } from './views-common.js';

const PHASES = ['warmup', 'interval', 'recovery', 'cooldown'];

/** Paths whose change alters which fields are shown, so the form is drawn again. */
export const RERENDER_PATHS = ['age', 'maxHr', 'maxHrSource', 'strapModel', 'deviceKind', 'activity', 'intervalPlan'];

function hrStatus(s) {
  if (hasMaxHr(s)) {
    if (s.maxHrSource === 'test') {
      return t('hr.testFrom', { bpm: s.maxHr, date: fmtDate(s.maxHrTest.at), activity: activityName(s.maxHrTest.activity) });
    }
    return t(s.maxHrSource === 'age' ? 'hr.estimated' : 'hr.known', { bpm: s.maxHr });
  }
  return t(s.maxHrSource === 'test' ? 'hr.testPending' : 'hr.unset');
}

/** ctx.testButton: show a "Start the test" button (Settings, not onboarding). */
export function heartRateFields(s, { testButton = false } = {}) {
  const src = s.maxHrSource;
  let input = '';
  if (src === 'known') input = stepper({ label: t('set.maxHr'), path: 'maxHr', value: s.maxHr, step: 1, min: 120, max: 230, unit: 'bpm', nullable: true });
  else if (src === 'age') input = stepper({ label: t('set.age'), path: 'age', value: s.age, step: 1, min: 10, max: 99, hint: t('set.ageHint'), nullable: true });
  return `
    ${segmented({ label: t('hr.choose'), path: 'maxHrSource', value: src,
      options: [['known', t('hr.know')], ['age', t('hr.estimate')], ['test', t('hr.test')]] })}
    ${input}
    <p class="note" data-hr-status>${esc(hrStatus(s))}</p>
    ${src === 'age' ? `<p class="muted small">${esc(t('hr.estimateHelp'))}</p>` : ''}
    ${src === 'test' ? `<p class="muted small">${esc(t('test.about'))}</p><p class="muted small">${esc(t('test.safety'))}</p>` : ''}
    ${src === 'test' && testButton ? `<button class="btn btn-block" data-action="max-test">${esc(t('test.start'))}</button>` : ''}
    ${stepper({ label: t('set.restHr'), path: 'restHr', value: s.restHr, step: 1, min: 30, max: 110, unit: 'bpm', hint: t('set.optional') })}`;
}

export function strapFields(s) {
  const model = strapById(s.strapModel);
  const note = model.kind === 'watch' ? t('watch.note') : model.connections > 1 ? t('strap.twoConnections') : t('strap.oneConnection');
  return `
    ${segmented({ label: t('device.kind'), path: 'deviceKind', value: model.kind,
      options: [['strap', t('device.strap')], ['watch', t('device.watch')]] })}
    ${segmented({
      label: t(model.kind === 'watch' ? 'device.whichWatch' : 'device.whichStrap'),
      path: 'strapModel',
      value: model.id,
      options: devicesOfKind(model.kind).map((m) => [m.id, m.name || t(deviceFallbackKey(m))]),
    })}
    <ul class="tips-list">${model.tips.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ul>
    <p class="note">${esc(note)}</p>`;
}

export function activityFields(s) {
  const a = activityOf(s);
  return `${segmented({ label: '', path: 'activity', value: a.id, options: ACTIVITIES.map((x) => [x.id, t('act.' + x.id)]) })}
    <p class="muted small">${esc(t('act.help.' + a.id))}</p>`;
}

/** Planned machine settings per phase for the current activity (none outdoors). */
export function targetFields(s) {
  const a = activityOf(s);
  if (!a.controls.length) return `<p class="muted small">${esc(t('act.noTargets'))}</p>`;
  const targets = phaseTargets(s);
  const base = targetsPath(a.id);
  return PHASES.map(
    (p) => `
      <div class="field-pair${a.controls.length === 1 ? ' field-pair-one' : ''}">
        <h3>${esc(t('phase.' + p))}</h3>
        ${a.controls.map((c) => stepper({ label: t(c.labelKey), path: `${base}.${p}.${c.key}`, value: targets[p][c.key],
          step: c.setStep, min: c.key === 'speed' ? 1 : c.min, max: c.max, unit: c.unitKey ? t(c.unitKey) : '' })).join('')}
      </div>`,
  ).join('');
}

/** Automatic interval target and the warm-up check (indoor activities only). */
export function planFields(s) {
  if (!activityOf(s).controls.length) return '';
  return `${segmented({ label: t('est.mode'), path: 'intervalPlan', value: s.intervalPlan === 'manual' ? 'manual' : 'auto',
      options: [['auto', t('est.auto')], ['manual', t('est.manual')]] })}
    <p class="muted small">${esc(t('est.help'))}</p>
    ${segmented({ label: t('warm.enabled'), path: 'warmupCheck', value: String(s.warmupCheck !== false),
      options: [['true', t('common.on')], ['false', t('common.off')]] })}
    <p class="muted small">${esc(t('warm.help'))}</p>`;
}

/** Old name, kept for callers that only know the treadmill. */
export const treadmillFields = targetFields;

export function adjustFields(s) {
  const c = activityOf(s).controls;
  const pref = c.length > 1 ? segmented({
    label: t('set.adjustPref'),
    path: 'adjustPref',
    value: s.adjustPref,
    options: [
      ['speed', t(c[0].labelKey)],
      ['incline', t(c[1].labelKey)],
      ['both', t('set.adjust.both')],
    ],
  }) : '';
  return pref + segmented({ label: t('coach.enabled'), path: 'coachingEnabled', value: String(s.coachingEnabled !== false),
    options: [['true', t('common.on')], ['false', t('common.off')]] })
    + `<p class="muted small">${esc(t('coach.help'))}</p>`;
}

/**
 * ctx: { storage, onBack(), onChange(path, value), onLang(lang), exportBackup(), importBackup(file),
 *        exportCsv(), onboarding(), resetAll() }
 */
export function renderSettings(root, s, ctx) {
  const st = s.structure;
  const zoneRow = (p) => `
      <div class="field-pair">
        <h3>${esc(t('phase.' + p))}</h3>
        ${stepper({ label: t('set.zoneLow'), path: `zones.${p}.0`, value: s.zones[p][0], step: 1, min: 40, max: 100, unit: '%' })}
        ${stepper({ label: t('set.zoneHigh'), path: `zones.${p}.1`, value: s.zones[p][1], step: 1, min: 40, max: 100, unit: '%' })}
      </div>`;

  const persisted = ctx.storage && ctx.storage.persisted;

  root.innerHTML = `
    <div class="page">
      ${backHeader(t('nav.settings'))}

      <section class="card">
        <h2>${esc(t('set.language'))}</h2>
        <div class="seg">${LANGUAGES.map(
          (l) => `<button class="seg-btn${l === getLang() ? ' is-on' : ''}" data-action="lang" data-value="${l}">${esc(t('lang.' + l))}</button>`,
        ).join('')}</div>
      </section>

      <section class="card">
        <h2>${esc(t('set.heartRate'))}</h2>
        ${heartRateFields(s, { testButton: true })}
      </section>

      <section class="card">
        <h2>${esc(t('set.profile'))}</h2>
        ${segmented({ label: t('set.sex'), path: 'sex', value: s.sex || '',
          options: [['male', t('set.sex.male')], ['female', t('set.sex.female')]] })}
        ${s.maxHrSource === 'age' ? '' : stepper({ label: t('set.age'), path: 'age', value: s.age, step: 1, min: 10, max: 99, nullable: true })}
        ${stepper({ label: t('set.weight'), path: 'weightKg', value: s.weightKg, step: 0.5, min: 30, max: 250, unit: 'kg', nullable: true })}
        <p class="muted small">${esc(t('set.profileHelp'))}</p>
      </section>

      <section class="card">
        <h2>${esc(t('set.strap'))}</h2>
        ${strapFields(s)}
      </section>

      <section class="card">
        <h2>${esc(t('set.structure'))}</h2>
        ${stepper({ label: t('phase.warmup'), path: 'structure.warmupSec', value: st.warmupSec, step: 0.5, min: 0, max: 30, unit: t('common.min'), kind: 'min' })}
        ${stepper({ label: t('set.intervals'), path: 'structure.intervals', value: st.intervals, step: 1, min: 1, max: 10 })}
        ${stepper({ label: t('set.intervalLen'), path: 'structure.intervalSec', value: st.intervalSec, step: 0.5, min: 0.5, max: 15, unit: t('common.min'), kind: 'min' })}
        ${stepper({ label: t('phase.recovery'), path: 'structure.recoverySec', value: st.recoverySec, step: 0.5, min: 0, max: 10, unit: t('common.min'), kind: 'min' })}
        ${stepper({ label: t('phase.cooldown'), path: 'structure.cooldownSec', value: st.cooldownSec, step: 0.5, min: 0, max: 30, unit: t('common.min'), kind: 'min' })}
      </section>

      <section class="card">
        <h2>${esc(t('set.zones'))}</h2>
        ${PHASES.map(zoneRow).join('')}
      </section>

      <section class="card">
        <h2>${esc(t('set.activity'))}</h2>
        ${activityFields(s)}
      </section>

      <section class="card">
        <h2>${esc(t('set.targets', { activity: activityName(s.activity) }))}</h2>
        ${planFields(s)}
        ${activityOf(s).controls.length ? `<p class="muted small">${esc(t(s.intervalPlan === 'manual' ? 'set.treadmillHelp' : 'est.planHelp'))}</p>` : ''}
        ${targetFields(s)}
      </section>

      <section class="card">
        <h2>${esc(t('set.adjust'))}</h2>
        ${adjustFields(s)}
        ${activityOf(s).id === 'treadmill' ? `
        ${stepper({ label: t('set.speedStep'), path: 'speedStep', value: s.speedStep, step: 0.1, min: 0.1, max: 2, unit: 'km/h' })}
        ${stepper({ label: t('set.inclineStep'), path: 'inclineStep', value: s.inclineStep, step: 0.5, min: 0.5, max: 5, unit: '%' })}` : ''}
      </section>

      <section class="card">
        <h2>${esc(t('set.data'))}</h2>
        <p class="note">${esc(t('set.dataWarning'))}</p>
        ${persisted === false ? `<p class="muted small">${esc(t('set.notPersisted'))}</p>` : ''}
        ${ctx.storage && ctx.storage.backend === 'memory' ? `<p class="note">${esc(t('home.noStorage'))}</p>` : ''}
        <div class="btn-col">
          <button class="btn btn-block" data-action="backup">${esc(t('set.exportBackup'))}</button>
          <label class="btn btn-block file-btn">${esc(t('set.importBackup'))}
            <input type="file" accept="application/json,.json" data-action="import" hidden>
          </label>
          <button class="btn btn-block" data-action="csv">${esc(t('hist.exportCsv'))}</button>
        </div>
      </section>

      <section class="card">
        <h2>${esc(t('set.other'))}</h2>
        <div class="btn-col">
          <button class="btn btn-block" data-action="onboarding">${esc(t('set.runOnboarding'))}</button>
        </div>
        <p class="muted small">${esc(t('set.privacy'))}</p>
      </section>
    </div>`;

  bindForm(root, (path, value) => {
    ctx.onChange(path, value);
    if (RERENDER_PATHS.includes(path)) {
      const y = window.scrollY;
      renderSettings(root, s, ctx);
      window.scrollTo(0, y);
    }
  });

  root.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'back') ctx.onBack();
    else if (a === 'lang') ctx.onLang(b.dataset.value);
    else if (a === 'backup') ctx.exportBackup();
    else if (a === 'csv') ctx.exportCsv();
    else if (a === 'onboarding') ctx.onboarding();
    else if (a === 'max-test' && ctx.startTest) ctx.startTest();
  };
  root.onchange = (e) => {
    if (e.target.dataset.action === 'import' && e.target.files && e.target.files[0]) {
      ctx.importBackup(e.target.files[0]);
      e.target.value = '';
    }
  };
}
