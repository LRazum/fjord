// Tested chest straps and short tips (string keys are in i18n.js). DOM-free.

export const STRAPS = [
  { id: 'polar-h10', name: 'Polar H10', connections: 2, tips: ['strap.tip.wet', 'strap.tip.polarWake', 'strap.tip.h10two'] },
  { id: 'polar-h9', name: 'Polar H9', connections: 1, tips: ['strap.tip.wet', 'strap.tip.polarWake'] },
  { id: 'garmin-hrm-dual', name: 'Garmin HRM-Dual', connections: 1, tips: ['strap.tip.wet', 'strap.tip.garminWake', 'strap.tip.garminBle'] },
  { id: 'wahoo-tickr', name: 'Wahoo TICKR', connections: 1, tips: ['strap.tip.wet', 'strap.tip.wahooWake'] },
  { id: 'coospo-h6', name: 'Coospo H6', connections: 1, tips: ['strap.tip.wet', 'strap.tip.coospoWake'] },
  { id: 'other', name: null, connections: 1, tips: ['strap.tip.wet', 'strap.tip.otherWake'] },
];

export function strapById(id) {
  return STRAPS.find((s) => s.id === id) || STRAPS[STRAPS.length - 1];
}
