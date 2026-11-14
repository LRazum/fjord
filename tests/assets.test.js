import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { STRINGS } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('sw.js', root), 'utf8');
const assets = runInNewContext(source + '\nASSETS;', { self: { addEventListener() {} } });

test('offline shell: every cached asset uses a relative path and exists', () => {
  for (const path of assets) {
    assert.ok(path.startsWith('./'), path);
    assert.ok(existsSync(new URL(path, root)), 'Missing cached asset: ' + path);
  }
});

test('offline shell: every browser module is available offline', () => {
  const cached = new Set(assets);
  const visit = (path) => {
    for (const entry of readdirSync(new URL(path, root), { withFileTypes: true })) {
      const name = path + entry.name;
      if (entry.isDirectory()) visit(name + '/');
      else if (name.endsWith('.js')) assert.ok(cached.has('./' + name), 'Uncached module: ' + name);
    }
  };
  visit('js/');
});

test('translations: languages cover the same keys and interpolation parameters', () => {
  assert.deepEqual(Object.keys(STRINGS.hr).sort(), Object.keys(STRINGS.en).sort());
  const params = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
  for (const key of Object.keys(STRINGS.en)) {
    assert.equal(typeof STRINGS.hr[key], 'string', key);
    assert.deepEqual(params(STRINGS.hr[key]), params(STRINGS.en[key]), key);
  }
});
