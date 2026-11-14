// All user-facing strings. English is the default and the fallback; Croatian is optional.
// Kept free of DOM code so it can be imported from node:test.

export const STRINGS = {
  hr: {
    'app.tagline': 'Norveški 4×4 intervali na traci',
    'locale': 'hr-HR',

    'phase.warmup': 'Zagrijavanje',
    'phase.interval': 'Interval',
    'phase.recovery': 'Oporavak',
    'phase.cooldown': 'Hlađenje',
    'phase.intervalOf': 'Interval {n}/{total}',
    'phase.recoveryOf': 'Oporavak {n}/{total}',

    'home.start': 'Započni trening',
    'home.plan': 'Plan treninga',
    'home.planLine': '{w} min zagrijavanje · {n} × {i} min intervali · {r} min oporavak · {c} min hlađenje',
    'home.total': 'Ukupno {min} min',
    'home.maxHr': 'Max puls',
    'home.hrSource': 'Izvor pulsa',
    'home.simulator': 'Simulator',
    'home.noBluetooth': 'Ovaj preglednik nema Web Bluetooth. Za pravi pojas otvori Fjord u aplikaciji Bluefy na iPhoneu (ili u pregledniku temeljenom na Chromiumu). Do tada radi simulator.',
    'home.zones': 'Zone',
    'home.targets': 'Traka (brzina · nagib)',

    'dev.title': 'Za razvoj',
    'dev.timeScale': 'Brzina vremena',
    'dev.simProfile': 'Simulirani trkač',
    'dev.sim.random': 'Nasumično',
    'dev.sim.matched': 'Plan mu točno odgovara',
    'dev.sim.easy': 'Plan mu je prelagan',
    'dev.sim.hard': 'Plan mu je pretežak',

    'wo.total': 'Ukupno',
    'wo.left': 'preostalo',
    'wo.speed': 'Brzina',
    'wo.incline': 'Nagib',
    'wo.targetSpeed': 'Ciljna brzina',
    'wo.targetIncline': 'Ciljni nagib',
    'wo.zone.below': 'Ispod zone',
    'wo.zone.in': 'U zoni',
    'wo.zone.above': 'Iznad zone',
    'wo.set': 'postavljeno',
    'wo.kmh': 'km/h',
    'wo.pct': '%',
    'wo.bpm': 'bpm',
    'wo.pctMax': '{pct} % HRmax',
    'wo.zone': 'zona {lo}–{hi} bpm',
    'wo.zonePct': '({lo}–{hi} %)',
    'wo.pause': 'Pauza',
    'wo.resume': 'Nastavi',
    'wo.skip': 'Preskoči',
    'wo.skipConfirm': 'Još jednom',
    'wo.end': 'Završi',
    'wo.paused': 'PAUZA',
    'wo.endTitle': 'Završiti trening?',
    'wo.endText': 'Trening će se spremiti s dosadašnjim podacima.',
    'wo.endYes': 'Završi trening',
    'wo.cancel': 'Odustani',
    'wo.noWakeLock': 'Zaslon se možda ugasi: preglednik ga ne može držati upaljenim. Isključi automatsko zaključavanje ili povremeno dodirni zaslon.',
    'wo.sim': 'SIM',

    'sum.title': 'Trening završen',
    'sum.titleEnded': 'Trening prekinut',
    'sum.duration': 'Trajanje',
    'sum.avgHr': 'Prosječni puls',
    'sum.maxHr': 'Maksimalni puls',
    'sum.intervals': 'Odrađeni intervali',
    'sum.done': 'Gotovo',
    'sum.exportTcx': 'Izvezi TCX (Strava, Garmin)',
    'sum.exported': 'TCX datoteka je spremljena.',
    'sum.exportFailed': 'Izvoz nije uspio.',

    'common.min': 'min',
    'common.on': 'Uključeno',
    'common.off': 'Isključeno',
  },

  en: {
    'app.tagline': 'Norwegian 4×4 treadmill intervals',
    'locale': 'en-GB',

    'phase.warmup': 'Warm-up',
    'phase.interval': 'Interval',
    'phase.recovery': 'Recovery',
    'phase.cooldown': 'Cool-down',
    'phase.intervalOf': 'Interval {n}/{total}',
    'phase.recoveryOf': 'Recovery {n}/{total}',

    'home.start': 'Start workout',
    'home.plan': 'Workout plan',
    'home.planLine': '{w} min warm-up · {n} × {i} min intervals · {r} min recovery · {c} min cool-down',
    'home.total': 'Total {min} min',
    'home.maxHr': 'Max HR',
    'home.hrSource': 'Heart rate source',
    'home.simulator': 'Simulator',
    'home.noBluetooth': 'This browser has no Web Bluetooth. For a real strap, open Fjord in the Bluefy app on iPhone (or a Chromium-based browser). Until then the simulator is used.',
    'home.zones': 'Zones',
    'home.targets': 'Treadmill (speed · incline)',

    'dev.title': 'Developer',
    'dev.timeScale': 'Time speed',
    'dev.simProfile': 'Simulated runner',
    'dev.sim.random': 'Random',
    'dev.sim.matched': 'Plan fits exactly',
    'dev.sim.easy': 'Plan is too easy',
    'dev.sim.hard': 'Plan is too hard',

    'wo.total': 'Total',
    'wo.left': 'left',
    'wo.speed': 'Speed',
    'wo.incline': 'Incline',
    'wo.targetSpeed': 'Target speed',
    'wo.targetIncline': 'Target incline',
    'wo.zone.below': 'Below zone',
    'wo.zone.in': 'In zone',
    'wo.zone.above': 'Above zone',
    'wo.set': 'set',
    'wo.kmh': 'km/h',
    'wo.pct': '%',
    'wo.bpm': 'bpm',
    'wo.pctMax': '{pct}% HRmax',
    'wo.zone': 'zone {lo}–{hi} bpm',
    'wo.zonePct': '({lo}–{hi}%)',
    'wo.pause': 'Pause',
    'wo.resume': 'Resume',
    'wo.skip': 'Skip',
    'wo.skipConfirm': 'Tap again',
    'wo.end': 'End',
    'wo.paused': 'PAUSED',
    'wo.endTitle': 'End workout?',
    'wo.endText': 'The workout will be saved with the data so far.',
    'wo.endYes': 'End workout',
    'wo.cancel': 'Cancel',
    'wo.noWakeLock': 'The screen may turn off: this browser cannot keep it on. Disable auto-lock or tap the screen now and then.',
    'wo.sim': 'SIM',

    'sum.title': 'Workout complete',
    'sum.titleEnded': 'Workout ended',
    'sum.duration': 'Duration',
    'sum.avgHr': 'Average HR',
    'sum.maxHr': 'Max HR',
    'sum.intervals': 'Intervals done',
    'sum.done': 'Done',
    'sum.exportTcx': 'Export TCX (Strava, Garmin)',
    'sum.exported': 'TCX file saved.',
    'sum.exportFailed': 'Export failed.',

    'common.min': 'min',
    'common.on': 'On',
    'common.off': 'Off',
  },
};

export const LANGUAGES = ['en', 'hr'];

let current = 'en';

export function setLang(lang) {
  current = STRINGS[lang] ? lang : 'en';
  return current;
}

export function getLang() {
  return current;
}

/** Translate `key`, replacing {name} placeholders from `params`. */
export function t(key, params) {
  const s = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
}
