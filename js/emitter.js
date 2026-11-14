// Minimal event emitter (DOM-free, works in node).
export class Emitter {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter((f) => f !== fn);
  }

  emit(event, data) {
    const list = this._listeners[event];
    if (!list) return;
    for (const fn of list.slice()) fn(data);
  }
}
