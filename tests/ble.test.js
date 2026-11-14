import test from 'node:test';
import assert from 'node:assert/strict';
import { StrapConnection, bluetoothSupported } from '../js/ble.js';

// A minimal fake of the Web Bluetooth objects StrapConnection touches.
class FakeTarget {
  constructor() {
    this.l = {};
  }
  addEventListener(t, f) {
    (this.l[t] = this.l[t] || []).push(f);
  }
  removeEventListener(t, f) {
    this.l[t] = (this.l[t] || []).filter((x) => x !== f);
  }
  fire(t, props = {}) {
    for (const f of (this.l[t] || []).slice()) f({ target: this, ...props });
  }
  count(t) {
    return (this.l[t] || []).length;
  }
}

class FakeChar extends FakeTarget {
  constructor(initial) {
    super();
    this.value = initial;
    this.notifying = false;
  }
  async startNotifications() {
    this.notifying = true;
  }
  async readValue() {
    return this.value;
  }
  push(bytes) {
    this.value = new DataView(new Uint8Array(bytes).buffer);
    this.fire('characteristicvaluechanged');
  }
}

function fakeStrap({ battery = 80, name = 'Polar H10 12345678' } = {}) {
  const hr = new FakeChar();
  const bat = battery == null ? null : new FakeChar(new DataView(new Uint8Array([battery]).buffer));
  const device = new FakeTarget();
  device.name = name;
  device.failNext = 0;
  device.connects = 0;
  device.gatt = {
    connected: false,
    async connect() {
      device.connects++;
      if (device.failNext > 0) {
        device.failNext--;
        throw new Error('NetworkError');
      }
      this.connected = true;
      return server;
    },
    disconnect() {
      this.connected = false;
    },
  };
  const server = {
    async getPrimaryService(s) {
      if (s === 'heart_rate') return { getCharacteristic: async () => hr };
      if (s === 'battery_service' && bat) return { getCharacteristic: async () => bat };
      throw new Error('NotFoundError');
    },
  };
  // Simulate the strap going out of range.
  device.drop = () => {
    device.gatt.connected = false;
    device.fire('gattserverdisconnected');
  };
  return { device, hr, bat };
}

function fakeBluetooth(device) {
  return {
    calls: [],
    cancel: false,
    async requestDevice(opts) {
      this.calls.push(opts);
      if (this.cancel) {
        const e = new Error('User cancelled');
        e.name = 'NotFoundError';
        throw e;
      }
      return device;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function events(conn) {
  const log = [];
  for (const e of ['state', 'disconnect', 'reconnect', 'battery', 'error']) {
    conn.on(e, (d) => log.push(e === 'state' ? `state:${d.state}` : e));
  }
  return log;
}

test('bluetoothSupported: feature detection only', () => {
  assert.equal(bluetoothSupported({}), false);
  assert.equal(bluetoothSupported({ bluetooth: {} }), false);
  assert.equal(bluetoothSupported({ bluetooth: { requestDevice() {} } }), true);
  assert.equal(bluetoothSupported(undefined), false);
});

test('connect: filters by heart_rate service, asks for battery as optional', async () => {
  const { device } = fakeStrap();
  const bt = fakeBluetooth(device);
  const conn = new StrapConnection({ bluetooth: bt });
  assert.equal(await conn.connect(), true);
  assert.deepEqual(bt.calls[0], {
    filters: [{ services: ['heart_rate'] }],
    optionalServices: ['battery_service'],
  });
  assert.equal(conn.state, 'connected');
  assert.equal(conn.name, 'Polar H10 12345678');
});

test('connect: heart rate notifications are parsed and emitted', async () => {
  const { device, hr } = fakeStrap();
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device) });
  const got = [];
  conn.on('hr', (m) => got.push(m));
  await conn.connect();
  assert.equal(hr.notifying, true);
  hr.push([0x16, 142, 0x00, 0x04]); // contact + RR
  hr.push([0x00, 143]);
  assert.deepEqual(got, [
    { bpm: 142, contact: true, energy: null, rr: [1000] },
    { bpm: 143, contact: null, energy: null, rr: [] },
  ]);
});

