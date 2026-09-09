import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPublicFeedHandler,
  createPublicResultHandler,
  decodePublicFeedCursor,
} from '../netlify/functions/_shared/public-results-handler.js';

const FIRST_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ID = '00000000-0000-4000-8000-000000000002';
const CREATED_AT = '2026-09-09T12:00:00.000Z';
const rawModel = {
  version: 1,
  kind: 'voxels',
  cells: [{ x: 0, y: 0, z: 0, color: 'red', private: 'drop-me' }],
  meta: { method: 'voxel-loft', secret: 'drop-me' },
};

function row(id = FIRST_ID) {
  return {
    result_id: id,
    prompt: 'a tiny lighthouse',
    created_at: CREATED_AT,
    generation_version: 'public-generation-v1',
    raw_model: rawModel,
    metadata: { actualModel: 'private-provider-detail', secret: 'drop-me' },
    source_program: { private: true },
    diagnostics: { private: true },
  };
}

test('public feed returns only bounded summary fields and an opaque validated cursor', async () => {
  const calls = [];
  const handler = createPublicFeedHandler({
    store: {
      listVisibleResults: async (input) => {
        calls.push(input);
        return [row(FIRST_ID), row(SECOND_ID), ...Array.from({ length: 8 }, (_, index) => row(
          `00000000-0000-4000-8000-${String(index + 3).padStart(12, '0')}`,
        ))];
      },
    },
  });
  const response = await handler(new Request('https://blawx.netlify.app/api/feed'));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.items.length, 9);
  assert.deepEqual(Object.keys(payload.items[0]).sort(), ['createdAt', 'id', 'previewStage', 'prompt', 'provenance', 'thumbnailUrl']);
  assert.deepEqual(decodePublicFeedCursor(payload.nextCursor), { createdAt: CREATED_AT, id: payload.items[8].id });
  assert.equal(calls[0].limit, 10);
  assert.doesNotMatch(JSON.stringify(payload), /source_program|actualModel|drop-me|diagnostics/);
});

test('public result strips source, diagnostics, provider metadata, and unknown model fields', async () => {
  const handler = createPublicResultHandler({ store: { getVisibleResult: async () => row() } });
  const response = await handler(
    new Request(`https://blawx.netlify.app/api/results/${FIRST_ID}`),
    { params: { id: FIRST_ID } },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(payload).sort(), ['createdAt', 'id', 'model', 'prompt', 'provenance']);
  assert.deepEqual(payload.model.cells, [{ x: 0, y: 0, z: 0, color: 'red' }]);
  assert.doesNotMatch(JSON.stringify(payload), /source_program|actualModel|drop-me|diagnostics|secret/);
});

test('public result and feed fail closed for malformed ids, cursors, rows, and missing storage', async () => {
  const noStore = await createPublicFeedHandler({ store: null })(new Request('https://blawx.netlify.app/api/feed'));
  assert.equal(noStore.status, 503);
  const badCursor = await createPublicFeedHandler({ store: { listVisibleResults: async () => [] } })(
    new Request('https://blawx.netlify.app/api/feed?cursor=bad'),
  );
  assert.equal(badCursor.status, 400);
  const handler = createPublicResultHandler({ store: { getVisibleResult: async () => row() } });
  assert.equal((await handler(new Request('https://blawx.netlify.app/api/results/bad'), { params: { id: 'bad' } })).status, 404);
});
