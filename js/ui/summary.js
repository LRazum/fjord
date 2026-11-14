import { t } from '../i18n.js';
import { fmtClock } from '../format.js';
import { esc, toast } from './dom.js';
import { toTcx, exportBaseName } from '../export.js';
import { saveFile } from './download.js';

function basicStats(rec) {
  const hr = rec.samples.filter((v) => v != null);
  const avg = hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null;
  const max = hr.length ? Math.max(...hr) : null;
  const intervals = rec.phases.filter((p) => p.type === 'interval' && p.end === 'done').length;
  return { avg, max, intervals };
}

/** Post-workout screen. Milestone 4 extends this with RPE, notes and full stats. */
export function renderSummary(root, rec, on) {
  const s = basicStats(rec);
  const title = rec.finishReason === 'completed' ? t('sum.title') : t('sum.titleEnded');
  const tile = (label, value) =>
    `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div></div>`;

  root.innerHTML = `
    <div class="page">
      <header class="brand"><h1>${esc(title)}</h1></header>
      <div class="tiles">
        ${tile(t('sum.duration'), fmtClock(rec.durationSec))}
        ${tile(t('sum.intervals'), `${s.intervals}/${rec.plan.intervals}`)}
        ${tile(t('sum.avgHr'), s.avg == null ? '--' : `${s.avg} bpm`)}
        ${tile(t('sum.maxHr'), s.max == null ? '--' : `${s.max} bpm`)}
      </div>
      <button class="btn btn-block" data-action="tcx">${esc(t('sum.exportTcx'))}</button>
      <div class="sticky-start">
        <button class="btn btn-primary btn-xl btn-block" data-action="done">${esc(t('sum.done'))}</button>
      </div>
    </div>`;
  root.onclick = async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'done') on.done();
    else if (b.dataset.action === 'tcx') {
      try {
        const how = await saveFile(exportBaseName(rec) + '.tcx', 'application/vnd.garmin.tcx+xml', toTcx(rec));
        if (how === 'downloaded') toast(t('sum.exported'));
      } catch (_) {
        toast(t('sum.exportFailed'));
      }
    }
  };
}
