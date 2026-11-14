import { t } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');

/** Seconds → "m:ss" or "h:mm:ss". */
export function fmtClock(sec, { ceil = false } = {}) {
  if (sec == null || !isFinite(sec)) return '--:--';
  let s = Math.max(0, ceil ? Math.ceil(sec - 1e-6) : Math.floor(sec));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const nfCache = new Map();
/** Locale-aware number with a fixed number of decimals (Croatian uses a decimal comma). */
export function fmtNum(v, decimals = 0) {
  if (v == null || !isFinite(v)) return '--';
  const locale = t('locale');
  const key = locale + decimals;
  let nf = nfCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    nfCache.set(key, nf);
  }
  return nf.format(v);
}

/** Phase display name, e.g. "Interval 2/4". */
export function phaseName(phase, intervals) {
  if (!phase) return '';
  if (phase.type === 'interval') return t('phase.intervalOf', { n: phase.index, total: intervals });
  if (phase.type === 'recovery') return t('phase.recoveryOf', { n: phase.index, total: intervals - 1 });
  return t('phase.' + phase.type);
}
