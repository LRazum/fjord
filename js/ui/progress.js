import { t } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc } from './dom.js';
import { progress } from '../stats.js';
import { trendChartSvg, bindTrendTips } from './chart-svg.js';
import { backHeader, tile, dash } from './views-common.js';
import { ACTIVITIES, activityById, activityOf } from '../activities.js';

/**
 * Weekly progress, per activity (machine settings are not comparable across them).
 * ctx: { onBack(), includeSim, onToggleSim(v), activity, onActivity(id) }
 */
export function renderProgress(root, records, ctx) {
  const training = records.filter((r) => r.kind !== 'maxTest');
  const present = ACTIVITIES.filter((a) => training.some((r) => activityOf(r.settings).id === a.id));
  const act = present.find((a) => a.id === ctx.activity) || present[0] || activityById(ctx.activity);
  const mine = training.filter((r) => activityOf(r.settings).id === act.id);
  const list = ctx.includeSim ? mine : mine.filter((r) => r.source !== 'sim');
  const pr = progress(list);
  const series = (key) => pr.weeks.map((w) => ({ week: w.week, v: key.startsWith('avg.') ? w.avg[key.slice(4)] : w[key] }));
  const isTreadmill = act.id === 'treadmill';
  const ctlCharts = isTreadmill ? '' : act.controls.map((c) => chart(
    t('prog.control', { name: t(c.labelKey), unit: c.unit || '' }).replace(' ()', ''), 'avg.' + c.key, '', { decimals: c.dec ? 1 : 0, unit: c.unit })).join('');
  const ctlHead = (isTreadmill ? ['km/h', '%'] : act.controls.map((c) => c.unit || t(c.labelKey)))
    .map((h) => `<th>${esc(h)}</th>`).join('');
  const ctlCells = (w) => (isTreadmill
    ? [[w.avgSpeed, 1], [w.avgIncline, 1]]
    : act.controls.map((c) => [w.avg[c.key], c.dec ? 1 : 0]))
    .map(([v, d]) => `<td>${v == null ? '--' : fmtNum(v, d)}</td>`).join('');
  const picker = present.length > 1 ? `<div class="seg" role="group">${present.map((a) =>
    `<button class="seg-btn${a.id === act.id ? ' is-on' : ''}" data-action="activity" data-value="${a.id}">${esc(t('act.' + a.id))}</button>`).join('')}</div>` : '';

  function chart(title, key, help, opts) {
    return `
    <section class="card chart-box">
      <h2>${esc(title)}</h2>
      ${trendChartSvg(series(key), { ...opts, label: title })}
      <p class="c-tip" hidden></p>
      ${help ? `<p class="muted small">${esc(help)}</p>` : ''}
    </section>`;
  }

  const rows = pr.weeks
    .slice()
    .reverse()
    .map(
      (w) => `<tr><th>${esc(w.week)}</th><td>${w.workouts}</td><td>${dash(w.avgIntervalPct)}</td><td>${dash(w.timeInZonePct)}</td>
        ${ctlCells(w)}${isTreadmill ? `<td>${w.efficiency == null ? '--' : fmtNum(w.efficiency, 1)}</td>` : ''}</tr>`,
    )
    .join('');

  const simCount = mine.length - mine.filter((r) => r.source !== 'sim').length;

  root.innerHTML = `
    <div class="page">
      ${backHeader(t('nav.progress'))}
      ${picker}
      <div class="tiles">
        ${tile(t('prog.total'), String(pr.total))}
        ${tile(t('prog.thisWeek'), String(pr.thisWeek))}
        ${tile(t('prog.streak'), t('prog.weeks', { n: pr.streak.current }), t('prog.best', { n: pr.streak.best }))}
        ${tile(t('prog.intervalTime'), `${pr.intervalMin} ${t('common.min')}`)}
      </div>
      ${
        simCount
          ? `<label class="check"><input type="checkbox" data-action="sim" ${ctx.includeSim ? 'checked' : ''}> ${esc(
              t('prog.includeSim', { n: simCount }),
            )}</label>`
          : ''
      }
      ${
        pr.total
          ? `
        ${isTreadmill ? chart(t('prog.efficiency'), 'efficiency', t('prog.efficiencyHelp'), { decimals: 1, unit: 'km/h' }) : ''}
        ${chart(t('prog.intervalPct'), 'avgIntervalPct', t('prog.intervalPctHelp'), { decimals: 0, unit: '%' })}
        ${chart(t('prog.timeInZone'), 'timeInZonePct', '', { decimals: 0, unit: '%' })}
        ${isTreadmill ? chart(t('prog.speed'), 'avgSpeed', '', { decimals: 1, unit: 'km/h' }) : ''}
        ${isTreadmill ? chart(t('prog.incline'), 'avgIncline', '', { decimals: 1, unit: '%' }) : ''}
        ${ctlCharts}
        <section class="card">
          <h2>${esc(t('prog.table'))}</h2>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>${esc(t('prog.week'))}</th><th>#</th><th>% HRmax</th><th>${esc(t('det.inZone'))} %</th>
                ${ctlHead}${isTreadmill ? `<th>${esc(t('prog.effShort'))}</th>` : ''}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>`
          : `<p class="muted empty">${esc(t('hist.empty'))}</p>`
      }
    </div>`;

  bindTrendTips(root);
  root.onclick = (e) => {
    const b = e.target.closest('[data-action]');
    if (b && b.dataset.action === 'back') ctx.onBack();
    else if (b && b.dataset.action === 'activity' && ctx.onActivity) ctx.onActivity(b.dataset.value);
  };
  root.onchange = (e) => {
    if (e.target.dataset.action === 'sim') ctx.onToggleSim(e.target.checked);
  };
}
