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

test('overlapping readers share one naming job and one reader can leave without cancelling the other', async () => {
  const { input, annotation } = fixture();
  let finishPost;
  const posted = new Promise(resolve => { finishPost = resolve; });
  let notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  let posts = 0;
  let providerSignal;
  const client = createSemanticGuideClient(async (_url, options = {}) => {
    if (options.method !== 'POST') return jsonResponse(null, 404);
    posts += 1;
    providerSignal = options.signal;
    notifyStarted();
    return posted;
  });
  const controller = new AbortController();
  const first = client.get(input, { allowInference: true, signal: controller.signal });
  const second = client.get(input, { allowInference: true });
  await started;
  controller.abort();
  await assert.rejects(first, error => error.name === 'AbortError');
  assert.equal(providerSignal.aborted, false);
  finishPost(jsonResponse({ annotation, metadata: { namingPolicy: 'consensus-v1' } }));
  assert.equal((await second).annotation.sections[0].label, 'Red tower');
  assert.equal(posts, 1);
});

test('reopening a failed guide does not automatically retry inference in the same page', async () => {
  const { input } = fixture();
  let posts = 0;
  const client = createSemanticGuideClient(async (_url, options = {}) => {
    if (options.method !== 'POST') return jsonResponse(null, 404);
    posts += 1;
    throw new Error('provider unavailable');
  });
  await assert.rejects(client.get(input, { allowInference: true }), /provider unavailable/);
  await assert.rejects(client.get(input, { allowInference: true }), /provider unavailable/);
  assert.equal(posts, 1);
});

test('successful small name receipts survive a new client without network calls', async () => {
  const { input, annotation } = fixture();
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const writer = createSemanticGuideClient(async (_url, options = {}) => options.method === 'POST'
    ? jsonResponse({ annotation, metadata: { namingPolicy: 'consensus-v1' } }) : jsonResponse(null, 404),
  { persist: true, storage });
  await writer.get(input, { allowInference: true });
  let reads = 0;
  const reader = createSemanticGuideClient(async () => { reads += 1; throw new Error('offline'); }, { persist: true, storage });
  const receipt = await reader.get(input, { allowInference: true });
  assert.equal(receipt.annotation.sections[0].label, 'Red tower');
  assert.equal(receipt.metadata.browserCacheHit, true);
  assert.equal(reads, 0);
  assert.equal(JSON.parse(values.get('blawx:part-names:parallel-fixed-v1:grouping-1'))[0][1].annotation.fingerprint, input.fingerprint);
});

test('a validated consensus-v1 browser success migrates to the parallel cache without network access', async () => {
  const { input, annotation } = fixture();
  const legacyReceipt = {
    annotation,
    metadata: { namingPolicy: 'consensus-v1', strategy: 'consensus-v1', requestId: 'saved-consensus' },
  };
  const values = new Map([
    ['blawx:part-names:consensus-v1', JSON.stringify([[input.fingerprint, legacyReceipt]])],
    ['blawx:part-names:consensus-v1:attempts', JSON.stringify([input.fingerprint])],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let reads = 0;
  const client = createSemanticGuideClient(async () => { reads += 1; throw new Error('network must stay idle'); }, {
    persist: true, storage,
  });

  const receipt = await client.get(input, { allowInference: true });

  assert.equal(reads, 0);
  assert.deepEqual(receipt.annotation, annotation);
  assert.equal(receipt.metadata.namingPolicy, 'consensus-v1');
  assert.equal(receipt.metadata.strategy, 'consensus-v1');
  assert.equal(receipt.metadata.requestId, 'saved-consensus');
  assert.equal(receipt.metadata.cacheReusedFrom, 'consensus-v1');
  assert.equal(receipt.metadata.browserCacheHit, true);
  const migrated = JSON.parse(values.get('blawx:part-names:parallel-fixed-v1:grouping-1'));
  assert.deepEqual(migrated, [[input.fingerprint, receipt]]);
});

test('a consensus-v1 browser success with stale geometry is rejected instead of migrated', async () => {
  const { input, annotation } = fixture();
  const staleReceipt = {
    annotation: { ...annotation, fingerprint: '0'.repeat(64) },
    metadata: { namingPolicy: 'consensus-v1', strategy: 'consensus-v1' },
  };
  const values = new Map([
    ['blawx:part-names:consensus-v1', JSON.stringify([[input.fingerprint, staleReceipt]])],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const calls = [];
  const client = createSemanticGuideClient(async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    return jsonResponse(null, 404);
  }, { persist: true, storage });

  assert.equal(await client.get(input, { allowInference: false }), null);
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET']);
  assert.equal(values.has('blawx:part-names:parallel-fixed-v1:grouping-1'), false);
});

test('a failed naming attempt survives reload without silently posting again', async () => {
  const { input } = fixture();
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let posts = 0;
  const fetchImpl = async (_url, options = {}) => {
    if (options.method !== 'POST') return jsonResponse(null, 404);
    posts += 1;
    throw new Error('provider unavailable');
  };
  await assert.rejects(createSemanticGuideClient(fetchImpl, { persist: true, storage }).get(input, { allowInference: true }));
  await assert.rejects(createSemanticGuideClient(fetchImpl, { persist: true, storage }).get(input, { allowInference: true }), /already attempted/);
  assert.equal(posts, 1);
});

test('the new range strategy ignores old browser receipts and failed-attempt markers', async () => {
  const { input, annotation } = fixture();
  const oldReceipt = { annotation: { ...annotation, sections: annotation.sections.map(section => ({ ...section, label: 'Old range' })) } };
  const values = new Map([
    ['blawx:part-names:consensus-v1', JSON.stringify([[input.fingerprint, oldReceipt]])],
    ['blawx:part-names:consensus-v1:attempts', JSON.stringify([input.fingerprint])],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let posts = 0;
  const client = createSemanticGuideClient(async (_url, options = {}) => {
    if (options.method !== 'POST') return jsonResponse(null, 404);
    posts += 1;
    return jsonResponse({ annotation, metadata: { namingPolicy: 'parallel-fixed-v1', groupingVersion: 1 } });
  }, { persist: true, storage });
  const receipt = await client.get(input, { allowInference: true });
  assert.equal(posts, 1);
  assert.equal(receipt.annotation.sections[0].label, 'Red tower');
  assert.equal(receipt.metadata.namingPolicy, 'parallel-fixed-v1');
  assert.equal(JSON.parse(values.get('blawx:part-names:consensus-v1'))[0][1].annotation.sections[0].label, 'Old range');
});

test('bad persistent receipts and unavailable browser storage fall back safely', async () => {
  const { input, annotation } = fixture();
  const storage = {
    getItem: () => JSON.stringify([[input.fingerprint, { annotation: { ...annotation, fingerprint: '0'.repeat(64) } }]]),
    setItem() { throw new Error('quota'); },
  };
  let posts = 0;
  const client = createSemanticGuideClient(async (_url, options = {}) => {
    if (options.method !== 'POST') return jsonResponse(null, 404);
    posts += 1;
    return jsonResponse({ annotation, metadata: {} });
  }, { persist: true, storage });
  assert.equal((await client.get(input, { allowInference: true })).annotation.fingerprint, input.fingerprint);
  assert.equal(posts, 1);
});
