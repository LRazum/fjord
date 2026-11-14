import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, sessionsCsv, samplesCsv, makeBackup, parseBackup } from '../js/backup.js';
import { DEFAULT_SETTINGS } from '../js/settings.js';
import { makeRecord } from './helpers.js';

const lines = (csv) => csv.trimEnd().split('\r\n');

test('toCsv: quoting', () => {
  assert.equal(toCsv([['a', 'b,c', 'say "hi"', null, 3]]), 'a,"b,c","say ""hi""",,3\r\n');
  assert.equal(toCsv([['line\nbreak', 'semi;colon']]), '"line\nbreak","semi;colon"\r\n');
});

test('sessionsCsv: one row per workout, oldest first, with notes escaped', () => {
  const a = makeRecord({ startedAt: '2026-11-10T17:00:00.000Z' });
  const b = makeRecord({ startedAt: '2026-11-03T17:00:00.000Z' });
  b.rpe = 8;
  b.note = 'legs heavy, "hot" gym';
  const out = lines(sessionsCsv([a, b]));
  assert.equal(out.length, 3);
  assert.ok(out[0].startsWith('date,start_time_utc,duration_min,'));
  assert.ok(out[1].startsWith('2026-11-03,'));
  assert.ok(out[1].includes(',8,"legs heavy, ""hot"" gym",ble'));
  assert.ok(out[2].startsWith('2026-11-10,'));
  const head = out[0].split(',');
  assert.equal(out[2].split(',').length, head.length);
});

test('samplesCsv: one row per second plus header', () => {
  const rec = makeRecord({ hr: (p, k) => (k === 3 && p.type === 'warmup' ? null : 140) });
  const out = lines(samplesCsv(rec));
  assert.equal(out.length, rec.durationSec + 2);
  assert.equal(out[0], 'second,time_utc,hr_bpm,phase,phase_number,speed_kmh,incline_pct');
  assert.equal(out[1], '0,2026-11-02T17:00:00.000Z,140,warmup,,7.5,1');
  assert.equal(out[4], '3,2026-11-02T17:00:03.000Z,,warmup,,7.5,1');
  assert.equal(out[62], '61,2026-11-02T17:01:01.000Z,140,interval,1,10.5,2');
  assert.ok(out[out.length - 1].startsWith(`${rec.durationSec},`));
});

test('backup round trip', () => {
  const w = makeRecord();
  const text = JSON.stringify(makeBackup({ settings: DEFAULT_SETTINGS, workouts: [w] }, new Date('2026-11-14T10:00:00Z')));
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.equal(r.workouts.length, 1);
  assert.deepEqual(r.workouts[0], JSON.parse(JSON.stringify(w)));
  assert.equal(r.settings.maxHr, DEFAULT_SETTINGS.maxHr);
  assert.equal(r.skipped, 0);
});

test('parseBackup: rejects foreign or broken files, skips bad workouts', () => {
  assert.deepEqual(parseBackup('not json'), { ok: false, error: 'notJson' });
  assert.deepEqual(parseBackup('{"workouts": []}'), { ok: false, error: 'notFjord' });
  assert.deepEqual(parseBackup('{"app":"fjord","format":99,"workouts":[]}'), { ok: false, error: 'newer' });
  const good = makeRecord();
  const r = parseBackup(JSON.stringify({ app: 'fjord', format: 1, workouts: [good, { id: 'x' }, null] }));
  assert.equal(r.ok, true);
  assert.equal(r.workouts.length, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.settings, null);
});

test('parseBackup: old settings are completed with current defaults', () => {
  const r = parseBackup(JSON.stringify({ app: 'fjord', format: 1, settings: { maxHr: 177 }, workouts: [] }));
  assert.equal(r.settings.maxHr, 177);
  assert.deepEqual(r.settings.zones, DEFAULT_SETTINGS.zones);
});
