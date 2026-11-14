import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { keepScreenOn, releaseScreen } from '../js/wakelock.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeLock extends EventTarget {
  constructor() {
    super();
    this.released = false;
    this.releases = 0;
  }

  async release() {
    this.released = true;
    this.releases++;
  }
}

let gesture;
let plays;
let pauses;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

describe('screen lock', () => {
  beforeEach(() => {
    gesture = false;
    plays = [];
    pauses = 0;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        visibilityState: 'visible',
        addEventListener() {},
        removeEventListener() {},
        body: { appendChild() {} },
        createElement() {
          return {
            style: {},
            setAttribute() {},
            addEventListener() {},
            play() { plays.push(gesture); return Promise.resolve(); },
            pause() { pauses++; },
          };
        },
      },
    });
  });

  afterEach(async () => {
    await releaseScreen();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });

  test('wake lock: request runs inside the tap and Cancel releases it', async () => {
    const lock = new FakeLock();
    const calls = [];
    navigator.wakeLock = { request(type) { calls.push([type, gesture]); return Promise.resolve(lock); } };
    gesture = true;
    const pending = keepScreenOn();
    gesture = false;
    assert.equal(await pending, 'lock');
    assert.deepEqual(calls, [['screen', true]]);
    await releaseScreen();
    assert.equal(lock.releases, 1);
  });

  test('wake lock: an acquisition that arrives after Cancel is released without video', async () => {
    const request = deferred();
    const lock = new FakeLock();
    navigator.wakeLock = { request: () => request.promise };
    const pending = keepScreenOn();
    await releaseScreen();
    request.resolve(lock);
    assert.equal(await pending, false);
    assert.equal(lock.releases, 1);
    assert.deepEqual(plays, []);
  });

  test('wake lock: a late release event from an old lock does not forget the new lock', async () => {
    const old = new FakeLock();
    const current = new FakeLock();
    navigator.wakeLock = { request: async () => old };
    await keepScreenOn();
    await releaseScreen();
    navigator.wakeLock.request = async () => current;
    await keepScreenOn();
    old.dispatchEvent(new Event('release'));
    await releaseScreen();
    assert.equal(current.releases, 1);
  });

  test('wake lock: a pending release does not clear a later acquisition', async () => {
    const releasing = deferred();
    const old = new FakeLock();
    old.release = () => releasing.promise;
    const current = new FakeLock();
    navigator.wakeLock = { request: async () => old };
    await keepScreenOn();
    const pending = releaseScreen();
    navigator.wakeLock.request = async () => current;
    await keepScreenOn();
    releasing.resolve();
    await pending;
    await releaseScreen();
    assert.equal(current.releases, 1);
  });

  test('wake lock: a superseded request releases only its own late result', async () => {
    const request = deferred();
    const old = new FakeLock();
    const current = new FakeLock();
    navigator.wakeLock = { request: () => request.promise };
    const pending = keepScreenOn();
    navigator.wakeLock.request = async () => current;
    assert.equal(await keepScreenOn(), 'lock');
    request.resolve(old);
    assert.equal(await pending, false);
    assert.equal(old.releases, 1);
    assert.equal(current.releases, 0);
    await releaseScreen();
    assert.equal(current.releases, 1);
  });

  test('wake lock: a superseded failure does not forget the current lock or start video', async () => {
    const request = deferred();
    const current = new FakeLock();
    navigator.wakeLock = { request: () => request.promise };
    const pending = keepScreenOn();
    navigator.wakeLock.request = async () => current;
    await keepScreenOn();
    request.reject(new Error('denied'));
    assert.equal(await pending, false);
    await releaseScreen();
    assert.equal(current.releases, 1);
    assert.deepEqual(plays, []);
  });

  test('wake lock: without the API, video.play runs inside the tap and Cancel pauses it', async () => {
    gesture = true;
    const pending = keepScreenOn();
    gesture = false;
    assert.equal(await pending, 'video');
    assert.deepEqual(plays, [true]);
    const before = pauses;
    await releaseScreen();
    assert.equal(pauses, before + 1);
  });

  test('wake lock: a rejected API request falls back to video', async () => {
    navigator.wakeLock = { request: async () => { throw new Error('denied'); } };
    assert.equal(await keepScreenOn(), 'video');
    assert.equal(plays.length, 1);
  });
});
