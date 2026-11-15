import { t, LANGUAGES, getLang } from '../i18n.js';
import { esc } from './dom.js';
import { stepper, segmented, bindForm } from './form.js';
import { hasMaxHr } from '../settings.js';
import { strapById, devicesOfKind, deviceFallbackKey } from '../straps.js';
import { ACTIVITIES, activityOf, phaseTargets, targetsPath } from '../activities.js';
import { backHeader, activityName, fmtDate, maxHrText } from './views-common.js';
import { fmtNum } from '../format.js';

const TIP_URL = 'https://revolut.me/lovrorazum';

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

// Line icons for the menu rows (24×24, stroked with currentColor).
const ICONS = {
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  profile: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.8 4.2-5.7 7.5-5.7s6.1 1.9 7.5 5.7"/>',
  device: '<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9.5 6.5 10 3h4l.5 3.5M9.5 17.5 10 21h4l.5-3.5"/><path d="M10 12h1.2l.8-1.6 1 3.2.8-1.6H14"/>',
  plan: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  structure: '<path d="M5 19v-5M10 19V6M15 19v-5M20 19V6"/>',
  zones: '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l4.2-4.6"/>',
  adjust: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  language: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 3 2.6 14 0 17M12 3.5c-2.6 3-2.6 14 0 17"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  onboarding: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4h-4"/>',
};

