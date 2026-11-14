// Parser for the Bluetooth Heart Rate Measurement characteristic (0x2A37). DOM-free.
//
// Byte 0 is a flags field:
//   bit 0    heart rate format: 0 = uint8, 1 = uint16 (little endian)
//   bit 1-2  sensor contact: bit 2 = feature supported, bit 1 = contact detected
//   bit 3    energy expended present (uint16, kJ)
//   bit 4    RR intervals present (one or more uint16, units of 1/1024 s)

/**
 * @param {DataView} view
 * @returns {{ bpm: number, contact: boolean|null, energy: number|null, rr: number[] } | null}
 *          `contact` is null when the strap does not report it; `rr` is in milliseconds.
 *          Returns null for a packet that is too short to hold a heart rate.
 */
export function parseHeartRateMeasurement(view) {
  if (!view || view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  let i = 1;

  let bpm;
  if (flags & 0x01) {
    if (view.byteLength < 3) return null;
    bpm = view.getUint16(i, true);
    i += 2;
  } else {
    bpm = view.getUint8(i);
    i += 1;
  }

  const contact = flags & 0x04 ? !!(flags & 0x02) : null;

  let energy = null;
  if (flags & 0x08) {
    if (i + 2 <= view.byteLength) energy = view.getUint16(i, true);
    i += 2;
  }

  const rr = [];
  if (flags & 0x10) {
    for (; i + 2 <= view.byteLength; i += 2) {
      rr.push(Math.round((view.getUint16(i, true) / 1024) * 1000));
    }
  }

  return { bpm, contact, energy, rr };
}
