// Bluetooth chest strap connection over the standard Heart Rate Service.
// No DOM code; the Bluetooth object is injectable so this can be tested with a fake.

import { Emitter } from './emitter.js';
import { parseHeartRateMeasurement } from './hrparse.js';

/** Feature detection. Firefox has no Web Bluetooth; Bluefy and Chromium do. */
export function bluetoothSupported(nav = globalThis.navigator) {
  return !!(nav && nav.bluetooth && typeof nav.bluetooth.requestDevice === 'function');
}

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      reject(new Error('timeout'));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * States: 'idle' (nothing selected) → 'connecting' → 'connected'
 *         'connected' → 'reconnecting' (link lost, retrying automatically) → 'connected'
 *
 * Events: 'state' {state, name}, 'hr' {bpm, rr, contact, energy}, 'battery' {level},
 *         'disconnect' {} (link lost while we wanted it), 'reconnect' {}, 'error' {error, cancelled}.
 */
export class StrapConnection extends Emitter {
  constructor({
    bluetooth = globalThis.navigator && globalThis.navigator.bluetooth,
    retryDelaysMs = [1000, 2000, 4000, 8000, 15000],
    connectTimeoutMs = 15000,
  } = {}) {
    super();
    this.bluetooth = bluetooth;
    this.retryDelaysMs = retryDelaysMs;
    this.connectTimeoutMs = connectTimeoutMs;

    this.state = 'idle';
    this.device = null;
    this.name = '';
    this.battery = null;
    this.contact = null;
    this.wanted = false; // true while the user wants to stay connected

    this._hrChar = null;
    this._retryTimer = null;
    this._attempt = 0;
    this._opening = null;

    this._onValue = (e) => {
      const m = parseHeartRateMeasurement(e.target.value);
      if (!m) return;
      this.contact = m.contact;
      this.emit('hr', m);
    };
    this._onGattDisconnected = () => this._lost();
    this._onBattery = (e) => this._setBattery(e.target.value);
  }

  get connected() {
    return this.state === 'connected';
  }

  /** Show the device picker and connect. Must be called from a tap/click. */
  async connect() {
    if (!this.bluetooth) return false;
    const before = this.state;
    this._cancelRetry();
    let device;
    try {
      device = await this.bluetooth.requestDevice({
        // Any standard strap: filter by service, not by brand.
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['battery_service'],
      });
    } catch (error) {
      // NotFoundError = the user closed the picker. Leave things as they were.
      this.emit('error', { error, cancelled: !!error && error.name === 'NotFoundError' });
      if (before === 'reconnecting' && this.wanted) this._scheduleRetry();
      return false;
    }
    if (this.device && this.device !== device) this._drop();
    this._adopt(device);
    this.wanted = true;
    this._attempt = 0;
    this._setState('connecting');
    try {
      await this._open();
      return true;
    } catch (error) {
      this.emit('error', { error, cancelled: false });
      if (this.wanted) {
        this._setState('reconnecting');
        this._scheduleRetry();
      }
      return false;
    }
  }

  /** One-tap reconnect to the strap we already know; falls back to the picker. */
  async reconnect() {
    if (!this.device) return this.connect();
    if (this.state === 'connected') return true;
    this.wanted = true;
    this._cancelRetry();
    this._setState('reconnecting');
    try {
      await this._open();
      return true;
    } catch (error) {
      this.emit('error', { error, cancelled: false });
      if (this.wanted && this.state !== 'connected') this._scheduleRetry();
      return false;
    }
  }

  /** The user is done with the strap: stop retrying and forget the device. */
  disconnect() {
    this.wanted = false;
    this._cancelRetry();
    this._drop();
    this.battery = null;
    this.contact = null;
    this._setState('idle');
  }

  _adopt(device) {
    this.device = device;
    this.name = device.name || '';
    device.addEventListener('gattserverdisconnected', this._onGattDisconnected);
  }

  _drop() {
    const device = this.device;
    if (!device) return;
    device.removeEventListener('gattserverdisconnected', this._onGattDisconnected);
    if (this._hrChar) this._hrChar.removeEventListener('characteristicvaluechanged', this._onValue);
    this._hrChar = null;
    try {
      if (device.gatt && device.gatt.connected) device.gatt.disconnect();
    } catch (_) {
      /* already gone */
    }
    this.device = null;
    this.name = '';
  }

  // Connect GATT and subscribe. Concurrent callers share one attempt.
  _open() {
    if (this._opening) return this._opening;
    const device = this.device;
    const run = async () => {
      const server = await withTimeout(device.gatt.connect(), this.connectTimeoutMs, () => {
        try {
          device.gatt.disconnect();
        } catch (_) {
          /* ignore */
        }
      });
      const service = await server.getPrimaryService('heart_rate');
      const ch = await service.getCharacteristic('heart_rate_measurement');
      if (this._hrChar) this._hrChar.removeEventListener('characteristicvaluechanged', this._onValue);
      ch.addEventListener('characteristicvaluechanged', this._onValue);
      await ch.startNotifications();
      if (this.device !== device || !this.wanted) throw new Error('cancelled');
      this._hrChar = ch;
      const again = this.state === 'reconnecting';
      this._attempt = 0;
      this._cancelRetry();
      this._setState('connected');
      if (again) this.emit('reconnect', {});
      this._readBattery(server); // optional, never blocks or fails the connection
    };
    this._opening = run().finally(() => {
      this._opening = null;
    });
    return this._opening;
  }

  async _readBattery(server) {
    try {
      const service = await server.getPrimaryService('battery_service');
      const ch = await service.getCharacteristic('battery_level');
      this._setBattery(await ch.readValue());
      ch.addEventListener('characteristicvaluechanged', this._onBattery);
      await ch.startNotifications();
    } catch (_) {
      /* no battery service, or it cannot notify: fine */
    }
  }

  _setBattery(view) {
    if (!view || view.byteLength < 1) return;
    const level = view.getUint8(0);
    if (level === this.battery) return;
    this.battery = level;
    this.emit('battery', { level });
  }

  // The GATT link dropped.
  _lost() {
    if (!this.wanted || !this.device) return;
    if (this.state === 'connected') {
      this._setState('reconnecting');
      this.emit('disconnect', {});
    }
    if (!this._opening) this._scheduleRetry();
  }

  _scheduleRetry() {
    if (this._retryTimer || !this.wanted || !this.device) return;
    const delays = this.retryDelaysMs;
    const delay = delays[Math.min(this._attempt, delays.length - 1)];
    this._attempt++;
    this._retryTimer = setTimeout(async () => {
      this._retryTimer = null;
      if (!this.wanted || !this.device || this.state === 'connected') return;
      try {
        await this._open();
      } catch (_) {
        if (this.wanted && this.state !== 'connected') this._scheduleRetry();
      }
    }, delay);
  }

  _cancelRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  _setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.emit('state', { state, name: this.name });
  }
}
