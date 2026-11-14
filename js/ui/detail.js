import { t } from '../i18n.js';
import { fmtClock, fmtNum } from '../format.js';
import { esc, toast } from './dom.js';
import { workoutStats, recommendNext } from '../stats.js';
import { toTcx, exportBaseName } from '../export.js';
import { samplesCsv } from '../backup.js';
import { saveFile } from './download.js';
import { workoutChartSvg, bindWorkoutChart } from './chart-svg.js';
import { backHeader, fmtDate, fmtTime, tile, dash, rpeButtons, bindRpe, recommendationText } from './views-common.js';
import { confirmDialog } from './modal.js';

const num1 = (v) => (v == null ? '--' : fmtNum(v, 1));

/** One saved workout. ctx: { onBack(), onSave(rec), onDelete(rec) } */
export function renderDetail(root, rec, ctx) {
  const st = workoutStats(rec);
  const o = st.overall;
  const { svg, geometry } = workoutChartSvg(rec, st.phases);

  const intervalRows = st.intervals
    .map(
      (p) => `<tr>
        <th>${p.index}${p.end === 'skipped' ? '*' : ''}</th>
        <td>${dash(p.avgHr)}</td><td>${dash(p.maxHr)}</td>
        <td>${p.timeInZonePct == null ? '--' : `${fmtClock(p.timeInZoneSec)} <span class="muted">${p.timeInZonePct} %</span>`}</td>
        <td>${p.timeToZoneSec == null ? '--' : fmtClock(p.timeToZoneSec)}</td>
        <td>${num1(p.avgSpeed)}</td><td>${num1(p.avgIncline)}</td>
        <td>${p.last2Pct == null ? '--' : fmtNum(p.last2Pct, 0) + ' %'}</td>
      </tr>`,
    )
    .join('');

  const phaseRows = st.phases
    .map(
      (p) => `<tr>
        <th>${esc(t('phase.' + p.type))}${p.index ? ' ' + p.index : ''}</th>
        <td>${fmtClock(p.durationSec)}</td>
        <td>${dash(p.avgHr)}</td><td>${dash(p.minHr)}</td><td>${dash(p.maxHr)}</td>
        <td>${p.hrr60 == null ? '' : '−' + p.hrr60}</td>
      </tr>`,
    )
    .join('');

  const r = recommendNext(rec, st);

  root.innerHTML = `
    <div class="page page-wide">
      ${backHeader(fmtDate(rec.startedAt, { year: 'numeric' }))}
      <p class="muted">${esc(fmtTime(rec.startedAt))} · ${esc(rec.finishReason === 'completed' ? t('det.completed') : t('det.ended'))}
        ${rec.source === 'sim' ? ` · <span class="pill pill-sim">${esc(t('wo.sim'))}</span>` : ''}</p>

      <div class="tiles tiles-3">
        ${tile(t('sum.duration'), fmtClock(rec.durationSec))}
        ${tile(t('sum.intervals'), `${o.intervalsDone}/${o.intervalsPlanned}`)}
        ${tile(t('sum.timeInZone'), dash(o.timeInZonePct, ' %'))}
        ${tile(t('sum.avgHr'), dash(o.avgHr, ' bpm'))}
        ${tile(t('sum.maxHr'), dash(o.maxHr, ' bpm'))}
        ${tile(t('det.efficiency'), o.efficiency == null ? '--' : fmtNum(o.efficiency, 1) + ' km/h', t('det.efficiencySub'))}
      </div>

      <section class="card chart-box">
        <h2>${esc(t('det.hrChart'))}</h2>
        ${svg}
        <p class="c-tip" hidden></p>
        <p class="muted small">${esc(t('det.chartHelp', { max: rec.settings.maxHr }))}</p>
      </section>

      <section class="card">
        <h2>${esc(t('det.intervals'))}</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>#</th><th>${esc(t('det.avg'))}</th><th>${esc(t('det.max'))}</th><th>${esc(t('det.inZone'))}</th>
              <th>${esc(t('det.toZone'))}</th><th>km/h</th><th>%</th><th>${esc(t('det.last2'))}</th></tr></thead>
            <tbody>${intervalRows}</tbody>
          </table>
        </div>
        ${st.intervals.some((p) => p.end === 'skipped') ? `<p class="muted small">* ${esc(t('det.skipped'))}</p>` : ''}
      </section>

      <section class="card">
        <h2>${esc(t('det.phases'))}</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th></th><th>${esc(t('det.time'))}</th><th>${esc(t('det.avg'))}</th><th>${esc(t('det.min'))}</th>
              <th>${esc(t('det.max'))}</th><th>${esc(t('det.hrr'))}</th></tr></thead>
            <tbody>${phaseRows}</tbody>
          </table>
        </div>
        <p class="muted small">${esc(t('det.hrrHelp'))}</p>
      </section>

      <section class="card">
        <h2>${esc(t('rec.title'))}</h2>
        <p>${esc(recommendationText(r))}</p>
      </section>

      <section class="card">
        <h2>${esc(t('sum.rpe'))}</h2>
        ${rpeButtons(rec.rpe ?? null)}
        <label class="field">
          <span class="field-label">${esc(t('sum.note'))}</span>
          <textarea class="note-input" rows="3" maxlength="1000">${esc(rec.note || '')}</textarea>
        </label>
        <button class="btn btn-block" data-action="save">${esc(t('det.saveNote'))}</button>
      </section>

      <div class="btn-row">
        <button class="btn" data-action="tcx">${esc(t('sum.exportTcx'))}</button>
        <button class="btn" data-action="csv">${esc(t('det.exportCsv'))}</button>
      </div>
      <button class="btn btn-danger btn-block" data-action="delete">${esc(t('det.delete'))}</button>
    </div>`;

  bindWorkoutChart(root.querySelector('.chart-box'), rec, geometry, st.phases);
  const getRpe = bindRpe(root, rec.rpe);

  root.onclick = async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'back') ctx.onBack();
    else if (a === 'save') {
      rec.rpe = getRpe();
      rec.note = root.querySelector('.note-input').value.trim();
      await ctx.onSave(rec);
      toast(t('det.saved'));
    } else if (a === 'tcx') {
      await exportFile(exportBaseName(rec) + '.tcx', 'application/vnd.garmin.tcx+xml', () => toTcx(rec));
    } else if (a === 'csv') {
      await exportFile(exportBaseName(rec) + '.csv', 'text/csv', () => samplesCsv(rec));
    } else if (a === 'delete') {
      const ok = await confirmDialog({
        title: t('det.deleteTitle'),
        text: t('det.deleteText'),
        yes: t('det.delete'),
        no: t('wo.cancel'),
        danger: true,
      });
      if (ok) ctx.onDelete(rec);
    }
  };
}

async function exportFile(name, mime, make) {
  try {
    const how = await saveFile(name, mime, make());
    if (how === 'downloaded') toast(t('common.saved', { name }));
  } catch (_) {
    toast(t('sum.exportFailed'));
  }
}