test('battery level is read when available and updated by notifications', async () => {
  const { device, bat } = fakeStrap({ battery: 64 });
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device) });
  const levels = [];
  conn.on('battery', (b) => levels.push(b.level));
  await conn.connect();
  await tick();
  assert.equal(conn.battery, 64);
  bat.push([63]);
  assert.deepEqual(levels, [64, 63]);
});

test('a strap without battery service still connects', async () => {
  const { device } = fakeStrap({ battery: null });
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device) });
  assert.equal(await conn.connect(), true);
  await tick();
  assert.equal(conn.battery, null);
  assert.equal(conn.state, 'connected');
});

test('closing the picker is reported as cancelled and changes nothing', async () => {
  const { device } = fakeStrap();
  const bt = fakeBluetooth(device);
  bt.cancel = true;
  const conn = new StrapConnection({ bluetooth: bt });
  const errs = [];
  conn.on('error', (e) => errs.push(e.cancelled));
  assert.equal(await conn.connect(), false);
  assert.deepEqual(errs, [true]);
  assert.equal(conn.state, 'idle');
});

test('link loss: emits disconnect, retries automatically, emits reconnect', async () => {
  const { device } = fakeStrap();
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device), retryDelaysMs: [5, 5, 5] });
  const log = events(conn);
  await conn.connect();
  device.failNext = 2; // first two retries fail
  device.drop();
  assert.equal(conn.state, 'reconnecting');
  await wait(60);
  assert.equal(conn.state, 'connected');
  assert.equal(device.connects, 4); // initial + 2 failed + 1 good
  assert.deepEqual(
    log.filter((e) => e !== 'battery'),
    ['state:connecting', 'state:connected', 'state:reconnecting', 'disconnect', 'state:connected', 'reconnect'],
  );
  conn.disconnect();
});

test('manual reconnect goes straight to GATT without the picker', async () => {
  const { device } = fakeStrap();
  const bt = fakeBluetooth(device);
  const conn = new StrapConnection({ bluetooth: bt, retryDelaysMs: [10000] });
  await conn.connect();
  device.drop();
  assert.equal(conn.state, 'reconnecting');
  assert.equal(await conn.reconnect(), true);
  assert.equal(conn.state, 'connected');
  assert.equal(bt.calls.length, 1);
  conn.disconnect();
});

test('no duplicate HR listeners after reconnecting', async () => {
  const { device, hr } = fakeStrap();
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device), retryDelaysMs: [10000] });
  let n = 0;
  conn.on('hr', () => n++);
  await conn.connect();
  device.drop();
  await conn.reconnect();
  device.drop();
  await conn.reconnect();
  hr.push([0x00, 120]);
  assert.equal(n, 1);
  assert.equal(hr.count('characteristicvaluechanged'), 1);
  conn.disconnect();
});

test('disconnect() stops retrying and forgets the strap', async () => {
  const { device } = fakeStrap();
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device), retryDelaysMs: [5] });
  const log = events(conn);
  await conn.connect();
  conn.disconnect();
  assert.equal(conn.state, 'idle');
  assert.equal(device.gatt.connected, false);
  assert.equal(device.count('gattserverdisconnected'), 0);
  device.fire('gattserverdisconnected'); // late event from the stack
  await wait(30);
  assert.equal(conn.state, 'idle');
  assert.ok(!log.includes('disconnect'));
  assert.equal(conn.device, null);
});

test('a failed first connection keeps retrying in the background', async () => {
  const { device } = fakeStrap();
  device.failNext = 1;
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device), retryDelaysMs: [5] });
  assert.equal(await conn.connect(), false);
  assert.equal(conn.state, 'reconnecting');
  await wait(30);
  assert.equal(conn.state, 'connected');
  conn.disconnect();
});

test('a hanging GATT connect times out and is retried', async () => {
  const { device } = fakeStrap();
  const realConnect = device.gatt.connect;
  let hang = true;
  device.gatt.connect = function () {
    if (hang) {
      hang = false;
      return new Promise(() => {});
    }
    return realConnect.call(this);
  };
  const conn = new StrapConnection({ bluetooth: fakeBluetooth(device), retryDelaysMs: [5], connectTimeoutMs: 20 });
  assert.equal(await conn.connect(), false);
  await wait(60);
  assert.equal(conn.state, 'connected');
  conn.disconnect();
});
