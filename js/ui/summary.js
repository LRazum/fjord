import { t } from '../i18n.js';
import { fmtClock } from '../format.js';
import { esc, toast } from './dom.js';
import { toTcx, exportBaseName } from '../export.js';
import { saveFile } from './download.js';
import { workoutStats } from '../stats.js';
import { tile, dash, recommendationText, rpeButtons, bindRpe } from './views-common.js';

/**
 * Post-workout screen: key numbers, next-session recommendation, RPE and a note.
 * @param {object} ctx { recommendation, applied, onApply(), onDone(rec), onDetails(rec) }
 */
export function renderSummary(root, rec, ctx) {
  const st = workoutStats(rec);
  const o = st.overall;
  const title = rec.finishReason === 'completed' ? t('sum.title') : t('sum.titleEnded');
  const r = ctx.recommendation;

  let recBlock = '';
  if (r) {
    let action = '';
    if (r.action === 'harder' || r.action === 'easier') {
      action = ctx.applied
        ? `<p class="muted small">${esc(t('rec.applied'))}</p>`
        : `<button class="btn btn-block" data-action="apply">${esc(t('rec.apply'))}</button>`;
    }
    recBlock = `<section class="card rec-card rec-${r.action}">
        <h2>${esc(t('rec.title'))}</h2>
        <p>${esc(recommendationText(r))}</p>
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
        ${tile(t('sum.intervals'), `${o.intervalsDone}/${o.intervalsPlanned}`)}
        ${tile(t('sum.avgHr'), dash(o.avgHr, ' bpm'))}
        ${tile(t('sum.maxHr'), dash(o.maxHr, ' bpm'))}
        ${tile(t('sum.timeInZone'), dash(o.timeInZonePct, ' %'), o.timeInZoneSec ? fmtClock(o.timeInZoneSec) : '')}
        ${tile(t('sum.hrr'), dash(o.avgHrr60, ' bpm'), t('sum.hrrSub'))}
      </div>
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

  root.onclick = async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'done') ctx.onDone(collect());
    else if (a === 'details') ctx.onDetails(collect());
    else if (a === 'apply') {
      ctx.onApply();
      b.outerHTML = `<p class="muted small">${esc(t('rec.applied'))}</p>`;
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
