import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { createGuideSections } from '../src/guide-sections.js';
import { createSemanticGuideInput } from '../src/semantic-guide.js';
import { createSemanticGuideClient, nameConstructionGuide } from '../src/semantic-guide-client.js';

function fixture() {
  const brickModel = {
    version: 1,
    kind: 'bricks',
    bricks: [
      { id: 'brick-1', x: 0, y: 0, z: 0, w: 2, d: 2, color: 'red' },
      { id: 'brick-2', x: 0, y: 1, z: 0, w: 2, d: 2, color: 'red' },
    ],
  };
  const assemblyPlan = createAssemblyPlan({ brickModel });
  const guide = createGuideSections(assemblyPlan);
  const rawModel = { version: 1, kind: 'voxels', cells: [], meta: { prompt: 'red tower' } };
  const sourceProgram = { ops: [['b', 0, 0, 0, 2, 2, 2, 'R']] };
  const result = { rawModel, sourceProgram, brickModel, assemblyPlan, instructionPlan: assemblyPlan, guide };
  const input = createSemanticGuideInput({ plan: assemblyPlan, guide, subject: 'red tower' });
  const annotation = {
    version: 1,
    fingerprint: input.fingerprint,
    sections: [{
      startStepId: assemblyPlan.steps[0].id,
      endStepId: assemblyPlan.steps.at(-1).id,
      label: 'Red tower',
      confidence: 'high',
      evidence: 'Two aligned red courses share the same footprint.',
    }],
  };
  return { result, input, annotation };
}

function jsonResponse(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return structuredClone(body); },
  };
}

test('a saved static receipt is validated and cached without API inference', async () => {
  const { input, annotation } = fixture();
  const calls = [];
  const client = createSemanticGuideClient(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (url === '/semantic-guides/index.json') {
      return jsonResponse({ version: 1, entries: { [input.fingerprint]: 'tower.json' } });
    }
    if (url === '/semantic-guides/tower.json') {
      return jsonResponse({ annotation, metadata: { cacheHit: true } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const first = await client.get(input, { allowInference: false });
  const second = await client.get(input, { allowInference: false });

  assert.equal(first.annotation.fingerprint, input.fingerprint);
  assert.equal(first.metadata.cacheHit, true);
  assert.equal(second, first);
  assert.deepEqual(calls, [
    { url: '/semantic-guides/index.json', method: 'GET' },
    { url: '/semantic-guides/tower.json', method: 'GET' },
  ]);
});

test('stale saved data is rejected and cache-only fallback preserves the source result', async () => {
  const { result, input, annotation } = fixture();
  const stale = { ...annotation, fingerprint: '0'.repeat(64) };
  const calls = [];
  const client = createSemanticGuideClient(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (url === '/semantic-guides/index.json') {
      return jsonResponse({ version: 1, entries: { [input.fingerprint]: 'stale.json' } });
    }
    if (url === '/semantic-guides/stale.json') return jsonResponse({ annotation: stale, metadata: {} });
    return jsonResponse(null, 404);
  });

  const named = await nameConstructionGuide(result, {
    subject: 'red tower', client, allowInference: false,
  });

  assert.equal(named.assemblyPlan, result.assemblyPlan);
  assert.equal(named.instructionPlan, result.instructionPlan);
  assert.equal(named.guide, result.guide);
  assert.equal(named.rawModel, result.rawModel);
  assert.equal(named.sourceProgram, result.sourceProgram);
  assert.equal(Object.hasOwn(named, 'semanticGuide'), false);
  assert.match(named.semanticStatus, /No saved section names/);
  assert.equal(calls.some(({ method }) => method === 'POST'), false);
  assert.equal(calls.length, 3);
});

test('a private GET receipt is reported as a cache hit without allowing inference', async () => {
  const { input, annotation } = fixture();
  const calls = [];
  const client = createSemanticGuideClient(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (url === '/semantic-guides/index.json') return jsonResponse({ version: 1, entries: {} });
    if (url.startsWith('/api/semantic-guide?')) {
      return jsonResponse({ annotation, metadata: { cacheHit: false, actualModel: 'cached-model' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const receipt = await client.get(input, { allowInference: false });

  assert.equal(receipt.metadata.cacheHit, true);
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET']);
});

test('inference makes one POST after bounded cache misses and enriches a derived result', async () => {
  const { result, input, annotation } = fixture();
  const calls = [];
  const client = createSemanticGuideClient(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body });
    if (url === '/semantic-guides/index.json') return jsonResponse(null, 404);
    if (url.startsWith('/api/semantic-guide?')) return jsonResponse(null, 404);
    if (url === '/api/semantic-guide' && options.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), input);
      return jsonResponse({ annotation, metadata: { cacheHit: false, actualModel: 'test-model' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const named = await nameConstructionGuide(result, {
    subject: 'red tower', client, allowInference: true,
  });

  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'POST']);
  assert.equal(named.semanticGuide.sections[0].semanticLabel, 'Red tower');
  assert.equal(named.semanticAnnotation.fingerprint, input.fingerprint);
  assert.equal(named.assemblyPlan, result.assemblyPlan);
  assert.equal(named.guide, result.guide);
  assert.equal(named.rawModel, result.rawModel);
  assert.equal(named.sourceProgram, result.sourceProgram);
});

test('cache and inference failures are not retried and retain the guide fallback', async () => {
  const { result } = fixture();
  const calls = [];
  const client = createSemanticGuideClient(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    throw new Error('offline');
  });

  const named = await nameConstructionGuide(result, {
    subject: 'red tower', client, allowInference: true,
  });

  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'POST']);
  assert.equal(named.guide, result.guide);
  assert.equal(Object.hasOwn(named, 'semanticGuide'), false);
  assert.match(named.semanticStatus, /Section naming unavailable: offline/);
});

test('aborting while the shared index is pending prevents stale follow-up requests', async () => {
  const { input } = fixture();
  const calls = [];
  let resolveIndex;
  const index = new Promise(resolve => { resolveIndex = resolve; });
  const client = createSemanticGuideClient(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (url === '/semantic-guides/index.json') return index;
    throw new Error(`Unexpected request: ${url}`);
  });
  const controller = new AbortController();
  const pending = client.get(input, { signal: controller.signal, allowInference: true });

  controller.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  resolveIndex(jsonResponse({ version: 1, entries: {} }));
  await Promise.resolve();

  assert.deepEqual(calls, [{ url: '/semantic-guides/index.json', method: 'GET' }]);
});
