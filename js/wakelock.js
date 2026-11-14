// Keep the screen on during a workout.
//
// 1. Screen Wake Lock API where the browser has it (Firefox, Chromium, recent Safari).
// 2. Otherwise a tiny silent video played off-screen. WebKit keeps the display awake
//    while a video that has an audio track is playing, which is what in-app browsers on
//    iPhone (Bluefy) need. It must be started from a user gesture.
//
// Both are re-established when the page becomes visible again.

let sentinel = null;
let video = null;
let wanted = false;
let generation = 0;

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

async function acquireLock(token = generation) {
  if (!wanted || !wakeLockSupported() || document.visibilityState !== 'visible') return false;
  if (sentinel && !sentinel.released) return true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    // Cancel may happen while the browser is still answering the request.
    if (!wanted || token !== generation) {
      await lock.release();
      return false;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
    });
    return true;
  } catch (_) {
    return false;
  }
}

function playVideo() {
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('title', 'Fjord');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.preload = 'auto';
    video.src = new URL('../media/keepawake.mp4', import.meta.url).href;
    // WebKit does not count media with the `loop` attribute, so loop by seeking.
    video.addEventListener('timeupdate', () => {
      if (video.currentTime > 4) video.currentTime = 0.2 + Math.random() * 0.5;
    });
    video.addEventListener('ended', () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    });
    Object.assign(video.style, {
      position: 'fixed',
      left: '0',
      bottom: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.appendChild(video);
  }
  let p;
  try {
    p = video.play();
  } catch (_) {
    return Promise.resolve(false);
  }
  return p && p.then ? p.then(() => true, () => false) : Promise.resolve(!video.paused);
}

function stopVideo() {
  if (video) video.pause();
}

function onVisibility() {
  if (!wanted || document.visibilityState !== 'visible') return;
  if (wakeLockSupported() && !sentinel) acquireLock();
  else if (video && video.paused) playVideo();
}

/**
 * Ask to keep the screen on. Call it directly from a tap/click handler.
 * Resolves to 'lock', 'video' or false (nothing worked).
 */
export async function keepScreenOn() {
  wanted = true;
  const token = ++generation;
  document.addEventListener('visibilitychange', onVisibility);
  if (!wakeLockSupported()) {
    // Start the video synchronously, while the user gesture is still active.
    const playing = await playVideo();
    return wanted && token === generation && playing ? 'video' : false;
  }
  if (await acquireLock(token)) return 'lock';
  if (!wanted || token !== generation) return false;
  const playing = await playVideo();
  return wanted && token === generation && playing ? 'video' : false;
}

export async function releaseScreen() {
  wanted = false;
  generation++;
  document.removeEventListener('visibilitychange', onVisibility);
  stopVideo();
  const lock = sentinel;
  // Release only this lock; a new Start tap can acquire another while we await it.
  sentinel = null;
  if (lock) {
    try {
      await lock.release();
    } catch (_) {
      /* already released */
    }
  }
}
