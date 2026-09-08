import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedDemoClient, findDemoExample, normalizePrompt } from '../src/demo-client.js';

test('demo prompts normalize punctuation and case',()=>assert.equal(normalizePrompt('  Red Pickup!  '),'red pickup'));
test('named saved examples resolve to stable shape numbers',()=>{assert.equal(findDemoExample('cat').shape,43);assert.equal(findDemoExample('pickup truck').shape,44);assert.equal(findDemoExample('anything else'),null);});

test('saved demo loads the stable index entry and preserves model data', async () => {
  const index = [{ shape: 44, id: 'shape-44', url: '/saved/44.json' }];
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

test('saved demo resolves explicit shape IDs when the manifest is reordered and has missing shape numbers', async () => {
  const index = [
    { shape: 47, id: 'shape-47', url: '/saved/47.json' },
    { shape: 42, id: 'shape-42', url: '/saved/42.json' },
    { shape: 44, id: 'shape-44', url: '/saved/44.json' },
  ];
  const calls = [];
  const client = createSavedDemoClient(async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('index.json') ? index : { kind: 'voxels', cells: [] } };
  });
  const result = await client.generate('coral reef');
  assert.equal(result.record.id, 'shape-42');
  assert.deepEqual(calls, ['/examples/index.json', '/saved/42.json']);
});

test('unsupported prompts make no request and unavailable saves surface errors', async () => {
  const client = createSavedDemoClient(async () => { throw new Error('unexpected request'); });
  await assert.rejects(client.generate('a new spaceship'), { code: 'unsupported-demo-prompt' });
  const missing = createSavedDemoClient(async () => ({ ok: true, json: async () => [] }));
  await assert.rejects(missing.generate('cat'), /Shape 43 is unavailable/);
  const offline = createSavedDemoClient(async () => ({ ok: false }));
  await assert.rejects(offline.generate('cat'), /index could not be loaded/);
});
