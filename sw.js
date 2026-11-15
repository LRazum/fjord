// Fjord service worker: network-first (so updates show up right away) with a short
// timeout, falling back to the cache so the app works offline after the first load.
// Bump VERSION when you change the asset list.

const VERSION = 'fjord-v10';
const NETWORK_TIMEOUT_MS = 3000;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/i18n.js',
  './js/settings.js',
  './js/emitter.js',
  './js/workout.js',
  './js/session.js',
  './js/ready.js',
  './js/coaching.js',
  './js/hrmath.js',
  './js/simulator.js',
  './js/format.js',
  './js/wakelock.js',
  './js/charts.js',
  './js/export.js',
  './js/hrparse.js',
  './js/ble.js',
  './js/stats.js',
  './js/backup.js',
  './js/storage.js',
  './js/straps.js',
  './js/activities.js',
  './media/keepawake.mp4',
  './js/ui/dom.js',
  './js/ui/modal.js',
  './js/ui/download.js',
  './js/ui/form.js',
  './js/ui/chart-svg.js',
  './js/ui/views-common.js',
  './js/ui/history.js',
  './js/ui/detail.js',
  './js/ui/progress.js',
  './js/ui/settings-view.js',
  './js/ui/onboarding.js',
  './js/ui/home.js',
  './js/ui/workout-view.js',
  './js/ui/ready-view.js',
  './js/ui/summary.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    // 'no-cache' makes the browser revalidate with the server instead of trusting its
    // HTTP cache (GitHub Pages sends max-age=600), so a reload really gets the new files.
    fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fromNetwork(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
