import { t } from '../i18n.js';
import { fmtClock } from '../format.js';
import { esc } from './dom.js';
import { workoutStats, progress } from '../stats.js';
import { backHeader, fmtDate, fmtTime, tile, dash, activityName } from './views-common.js';

/** List of saved workouts, newest first. ctx: { onBack(), onOpen(id), onProgress(), onExportCsv() } */
export function renderHistory(root, records, ctx) {
  const pr = progress(records);
  const items = records
    .map((rec) => {
      const o = workoutStats(rec).overall;
      const main = rec.kind === 'maxTest'
        ? `<span>${esc(fmtClock(rec.durationSec))}</span><span>${esc(t('test.title'))}</span><span>${esc(t('test.peakShort', { bpm: dash(rec.peakHr) }))}</span>`
        : `<span>${esc(fmtClock(rec.durationSec))}</span>
              <span>${o.intervalsDone}/${o.intervalsPlanned} ${esc(t('hist.intervals'))}</span>
              <span>${esc(dash(o.avgIntervalPct, ' %'))} ${esc(t('hist.hrmax'))}</span>
              <span>${esc(dash(o.timeInZonePct, ' %'))} ${esc(t('hist.inZone'))}</span>`;
      return `
        <li>
          <button class="hist-item" data-open="${esc(rec.id)}">
            <span class="hist-date">${esc(fmtDate(rec.startedAt))} <span class="muted">${esc(fmtTime(rec.startedAt))} · ${esc(activityName(rec.activity || rec.settings.activity))}</span>
              ${rec.source === 'sim' ? `<span class="pill pill-sim">${esc(t('wo.sim'))}</span>` : ''}</span>
            <span class="hist-main">${main}</span>
          </button>
        </li>`;
    })
    .join('');

  root.innerHTML = `
    <div class="page">
      ${backHeader(t('nav.history'))}
      <div class="tiles">
        ${tile(t('prog.total'), String(pr.total))}
        ${tile(t('prog.thisWeek'), String(pr.thisWeek))}
        ${tile(t('prog.streak'), t('prog.weeks', { n: pr.streak.current }), t('prog.best', { n: pr.streak.best }))}
        ${tile(t('prog.intervalTime'), `${pr.intervalMin} ${t('common.min')}`)}
      </div>
      <div class="btn-row">
        <button class="btn" data-action="progress">${esc(t('nav.progress'))}</button>
        <button class="btn" data-action="csv" ${records.length ? '' : 'disabled'}>${esc(t('hist.exportCsv'))}</button>
      </div>
      ${records.length ? `<ul class="hist-list">${items}</ul>` : `<p class="muted empty">${esc(t('hist.empty'))}</p>`}
    </div>`;

  root.onclick = (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return ctx.onOpen(open.dataset.open);
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'back') ctx.onBack();
    else if (b.dataset.action === 'progress') ctx.onProgress();
    else if (b.dataset.action === 'csv') ctx.onExportCsv();
  };
}
