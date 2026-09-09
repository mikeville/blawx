import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAppServices } from '../server/local-app-services.js';
import { createGenerationMiddleware } from '../server/middleware.js';
import { createFeedMiddleware } from '../server/feed-middleware.js';
import { createGenerationClient } from '../src/generation-client.js';

test('browser generation contract, HTTP middleware, persistent reuse and feed form one mocked pipeline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blawx-feed-http-'));
  const dataRoot = join(root, 'private-data');
  let calls = 0;
  const services = await createLocalAppServices({
    root, dataRoot, allowTestDataRoot: true, generationVersion: 'http-fixture-v1',
    generator: { generate: async prompt => {
      calls++;
      return {
        requestId: `private-${calls}`, prompt,
        model: { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }], meta: { prompt, usage: { private: true }, sourcePath: '/private/attempt' } },
        sourceProgram: { private: 'source' }, diagnostics: { valid: true }, metadata: { generationMs: 1, runtime: 'mock' },
      };
    } },
    semanticFactory: () => ({ isBusy: () => false, cancel() {} }),
  });
  const generation = createGenerationMiddleware(services.generation);
  const feed = createFeedMiddleware(services.store);
  const server = createServer((request, response) => {
    feed(request, response, () => generation(request, response, () => { response.statusCode = 404; response.end(); }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createGenerationClient(fetch, `${base}/api/generate`);
  try {
    const first = await client.generate('  Orange   cat! ');
    assert.equal(first.cacheHit, false);
    assert.equal(first.saveStatus, 'saved');
    const reused = await client.generate('ORANGE CAT!');
    assert.equal(reused.cacheHit, true);
    assert.equal(reused.resultId, first.resultId);
    assert.equal(reused.createdAt, first.createdAt);
    assert.equal(reused.submittedPrompt, 'ORANGE CAT!');
    assert.equal(calls, 1);
    assert.notEqual(reused.requestId, first.requestId);
    assert.equal(reused.metadata.generationMs, null);

    const page = await fetch(`${base}/api/feed`).then(response => response.json());
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, first.resultId);
    const detail = await fetch(`${base}/api/results/${first.resultId}`).then(response => response.json());
    assert.deepEqual(detail.model.cells, first.model.cells);
    for (const payload of [first, reused, detail, page]) {
      assert.doesNotMatch(JSON.stringify(payload), /sourceProgram|sourcePath|\/private\/attempt|"private"/);
    }
    assert.equal((await fetch(`${base}/api/feed`, { headers: { origin: 'https://unrelated.test' } })).status, 403);
    assert.equal((await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt":"cat","publish":false}' })).status, 400);
    assert.equal(calls, 1);

    services.store.hide(first.resultId);
    assert.equal((await fetch(`${base}/api/results/${first.resultId}`)).status, 404);
    const replacement = await client.generate('orange cat!');
    assert.notEqual(replacement.resultId, first.resultId);
    assert.equal(calls, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await services.close();
  }
});
