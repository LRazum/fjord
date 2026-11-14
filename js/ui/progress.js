import { t } from '../i18n.js';
import { fmtNum } from '../format.js';
import { esc } from './dom.js';
import { progress } from '../stats.js';
import { trendChartSvg, bindTrendTips } from './chart-svg.js';
import { backHeader, tile, dash } from './views-common.js';

/** Weekly progress. ctx: { onBack(), includeSim, onToggleSim(v) } */
export function renderProgress(root, records, ctx) {
  const list = ctx.includeSim ? records : records.filter((r) => r.source !== 'sim');
  const pr = progress(list);
  const series = (key) => pr.weeks.map((w) => ({ week: w.week, v: w[key] }));

  const chart = (title, key, help, opts) => `
    <section class="card chart-box">
      <h2>${esc(title)}</h2>
      ${trendChartSvg(series(key), { ...opts, label: title })}
      <p class="c-tip" hidden></p>
      ${help ? `<p class="muted small">${esc(help)}</p>` : ''}
    </section>`;

  const rows = pr.weeks
    .slice()
    .reverse()
    .map(
      (w) => `<tr><th>${esc(w.week)}</th><td>${w.workouts}</td><td>${dash(w.avgIntervalPct)}</td><td>${dash(w.timeInZonePct)}</td>
        <td>${w.avgSpeed == null ? '--' : fmtNum(w.avgSpeed, 1)}</td><td>${w.avgIncline == null ? '--' : fmtNum(w.avgIncline, 1)}</td>
        <td>${w.efficiency == null ? '--' : fmtNum(w.efficiency, 1)}</td></tr>`,
    )
    .join('');

  const simCount = records.length - records.filter((r) => r.source !== 'sim').length;

  root.innerHTML = `
    <div class="page">
      ${backHeader(t('nav.progress'))}
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
        ${chart(t('prog.efficiency'), 'efficiency', t('prog.efficiencyHelp'), { decimals: 1, unit: 'km/h' })}
        ${chart(t('prog.intervalPct'), 'avgIntervalPct', t('prog.intervalPctHelp'), { decimals: 0, unit: '%' })}
        ${chart(t('prog.timeInZone'), 'timeInZonePct', '', { decimals: 0, unit: '%' })}
        ${chart(t('prog.speed'), 'avgSpeed', '', { decimals: 1, unit: 'km/h' })}
        ${chart(t('prog.incline'), 'avgIncline', '', { decimals: 1, unit: '%' })}
        <section class="card">
          <h2>${esc(t('prog.table'))}</h2>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>${esc(t('prog.week'))}</th><th>#</th><th>% HRmax</th><th>${esc(t('det.inZone'))} %</th>
                <th>km/h</th><th>%</th><th>${esc(t('prog.effShort'))}</th></tr></thead>
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
  };
  root.onchange = (e) => {
    if (e.target.dataset.action === 'sim') ctx.onToggleSim(e.target.checked);
  };
}
