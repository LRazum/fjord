// Workout storage in IndexedDB, all on the device.
//
// Stores:
//   workouts  finished workout records, keyPath 'id', index on startedAt
//   kv        small values; 'current' holds the in-progress workout snapshot
//
// If IndexedDB is unavailable (some private modes), an in-memory store is used so
// the app keeps working; storageInfo() reports that so the UI can warn.

const DB_NAME = 'fjord';
const DB_VERSION = 1;

let dbPromise = null;
let memory = null; // { workouts: Map, kv: Map } when IndexedDB is not usable

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

function useMemory() {
  if (!memory) memory = { workouts: new Map(), kv: new Map() };
  return null;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let r;
    try {
      if (typeof indexedDB === 'undefined') return resolve(useMemory());
      r = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (_) {
      return resolve(useMemory());
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('workouts')) {
        db.createObjectStore('workouts', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => {
      const db = r.result;
      // Another tab upgraded the database: let it, and reopen next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    r.onerror = () => resolve(useMemory());
    r.onblocked = () => resolve(useMemory());
  });
  return dbPromise;
}

const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** {backend: 'indexeddb' | 'memory', persisted: boolean | null} */
export async function storageInfo() {
  const db = await openDb();
  let persisted = null;
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch (_) {
    persisted = null;
  }
  return { backend: db ? 'indexeddb' : 'memory', persisted };
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (_) {
    /* not supported */
  }
  return false;
}

export async function saveWorkout(rec) {
  const db = await openDb();
  if (!db) {
    memory.workouts.set(rec.id, copy(rec));
    return;
  }
  const tx = db.transaction('workouts', 'readwrite');
  tx.objectStore('workouts').put(rec);
  await done(tx);
}

export async function getWorkout(id) {
  const db = await openDb();
  if (!db) return copy(memory.workouts.get(id)) || null;
  const tx = db.transaction('workouts');
  return (await req(tx.objectStore('workouts').get(id))) || null;
}

/** All workouts, newest first. */
export async function listWorkouts() {
  const db = await openDb();
  let all;
  if (!db) all = [...memory.workouts.values()].map(copy);
  else {
    const tx = db.transaction('workouts');
    all = await req(tx.objectStore('workouts').getAll());
  }
  return all.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export async function deleteWorkout(id) {
  const db = await openDb();
  if (!db) {
    memory.workouts.delete(id);
    return;
  }
  const tx = db.transaction('workouts', 'readwrite');
  tx.objectStore('workouts').delete(id);
  await done(tx);
}

/** Import: adds workouts whose id is new, leaves existing ones alone. */
export async function addWorkouts(list) {
  const existing = new Set((await listWorkouts()).map((w) => w.id));
  const fresh = list.filter((w) => !existing.has(w.id));
  const db = await openDb();
  if (!db) fresh.forEach((w) => memory.workouts.set(w.id, copy(w)));
  else if (fresh.length) {
    const tx = db.transaction('workouts', 'readwrite');
    const st = tx.objectStore('workouts');
    fresh.forEach((w) => st.put(w));
    await done(tx);
  }
  return { added: fresh.length, existing: list.length - fresh.length };
}

async function kvPut(key, value) {
  const db = await openDb();
  if (!db) {
    memory.kv.set(key, copy(value));
    return;
  }
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  await done(tx);
}

async function kvGet(key) {
  const db = await openDb();
  if (!db) return copy(memory.kv.get(key)) ?? null;
  const tx = db.transaction('kv');
  return (await req(tx.objectStore('kv').get(key))) ?? null;
}

async function kvDelete(key) {
  const db = await openDb();
  if (!db) {
    memory.kv.delete(key);
    return;
  }
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').delete(key);
  await done(tx);
}

export const saveCurrent = (snapshot) => kvPut('current', snapshot);
export const loadCurrent = () => kvGet('current');
export const clearCurrent = () => kvDelete('current');