const svg = (body, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

/** Subpages, in menu order, with the menu group each belongs to. */
const PAGES = {
  heart: { group: 'you', title: () => t('set.heartRate') },
  profile: { group: 'you', title: () => t('set.profile') },
  device: { group: 'you', title: () => t('set.strap') },
  plan: { group: 'workouts', title: () => t('set.plan') },
  structure: { group: 'workouts', title: () => t('set.structure') },
  zones: { group: 'workouts', title: () => t('set.zones') },
  adjust: { group: 'workouts', title: () => t('set.adjust') },
  language: { group: 'app', title: () => t('set.language') },
  data: { group: 'app', title: () => t('set.data') },
};

const fmtMin = (sec) => {
  const m = sec / 60;
  return `${fmtNum(m, m % 1 ? 1 : 0)} ${t('common.min')}`;
};

/** The one-line summary under each menu row: what is set right now. */
function summary(id, s) {
  switch (id) {
    case 'heart':
      return maxHrText(s);
    case 'profile': {
      const parts = [];
      if (s.sex) parts.push(t('set.sex.' + s.sex));
      if (s.age) parts.push(t('set.ageValue', { n: s.age }));
      if (s.weightKg) parts.push(`${fmtNum(s.weightKg, s.weightKg % 1 ? 1 : 0)} kg`);
      return parts.length ? parts.join(' · ') : t('set.notSet');
    }
    case 'device': {
      const m = strapById(s.strapModel);
      return m.name || t(deviceFallbackKey(m));
    }
    case 'plan':
      return activityName(s.activity);
    case 'structure': {
      const st = s.structure;
      return `${st.intervals} × ${fmtMin(st.intervalSec)} · ${t('phase.recovery')} ${fmtMin(st.recoverySec)}`;
    }
    case 'zones': {
      const z = s.zones.interval;
      return `${t('phase.interval')} ${z[0]}–${z[1]} %`;
    }
    case 'adjust':
      return t(s.coachingEnabled === false ? 'set.coachOff' : 'set.coachOn');
    case 'language':
      return t('lang.' + getLang());
    case 'data':
      return t('set.dataSummary');
    default:
      return '';
  }
}

const row = (id, title, sub, action = 'page') => `
      <button type="button" class="set-row" data-action="${action}" data-page="${id}">
        <span class="set-ico ico-${id}">${svg(ICONS[id])}</span>
        <span class="set-row-text">
          <span class="set-row-title">${esc(title)}</span>
          ${sub ? `<span class="set-row-sub">${esc(sub)}</span>` : ''}
        </span>
        ${action === 'page' ? svg('<path d="M9.5 6l6 6-6 6"/>', 'set-chev') : ''}
      </button>`;

function menuHtml(s) {
  const group = (g, extra = '') => {
    const rows = Object.keys(PAGES).filter((id) => PAGES[id].group === g)
      .map((id) => row(id, PAGES[id].title(), summary(id, s))).join('');
    return `
      <section class="set-group">
        <h2 class="set-group-title">${esc(t('set.group.' + g))}</h2>
        <div class="set-list">${rows}${extra}</div>
      </section>`;
  };
  return `
      ${group('you')}
      ${group('workouts')}
      ${group('app', row('onboarding', t('set.runOnboarding'), '', 'onboarding'))}

      <section class="card card-support">
        <h2>${esc(t('set.support'))}</h2>
        <p class="muted">${esc(t('set.supportText'))}</p>
        <a class="btn btn-block btn-tip" href="${TIP_URL}" target="_blank" rel="noopener">${esc(t('set.supportBtn'))}</a>
      </section>

      <p class="muted small set-foot">${esc(t('set.privacy'))}</p>`;
}

function pageHtml(id, s, ctx) {
  const st = s.structure;
  const card = (body, title = '') => `
      <section class="card">
        ${title ? `<h2>${esc(title)}</h2>` : ''}
        ${body}
      </section>`;
  const zoneRow = (p) => `
      <div class="field-pair">
        <h3>${esc(t('phase.' + p))}</h3>
        ${stepper({ label: t('set.zoneLow'), path: `zones.${p}.0`, value: s.zones[p][0], step: 1, min: 40, max: 100, unit: '%' })}
        ${stepper({ label: t('set.zoneHigh'), path: `zones.${p}.1`, value: s.zones[p][1], step: 1, min: 40, max: 100, unit: '%' })}
      </div>`;

  switch (id) {
    case 'heart':
      return card(heartRateFields(s, { testButton: true }));
    case 'profile':
      return card(`
        ${segmented({ label: t('set.sex'), path: 'sex', value: s.sex || '',
          options: [['male', t('set.sex.male')], ['female', t('set.sex.female')]] })}
        ${s.maxHrSource === 'age' ? '' : stepper({ label: t('set.age'), path: 'age', value: s.age, step: 1, min: 10, max: 99, nullable: true })}
        ${stepper({ label: t('set.weight'), path: 'weightKg', value: s.weightKg, step: 0.5, min: 30, max: 250, unit: 'kg', nullable: true })}
        <p class="muted small">${esc(t('set.profileHelp'))}</p>`);
    case 'device':
      return card(strapFields(s));
    case 'plan':
      return card(activityFields(s), t('set.activity'))
        + card(`
        ${planFields(s)}
        ${activityOf(s).controls.length ? `<p class="muted small">${esc(t(s.intervalPlan === 'manual' ? 'set.treadmillHelp' : 'est.planHelp'))}</p>` : ''}
        ${targetFields(s)}`, t('set.targets', { activity: activityName(s.activity) }));
    case 'structure':
      return card(`
        ${stepper({ label: t('phase.warmup'), path: 'structure.warmupSec', value: st.warmupSec, step: 0.5, min: 0, max: 30, unit: t('common.min'), kind: 'min' })}
        ${stepper({ label: t('set.intervals'), path: 'structure.intervals', value: st.intervals, step: 1, min: 1, max: 10 })}
        ${stepper({ label: t('set.intervalLen'), path: 'structure.intervalSec', value: st.intervalSec, step: 0.5, min: 0.5, max: 15, unit: t('common.min'), kind: 'min' })}
        ${stepper({ label: t('phase.recovery'), path: 'structure.recoverySec', value: st.recoverySec, step: 0.5, min: 0, max: 10, unit: t('common.min'), kind: 'min' })}
        ${stepper({ label: t('phase.cooldown'), path: 'structure.cooldownSec', value: st.cooldownSec, step: 0.5, min: 0, max: 30, unit: t('common.min'), kind: 'min' })}`);
    case 'zones':
      return card(PHASES.map(zoneRow).join(''));
    case 'adjust':
      return card(`
        ${adjustFields(s)}
        ${activityOf(s).id === 'treadmill' ? `
        ${stepper({ label: t('set.speedStep'), path: 'speedStep', value: s.speedStep, step: 0.1, min: 0.1, max: 2, unit: 'km/h' })}
        ${stepper({ label: t('set.inclineStep'), path: 'inclineStep', value: s.inclineStep, step: 0.5, min: 0.5, max: 5, unit: '%' })}` : ''}`);
    case 'language':
      return card(`<div class="seg">${LANGUAGES.map(
        (l) => `<button class="seg-btn${l === getLang() ? ' is-on' : ''}" data-action="lang" data-value="${l}">${esc(t('lang.' + l))}</button>`,
      ).join('')}</div>`);
    case 'data': {
      const persisted = ctx.storage && ctx.storage.persisted;
      return card(`
        <p class="note">${esc(t('set.dataWarning'))}</p>
        ${persisted === false ? `<p class="muted small">${esc(t('set.notPersisted'))}</p>` : ''}
        ${ctx.storage && ctx.storage.backend === 'memory' ? `<p class="note">${esc(t('home.noStorage'))}</p>` : ''}
        <div class="btn-col">
          <button class="btn btn-block" data-action="backup">${esc(t('set.exportBackup'))}</button>
          <label class="btn btn-block file-btn">${esc(t('set.importBackup'))}
            <input type="file" accept="application/json,.json" data-action="import" hidden>
          </label>
          <button class="btn btn-block" data-action="csv">${esc(t('hist.exportCsv'))}</button>
        </div>`);
    }
    default:
      return '';
  }
}

// The open subpage survives re-renders (language switch, import, fields that change the form).
let current = 'menu';
let menuY = 0;

/**
 * Settings is a menu of grouped rows; each row opens a short subpage.
 * ctx: { storage, page?, onBack(), onChange(path, value), onLang(lang), exportBackup(), importBackup(file),
 *        exportCsv(), onboarding(), startTest() }
 * ctx.page opens that subpage ('menu' for the list); without it the last open page is kept.
 */
export function renderSettings(root, s, ctx) {
  if (ctx.page) current = ctx.page;
  if (current !== 'menu' && !PAGES[current]) current = 'menu';
  const page = current;
  const go = (next) => {
    if (page === 'menu') menuY = window.scrollY;
    renderSettings(root, s, { ...ctx, page: next, enter: next === 'menu' ? 'back' : 'in' });
    window.scrollTo(0, next === 'menu' ? menuY : 0);
  };

  const enter = ctx.enter ? ` set-${ctx.enter}` : '';
  root.innerHTML = page === 'menu'
    ? `<div class="page${enter}">${backHeader(t('nav.settings'))}${menuHtml(s)}</div>`
    : `<div class="page${enter}">${backHeader(PAGES[page].title())}${pageHtml(page, s, ctx)}</div>`;

  bindForm(root, (path, value) => {
    ctx.onChange(path, value);
    if (RERENDER_PATHS.includes(path)) {
      const y = window.scrollY;
      renderSettings(root, s, { ...ctx, page, enter: null });
      window.scrollTo(0, y);
    }
  });

  root.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'back') {
      if (page === 'menu') ctx.onBack();
      else go('menu');
    } else if (a === 'page') go(b.dataset.page);
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
