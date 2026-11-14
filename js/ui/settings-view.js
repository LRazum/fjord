import { t, LANGUAGES, getLang } from '../i18n.js';
import { esc } from './dom.js';
import { stepper, segmented, bindForm } from './form.js';
import { hasMaxHr } from '../settings.js';
import { STRAPS, strapById } from '../straps.js';
import { backHeader } from './views-common.js';

const PHASES = ['warmup', 'interval', 'recovery', 'cooldown'];

export function heartRateFields(s) {
  return `
    ${segmented({ label: t('hr.choose'), path: 'maxHrSource', value: s.maxHrSource,
      options: [['known', t('hr.know')], ['age', t('hr.estimate')]] })}
    ${s.maxHrSource === 'known'
      ? stepper({ label: t('set.maxHr'), path: 'maxHr', value: s.maxHr, step: 1, min: 120, max: 230, unit: 'bpm', nullable: true })
      : s.maxHrSource === 'age'
        ? stepper({ label: t('set.age'), path: 'age', value: s.age, step: 1, min: 10, max: 99, hint: t('set.ageHint'), nullable: true }) : ''}
    <p class="note" data-hr-status>${esc(hasMaxHr(s) ? t(s.maxHrSource === 'age' ? 'hr.estimated' : 'hr.known', { bpm: s.maxHr }) : t('hr.unset'))}</p>
    ${s.maxHrSource === 'age' ? `<p class="muted small">${esc(t('hr.estimateHelp'))}</p>` : ''}
    ${stepper({ label: t('set.restHr'), path: 'restHr', value: s.restHr, step: 1, min: 30, max: 110, unit: 'bpm', hint: t('set.optional') })}`;
}

export function strapFields(s) {
  const model = strapById(s.strapModel);
  return `
    ${segmented({
      label: '',
      path: 'strapModel',
      value: s.strapModel,
      options: STRAPS.map((m) => [m.id, m.name || t('strap.other')]),
    })}
    <ul class="tips-list">${model.tips.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ul>
    <p class="note">${esc(model.connections > 1 ? t('strap.twoConnections') : t('strap.oneConnection'))}</p>`;
}

export function treadmillFields(s) {
  return PHASES.map(
    (p) => `
      <div class="field-pair">
        <h3>${esc(t('phase.' + p))}</h3>
        ${stepper({ label: t('wo.speed'), path: `treadmill.${p}.speed`, value: s.treadmill[p].speed, step: 0.1, min: 1, max: 25, unit: 'km/h' })}
        ${stepper({ label: t('wo.incline'), path: `treadmill.${p}.incline`, value: s.treadmill[p].incline, step: 0.5, min: -3, max: 20, unit: '%' })}
      </div>`,
  ).join('');
}

export function adjustFields(s) {
  return segmented({
    label: t('set.adjustPref'),
    path: 'adjustPref',
    value: s.adjustPref,
    options: [
      ['speed', t('set.adjust.speed')],
      ['incline', t('set.adjust.incline')],
      ['both', t('set.adjust.both')],
    ],
  }) + segmented({ label: t('coach.enabled'), path: 'coachingEnabled', value: String(s.coachingEnabled !== false),
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
        ${heartRateFields(s)}
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
        <h2>${esc(t('set.treadmill'))}</h2>
        <p class="muted small">${esc(t('set.treadmillHelp'))}</p>
        ${treadmillFields(s)}
      </section>

      <section class="card">
        <h2>${esc(t('set.adjust'))}</h2>
        ${adjustFields(s)}
        ${stepper({ label: t('set.speedStep'), path: 'speedStep', value: s.speedStep, step: 0.1, min: 0.1, max: 2, unit: 'km/h' })}
        ${stepper({ label: t('set.inclineStep'), path: 'inclineStep', value: s.inclineStep, step: 0.5, min: 0.5, max: 5, unit: '%' })}
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
    if (['age', 'maxHr', 'maxHrSource', 'strapModel'].includes(path)) {
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
  };
  root.onchange = (e) => {
    if (e.target.dataset.action === 'import' && e.target.files && e.target.files[0]) {
      ctx.importBackup(e.target.files[0]);
      e.target.value = '';
    }
  };
}
