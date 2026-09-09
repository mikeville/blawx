import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedDemoClient, findDemoExample, normalizePrompt } from '../src/demo-client.js';

test('demo prompts normalize punctuation and case',()=>assert.equal(normalizePrompt('  Red Pickup!  '),'red pickup'));
test('named saved examples resolve to stable shape numbers',()=>{assert.equal(findDemoExample('cat').shape,43);assert.equal(findDemoExample('pickup truck').shape,44);assert.equal(findDemoExample('anything else'),null);});

test('saved demo loads the stable index entry and preserves model data', async () => {
  const index = Array.from({ length: 47 }, (_, i) => ({ id: `shape-${String(i + 1).padStart(2, '0')}`, shape: i + 1, url: `/saved/${i + 1}.json` }));
  const model = { kind: 'voxels', cells: [{ x: 1, y: 2, z: 3, color: 'red' }] };
  const calls = [];
  const client = createSavedDemoClient(async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('index.json') ? index : model };
  });
  const result = await client.generate('pickup truck');
  assert.deepEqual(calls, ['/examples/index.json', '/saved/44.json']);
  assert.equal(result.model, model);
  assert.equal(result.example.shape, 44);
});

test('saved demo resolves stable shape IDs when private entries are omitted', async () => {
  const index = [
    { id: 'shape-35', shape: 35, url: '/saved/35.json' },
    { id: 'shape-38', shape: 38, url: '/saved/38.json' },
    { id: 'shape-43', shape: 43, url: '/saved/43.json' },
    { id: 'shape-44', shape: 44, url: '/saved/44.json' },
  ];
  const calls = [];
  const client = createSavedDemoClient(async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('index.json') ? index : { kind: 'voxels', cells: [] } };
  });
  await client.generate('pickup truck');
  assert.deepEqual(calls, ['/examples/index.json', '/saved/44.json']);
});

test('unsupported prompts make no request and unavailable saves surface errors', async () => {
  const client = createSavedDemoClient(async () => { throw new Error('unexpected request'); });
  await assert.rejects(client.generate('a new spaceship'), { code: 'unsupported-demo-prompt' });
  const missing = createSavedDemoClient(async () => ({ ok: true, json: async () => [] }));
  await assert.rejects(missing.generate('cat'), /Shape 43 is unavailable/);
  const offline = createSavedDemoClient(async () => ({ ok: false }));
  await assert.rejects(offline.generate('cat'), /index could not be loaded/);
});
