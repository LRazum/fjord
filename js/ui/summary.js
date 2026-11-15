import { t } from '../i18n.js';
import { fmtClock } from '../format.js';
import { esc, toast } from './dom.js';
import { toTcx, exportBaseName } from '../export.js';
import { saveFile } from './download.js';
import { workoutStats } from '../stats.js';
import { tile, dash, recommendationText, rpeButtons, bindRpe, activityName, fmtTargets, vo2Html } from './views-common.js';
import { activityOf } from '../activities.js';

const validMax = (bpm) => Number.isFinite(bpm) && bpm >= 120 && bpm <= 230;

/** The max-test result card: the peak, caveats, and an explicit choice to keep it. */
function testResultHtml(rec, current) {
  const peak = rec.peakHr;
  if (peak == null) return `<section class="card rec-card"><h2>${esc(t('test.result'))}</h2><p>${esc(t('test.noData'))}</p></section>`;
  const maxDone = rec.phases.some((p) => p.type === 'interval' && p.index === 2 && p.end === 'done');
  const running = activityOf(rec.settings).sport === 'Running';
  const notes = [];
  if (!maxDone) notes.push(t('test.endedEarly'));
  if (!running) notes.push(t('test.activityNote', { activity: activityName(rec.activity) }));
  if (rec.source === 'sim') notes.push(t('test.simNote'));
  const action = validMax(peak)
    ? `<div data-rec-actions class="btn-col">
        <button class="btn btn-primary btn-block" data-action="use-test">${esc(t('test.use', { bpm: peak }))}</button>
        <button class="btn btn-block" data-action="skip-test">${esc(t('test.keep'))}</button>
      </div>`
    : `<p class="note">${esc(t('test.outOfRange'))}</p>`;
  return `<section class="card rec-card rec-keep">
      <h2>${esc(t('test.result'))}</h2>
      <p class="test-peak"><b>${peak}</b> bpm</p>
      <p>${esc(t('test.resultText', { bpm: peak }))}</p>
      ${current ? `<p class="muted small">${esc(t('test.current', { current }))}</p>` : ''}
      ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
      ${action}
    </section>`;
}

/**
 * Post-workout screen: key numbers, next-session recommendation, RPE and a note.
 * @param {object} ctx { recommendation, autoPlan, nextEstimate(), vo2, profile, onApply(), onApplyTest(bpm), currentMax,
 *                       onDone(rec), onDetails(rec) }
 */
export function renderSummary(root, rec, ctx) {
  const st = workoutStats(rec);
  const o = st.overall;
  const isTest = rec.kind === 'maxTest';
  const title = isTest ? t('test.done') : rec.finishReason === 'completed' ? t('sum.title') : t('sum.titleEnded');
  const r = ctx.recommendation;

  let recBlock = '';
  let est = null;
  if (isTest) recBlock = testResultHtml(rec, ctx.currentMax);
  else if (r) {
    let action = '';
    // With the automatic plan the next target comes from the history, this workout included.
    est = ctx.autoPlan && ctx.nextEstimate ? ctx.nextEstimate() : null;
    if (est) {
      action = `<p class="note">${esc(t('est.next', { next: fmtTargets(r.activity || rec.activity, est.values), n: est.n }))}</p>`;
    } else if (r.action !== 'none' && r.applicable !== false) {
      action = `<div data-rec-actions class="btn-col">
        <button class="btn btn-block" data-action="apply">${esc(t('rec.apply'))}</button>
        <button class="btn btn-block" data-action="keep-plan">${esc(t('rec.skip'))}</button>
      </div>`;
    }
    recBlock = `<section class="card rec-card rec-${r.action}">
        <h2>${esc(t('rec.title'))}</h2>
        <p>${esc(est && r.action !== 'none' ? recommendationText({ ...r, applicable: false }) : recommendationText(r))}</p>
        ${action}
      </section>`;
  }

  root.innerHTML = `
    <div class="page">
      <header class="brand"><h1>${esc(title)}</h1>
        ${rec.source === 'sim' ? `<p><span class="pill pill-sim">${esc(t('wo.sim'))}</span></p>` : ''}
      </header>
      <div class="tiles">
        ${tile(t('sum.duration'), fmtClock(rec.durationSec))}
        ${isTest ? tile(t('test.peakTile'), dash(rec.peakHr, ' bpm'), t('test.peakSub'))
          : tile(t('sum.intervals'), `${o.intervalsDone}/${o.intervalsPlanned}`)}
        ${tile(t('sum.avgHr'), dash(o.avgHr, ' bpm'))}
        ${tile(t('sum.maxHr'), dash(o.maxHr, ' bpm'))}
        ${isTest ? tile(t('sum.activity'), activityName(rec.activity))
          : tile(t('sum.timeInZone'), dash(o.timeInZonePct, ' %'), o.timeInZoneSec ? fmtClock(o.timeInZoneSec) : '')}
        ${tile(t('sum.hrr'), dash(o.avgHrr60, ' bpm'), t('sum.hrrSub'))}
      </div>
      ${!isTest && ctx.vo2 != null ? `<section class="card vo2-card">
        <h2>${esc(t('vo2.title'))} <span class="h2-sub">${esc(t('vo2.estimated'))}</span></h2>
        ${vo2Html({ value: ctx.vo2 }, ctx.profile || rec.settings, t('vo2.fromWorkout'))}
      </section>` : ''}
      ${recBlock}
      <section class="card">
        <h2>${esc(t('sum.rpe'))}</h2>
        ${rpeButtons(rec.rpe ?? null)}
        <label class="field">
          <span class="field-label">${esc(t('sum.note'))}</span>
          <textarea class="note-input" rows="3" maxlength="1000" placeholder="${esc(t('sum.notePlaceholder'))}">${esc(rec.note || '')}</textarea>
        </label>
      </section>
      <div class="btn-row">
        <button class="btn" data-action="details">${esc(t('sum.details'))}</button>
        <button class="btn" data-action="tcx">${esc(t('sum.exportTcx'))}</button>
      </div>
      <div class="sticky-start">
        <button class="btn btn-primary btn-xl btn-block" data-action="done">${esc(t('sum.save'))}</button>
      </div>
    </div>`;

  const getRpe = bindRpe(root, rec.rpe);
  const collect = () => {
    rec.rpe = getRpe();
    rec.note = root.querySelector('.note-input').value.trim();
    return rec;
  };

  let decided = false;
  root.onclick = async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'done') ctx.onDone(collect());
    else if (a === 'details') ctx.onDetails(collect());
    else if ((a === 'apply' || a === 'keep-plan') && !decided) {
      decided = true;
      if (a === 'apply') ctx.onApply();
      root.querySelector('[data-rec-actions]').innerHTML = `<p class="muted small">${esc(t(a === 'apply' ? 'rec.applied' : 'rec.skipped'))}</p>`;
    } else if ((a === 'use-test' || a === 'skip-test') && !decided) {
      decided = true;
      if (a === 'use-test') ctx.onApplyTest(rec.peakHr);
      root.querySelector('[data-rec-actions]').innerHTML = `<p class="muted small">${esc(a === 'use-test' ? t('test.applied', { bpm: rec.peakHr }) : t('test.notApplied'))}</p>`;
    } else if (a === 'tcx') {
      try {
        const how = await saveFile(exportBaseName(rec) + '.tcx', 'application/vnd.garmin.tcx+xml', toTcx(rec));
        if (how === 'downloaded') toast(t('sum.exported'));
      } catch (_) {
        toast(t('sum.exportFailed'));
      }
    }
  };
}
