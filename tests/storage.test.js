import test from 'node:test';
import assert from 'node:assert/strict';
import { addWorkouts, listWorkouts, saveCurrent, loadCurrent, clearAll } from '../js/storage.js';

// Node has no IndexedDB, so this runs against the in-memory fallback.
test('storage: clearAll removes every workout and the in-progress snapshot', async () => {
  await addWorkouts([{ id: 'a', startedAt: '2026-01-01T10:00:00Z' }, { id: 'b', startedAt: '2026-01-02T10:00:00Z' }]);
  await saveCurrent({ savedAt: 1 });
  assert.equal((await listWorkouts()).length, 2);
  await clearAll();
  assert.deepEqual(await listWorkouts(), []);
  assert.equal(await loadCurrent(), null);
});
