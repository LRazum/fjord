// Export of a finished workout record to other formats. DOM-free.

const xml = (v) =>
  String(v).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

const isoSec = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Cumulative distance (m) and climb (m) at every workout second, integrated from the
 * treadmill settings the user logged.
 */
export function trackSeries(rec) {
  const n = rec.durationSec;
  const log = rec.treadmillLog.slice().sort((a, b) => a.t - b.t);
  const dist = new Array(n + 1).fill(0);
  const climb = new Array(n + 1).fill(0);
  let k = -1;
  for (let s = 1; s <= n; s++) {
    // Setting in force during the second that ends at s.
    while (k + 1 < log.length && log[k + 1].t <= s - 1) k++;
    const speed = k >= 0 ? log[k].speed : 0;
    const incline = k >= 0 ? log[k].incline : 0;
    const step = speed / 3.6;
    dist[s] = dist[s - 1] + step;
    climb[s] = climb[s - 1] + (step * Math.max(0, incline)) / 100;
  }
  return { dist, climb };
}

/**
 * Garmin Training Center XML (TCX). Imports into Strava, Garmin Connect, TrainingPeaks
 * and most other training sites. One lap per phase, one trackpoint per second.
 */
export function toTcx(rec) {
  const start = Date.parse(rec.startedAt);
  const { dist, climb } = trackSeries(rec);
  const st = rec.settings.structure;
  const laps = rec.phases
    .map((p) => ({ type: p.type, s0: Math.round(p.startSec), s1: Math.round(p.endSec ?? rec.durationSec) }))
    .filter((p) => p.s1 > p.s0);

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 ' +
      'http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">',
  );
  out.push(' <Activities>');
  out.push('  <Activity Sport="Running">');
  out.push(`   <Id>${isoSec(start)}</Id>`);

  laps.forEach((lap, i) => {
    const lastLap = i === laps.length - 1;
    // Each second belongs to one lap; the very last point closes the final lap.
    const end = lastLap ? lap.s1 : lap.s1 - 1;
    const hr = [];
    for (let s = lap.s0; s <= end; s++) if (rec.samples[s] != null) hr.push(rec.samples[s]);

    out.push(`   <Lap StartTime="${isoSec(start + lap.s0 * 1000)}">`);
    out.push(`    <TotalTimeSeconds>${lap.s1 - lap.s0}</TotalTimeSeconds>`);
    out.push(`    <DistanceMeters>${(dist[lap.s1] - dist[lap.s0]).toFixed(1)}</DistanceMeters>`);
    out.push('    <Calories>0</Calories>');
    if (hr.length) {
      const avg = Math.round(hr.reduce((a, b) => a + b, 0) / hr.length);
      out.push(`    <AverageHeartRateBpm><Value>${avg}</Value></AverageHeartRateBpm>`);
      out.push(`    <MaximumHeartRateBpm><Value>${Math.max(...hr)}</Value></MaximumHeartRateBpm>`);
    }
    out.push(`    <Intensity>${lap.type === 'recovery' ? 'Resting' : 'Active'}</Intensity>`);
    out.push('    <TriggerMethod>Manual</TriggerMethod>');
    out.push('    <Track>');
    for (let s = lap.s0; s <= end; s++) {
      const bpm = rec.samples[s];
      out.push(
        '     <Trackpoint>' +
          `<Time>${isoSec(start + s * 1000)}</Time>` +
          `<AltitudeMeters>${climb[s].toFixed(1)}</AltitudeMeters>` +
          `<DistanceMeters>${dist[s].toFixed(1)}</DistanceMeters>` +
          (bpm != null ? `<HeartRateBpm><Value>${Math.round(bpm)}</Value></HeartRateBpm>` : '') +
          '</Trackpoint>',
      );
    }
    out.push('    </Track>');
    out.push('   </Lap>');
  });

  const note =
    `Fjord: ${rec.plan.intervals} × ${Math.round(st.intervalSec / 60)} min intervals on a treadmill` +
    (rec.source === 'sim' ? ' (simulated heart rate)' : '');
  out.push(`   <Notes>${xml(note)}</Notes>`);
  out.push('  </Activity>');
  out.push(' </Activities>');
  out.push('</TrainingCenterDatabase>');
  return out.join('\n') + '\n';
}

/** e.g. "fjord-2026-11-14-1432" (UTC), without extension. */
export function exportBaseName(rec) {
  const d = new Date(rec.startedAt).toISOString();
  return `fjord-${d.slice(0, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}`;
}
