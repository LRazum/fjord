// Heart-rate devices: chest straps and watches that broadcast heart rate over the
// standard Bluetooth Heart Rate Service, with short tips (string keys are in i18n.js).
// DOM-free.
//
// Watches only show up in the device picker while their own "broadcast heart rate"
// mode is on. Their optical sensor reacts a few seconds later than a strap and does
// not report skin contact.

export const DEVICE_KINDS = ['strap', 'watch'];

export const STRAPS = [
  { id: 'polar-h10', kind: 'strap', name: 'Polar H10', connections: 2, tips: ['strap.tip.wet', 'strap.tip.polarWake', 'strap.tip.h10two'] },
  { id: 'polar-h9', kind: 'strap', name: 'Polar H9', connections: 1, tips: ['strap.tip.wet', 'strap.tip.polarWake'] },
  { id: 'garmin-hrm-dual', kind: 'strap', name: 'Garmin HRM-Dual', connections: 1, tips: ['strap.tip.wet', 'strap.tip.garminWake', 'strap.tip.garminBle'] },
  { id: 'wahoo-tickr', kind: 'strap', name: 'Wahoo TICKR', connections: 1, tips: ['strap.tip.wet', 'strap.tip.wahooWake'] },
  { id: 'coospo-h6', kind: 'strap', name: 'Coospo H6', connections: 1, tips: ['strap.tip.wet', 'strap.tip.coospoWake'] },
  { id: 'other', kind: 'strap', name: null, connections: 1, tips: ['strap.tip.wet', 'strap.tip.otherWake'] },

  { id: 'garmin-watch', kind: 'watch', name: 'Garmin', connections: 1, tips: ['watch.tip.garmin', 'watch.tip.garminOld', 'watch.tip.snug'] },
  { id: 'polar-watch', kind: 'watch', name: 'Polar', connections: 1, tips: ['watch.tip.polar', 'watch.tip.snug'] },
  { id: 'coros-watch', kind: 'watch', name: 'COROS', connections: 1, tips: ['watch.tip.coros', 'watch.tip.snug'] },
  { id: 'suunto-watch', kind: 'watch', name: 'Suunto', connections: 1, tips: ['watch.tip.suunto', 'watch.tip.snug'] },
  { id: 'apple-watch', kind: 'watch', name: 'Apple Watch', connections: 1, tips: ['watch.tip.apple', 'watch.tip.snug'] },
  { id: 'other-watch', kind: 'watch', name: null, connections: 1, tips: ['watch.tip.other', 'watch.tip.snug'] },
];

export function strapById(id) {
  return STRAPS.find((s) => s.id === id) || STRAPS.find((s) => s.id === 'other');
}

export function devicesOfKind(kind) {
  return STRAPS.filter((s) => s.kind === kind);
}

/** The generic entry of a kind, used when switching between strap and watch. */
export function defaultDevice(kind) {
  return kind === 'watch' ? 'other-watch' : 'other';
}

/** i18n key for a device without a brand name ("Other Bluetooth strap/watch"). */
export function deviceFallbackKey(model) {
  return model.kind === 'watch' ? 'watch.other' : 'strap.other';
}

/** Settings change for the strap/watch switch; returns false for other paths. */
export function updateDeviceSettings(s, path, value) {
  if (path !== 'deviceKind') return false;
  if (DEVICE_KINDS.includes(value) && strapById(s.strapModel).kind !== value) s.strapModel = defaultDevice(value);
  return true;
}
