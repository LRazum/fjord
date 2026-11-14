import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHeartRateMeasurement } from '../js/hrparse.js';

const dv = (bytes) => new DataView(new Uint8Array(bytes).buffer);

test('uint8 heart rate, no extras', () => {
  assert.deepEqual(parseHeartRateMeasurement(dv([0x00, 72])), { bpm: 72, contact: null, energy: null, rr: [] });
  assert.equal(parseHeartRateMeasurement(dv([0x00, 255])).bpm, 255);
});

test('uint16 heart rate is little endian', () => {
  assert.equal(parseHeartRateMeasurement(dv([0x01, 0x2c, 0x01])).bpm, 300);
  assert.equal(parseHeartRateMeasurement(dv([0x01, 150, 0])).bpm, 150);
});

test('sensor contact bits', () => {
  assert.equal(parseHeartRateMeasurement(dv([0x00, 80])).contact, null); // not supported
  assert.equal(parseHeartRateMeasurement(dv([0x04, 80])).contact, false); // supported, no contact
  assert.equal(parseHeartRateMeasurement(dv([0x06, 80])).contact, true); // supported, contact
  assert.equal(parseHeartRateMeasurement(dv([0x02, 80])).contact, null); // contact bit alone is ignored
});

test('energy expended (uint16 kJ)', () => {
  const m = parseHeartRateMeasurement(dv([0x08, 140, 0x10, 0x27]));
  assert.equal(m.bpm, 140);
  assert.equal(m.energy, 10000);
  assert.deepEqual(m.rr, []);
});

test('RR intervals in 1/1024 s are converted to ms', () => {
  // 1024 → 1000 ms, 512 → 500 ms
  const m = parseHeartRateMeasurement(dv([0x10, 60, 0x00, 0x04, 0x00, 0x02]));
  assert.equal(m.bpm, 60);
  assert.deepEqual(m.rr, [1000, 500]);
});

test('everything at once: uint16 HR, contact, energy, RR', () => {
  // flags 0x1F = uint16 | contact detected | contact supported | energy | RR
  const m = parseHeartRateMeasurement(dv([0x1f, 0xa0, 0x00, 0x34, 0x12, 0x9a, 0x01, 0x80, 0x01]));
  assert.deepEqual(m, { bpm: 160, contact: true, energy: 0x1234, rr: [400, 375] }); // 410/1024 s, 384/1024 s
});

test('energy flag with RR: RR starts after the energy field', () => {
  const m = parseHeartRateMeasurement(dv([0x18, 150, 0x05, 0x00, 0x00, 0x03]));
  assert.equal(m.energy, 5);
  assert.deepEqual(m.rr, [750]);
});

test('a trailing odd byte in the RR list is ignored', () => {
  const m = parseHeartRateMeasurement(dv([0x10, 70, 0x00, 0x04, 0x7f]));
  assert.deepEqual(m.rr, [1000]);
});

test('truncated packets', () => {
  assert.equal(parseHeartRateMeasurement(dv([])), null);
  assert.equal(parseHeartRateMeasurement(dv([0x00])), null);
  assert.equal(parseHeartRateMeasurement(dv([0x01, 0x50])), null); // uint16 flag, one byte
  assert.equal(parseHeartRateMeasurement(null), null);
  // Energy flag set but field cut off: HR still usable.
  assert.deepEqual(parseHeartRateMeasurement(dv([0x08, 99, 0x01])), { bpm: 99, contact: null, energy: null, rr: [] });
});

test('works on a DataView with an offset into a larger buffer', () => {
  const buf = new Uint8Array([0xff, 0xff, 0x10, 90, 0x00, 0x04, 0xee]).buffer;
  const m = parseHeartRateMeasurement(new DataView(buf, 2, 4));
  assert.deepEqual(m, { bpm: 90, contact: null, energy: null, rr: [1000] });
});
