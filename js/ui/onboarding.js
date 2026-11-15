import { t, LANGUAGES, getLang } from '../i18n.js';
import { esc } from './dom.js';
import { bindForm, setPath } from './form.js';
import { hasMaxHr, maxHrTestPending, updateHeartRateSettings } from '../settings.js';
import { updateDeviceSettings } from '../straps.js';
import { activityOf } from '../activities.js';
import { heartRateFields, strapFields, activityFields, targetFields, adjustFields, RERENDER_PATHS } from './settings-view.js';

const STEPS = ['welcome', 'strap', 'heart', 'activity', 'adjust'];

// Choosing the max HR test is a valid answer: the home screen then offers the test.
const heartDone = (d) => hasMaxHr(d) || maxHrTestPending(d);

/**
 * First-launch setup. Works on a draft copy of the settings; nothing is saved until
 * the last step. ctx: { btSupported, onLang(lang), onFinish(draft), onSkip?() }
 */
export function renderOnboarding(root, draft, ctx, step = 0) {
  const name = STEPS[step];
  let body = '';
  if (name === 'welcome') {
    body = `
      <h1>${esc(t('onb.welcomeTitle'))}</h1>
      <p>${esc(t('onb.welcomeText'))}</p>
      <ul class="tips-list">
        <li>${esc(t('onb.point1'))}</li>
        <li>${esc(t('onb.point2'))}</li>
        <li>${esc(t('onb.point3'))}</li>
      </ul>
      <p class="muted small">${esc(t('set.privacy'))}</p>
      <div class="field">
        <span class="field-label">${esc(t('set.language'))}</span>
        <div class="seg">${LANGUAGES.map(
          (l) => `<button class="seg-btn${l === getLang() ? ' is-on' : ''}" data-action="lang" data-value="${l}">${esc(t('lang.' + l))}</button>`,
        ).join('')}</div>
      </div>
      ${ctx.btSupported ? '' : `<p class="note">${esc(t('home.noBluetooth'))}</p>`}`;
  } else if (name === 'strap') {
    body = `<h1>${esc(t('onb.strapTitle'))}</h1><p>${esc(t('onb.strapText'))}</p>${strapFields(draft)}`;
  } else if (name === 'heart') {
    body = `<h1>${esc(t('onb.heartTitle'))}</h1><p>${esc(t('onb.heartText'))}</p>${heartRateFields(draft)}
      ${draft.maxHrSource === 'test' ? `<p class="note">${esc(t('onb.testLater'))}</p>` : ''}`;
  } else if (name === 'activity') {
    body = `<h1>${esc(t('onb.activityTitle'))}</h1><p>${esc(t('onb.activityText'))}</p>${activityFields(draft)}
      ${activityOf(draft).controls.length ? `<p>${esc(t('onb.treadText'))}</p>` : ''}${targetFields(draft)}`;
  } else {
    body = `<h1>${esc(t('onb.adjustTitle'))}</h1><p>${esc(t('onb.adjustText'))}</p>${adjustFields(draft)}
      <p class="muted small">${esc(t('onb.editLater'))}</p>`;
  }

  const last = step === STEPS.length - 1;
  root.innerHTML = `
    <div class="page onb">
      <div class="onb-steps" aria-label="${esc(t('onb.stepOf', { n: step + 1, total: STEPS.length }))}">
        ${STEPS.map((_, i) => `<i class="${i < step ? 'done' : i === step ? 'cur' : ''}"></i>`).join('')}
      </div>
      <section class="onb-body">${body}</section>
      <div class="sticky-start btn-row">
        ${step > 0 ? `<button class="btn btn-xl" data-action="prev">${esc(t('onb.back'))}</button>` : ''}
        <button class="btn btn-primary btn-xl" data-action="next" ${name === 'heart' && !heartDone(draft) ? 'disabled' : ''}>${esc(last ? t('onb.finish') : t('onb.next'))}</button>
      </div>
    </div>`;

  bindForm(root, (path, value) => {
    if (path === 'coachingEnabled') value = value === 'true';
    if (!updateHeartRateSettings(draft, path, value) && !updateDeviceSettings(draft, path, value)) setPath(draft, path, value);
    if (RERENDER_PATHS.includes(path)) renderOnboarding(root, draft, ctx, step);
  });

  root.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'lang') {
      draft.lang = b.dataset.value;
      ctx.onLang(draft.lang);
      renderOnboarding(root, draft, ctx, step);
    } else if (a === 'prev') {
      renderOnboarding(root, draft, ctx, step - 1);
      window.scrollTo(0, 0);
    } else if (a === 'next') {
      if (name === 'heart' && !heartDone(draft)) return;
      if (last) ctx.onFinish(draft);
      else {
        renderOnboarding(root, draft, ctx, step + 1);
        window.scrollTo(0, 0);
      }
    }
  };
}
