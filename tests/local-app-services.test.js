import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalAppServices } from '../server/local-app-services.js';

const model = { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }], meta: { prompt: 'cat' } };
const result = { requestId: 'private-attempt', prompt: 'cat', model, sourceProgram: { ops: [] }, diagnostics: { valid: true }, metadata: { generationMs: 1 } };

test('cached results remain available and fresh generation takes priority over semantic work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blawx-services-'));
  const dataRoot = join(root, 'private-data');
  let calls = 0;
  let semanticBusy = false;
  let semanticCancelled = 0;
  let checkGenerationBusy;
  let semanticOptions;
  const services = await createLocalAppServices({
    root, dataRoot, allowTestDataRoot: true, generationVersion: 'fixture-v1',
    generator: { generate: async () => { calls++; return result; }, isBusy: () => false },
    semanticFactory: (options) => {
      semanticOptions = options;
      const { isGenerationBusy } = options;
      checkGenerationBusy = isGenerationBusy;
      return {
        isBusy: () => semanticBusy,
        isInferenceBusy: () => semanticBusy,
        cancel() { semanticCancelled += 1; semanticBusy = false; },
      };
    },
  });
  try {
    const first = await services.generation.generate('cat');
    semanticBusy = true;
    const reused = await services.generation.generate('  CAT  ');
    assert.equal(reused.resultId, first.resultId);
    assert.equal(reused.cacheHit, true);
    assert.equal(services.store.listVisible().items.length, 1);
    assert.equal(services.store.getVisible(first.resultId).prompt, 'cat');
    const fresh = await services.generation.generate('dog');
    assert.equal(fresh.prompt, 'cat');
    assert.equal(calls, 2);
    assert.equal(semanticCancelled, 1);
    assert.equal(checkGenerationBusy(), false);
    assert.equal(semanticOptions.allowExperimentalInference, true);
    assert.equal(semanticOptions.strategy, 'parallel-fixed-v1');
  } finally { await services.close(); }
});

test('fresh generation fails closed when semantic cancellation has not settled, then recovers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blawx-services-semantic-timeout-'));
  const dataRoot = join(root, 'private-data');
  let providerCalls = 0;
  let semanticBusy = false;
  let settleSemantic;
  let generationBusy;
  const services = await createLocalAppServices({
    root, dataRoot, allowTestDataRoot: true, generationVersion: 'fixture-v1',
    generator: {
      generate: async (prompt) => {
        providerCalls += 1;
        return { ...result, prompt, model: { ...model, meta: { prompt } } };
      },
      isBusy: () => false,
    },
    semanticFactory: ({ isGenerationBusy }) => {
      generationBusy = isGenerationBusy;
      return {
        isInferenceBusy: () => semanticBusy,
        isBusy: () => semanticBusy || isGenerationBusy(),
        cancel() {},
        async cancelAndWait() {
          await new Promise(resolve => { settleSemantic = resolve; });
          return false;
        },
      };
    },
  });
  try {
    const cached = await services.generation.generate('cat');
    semanticBusy = true;
    const reused = await services.generation.generate(' CAT ');
    assert.equal(reused.resultId, cached.resultId);
    assert.equal(reused.cacheHit, true);
    assert.equal(providerCalls, 1);

    const blocked = services.generation.generate('dog');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(providerCalls, 1);
    settleSemantic();
    await assert.rejects(blocked, error => error?.code === 'busy');
    assert.equal(providerCalls, 1);
    semanticBusy = false;
    assert.equal(generationBusy(), false);

    const recovered = await services.generation.generate('dog');
    assert.equal(recovered.prompt, 'dog');
    assert.equal(providerCalls, 2);
  } finally { await services.close(); }
});

test('shutdown waits for aborted generation before closing its database, and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blawx-services-close-'));
  const dataRoot = join(root, 'private-data');
  let sawAbort = false;
  let release;
  let semanticCancelled = 0;
  const services = await createLocalAppServices({
    root, dataRoot, allowTestDataRoot: true, generationVersion: 'fixture-v1',
    generator: {
      generate: (_prompt, { signal }) => new Promise((resolve, reject) => {
        release = () => reject(new DOMException('Cancelled', 'AbortError'));
        signal.addEventListener('abort', () => { sawAbort = true; queueMicrotask(release); }, { once: true });
      }),
    },
    semanticFactory: () => ({ isBusy: () => false, cancel() { semanticCancelled++; } }),
  });
  const generation = services.generation.generate('cat');
  const rejection = assert.rejects(generation, { name: 'AbortError' });
  const closing = services.close();
  assert.equal(services.close(), closing);
  await Promise.all([rejection, closing]);
  assert.equal(sawAbort, true);
  assert.equal(semanticCancelled, 1);
});

test('Vite explicitly denies private result databases and private attempt receipts', async () => {
  const config = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  for (const directory of ['app-runs', 'app-data', '.blawx-private']) {
    assert.ok(config.includes(`'**/${directory}/**'`), `missing ${directory}`);
  }
  assert.ok(config.includes("'**/*.log'"), 'missing private log denial');
});
