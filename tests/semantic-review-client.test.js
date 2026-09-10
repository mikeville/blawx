import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { createGuideSections } from '../src/guide-sections.js';
import { createSemanticGuideInput } from '../src/semantic-guide.js';
import { nameConstructionGuide } from '../src/semantic-guide-client.js';
import {
  createSemanticReviewClient,
  semanticReviewId,
  semanticReviewUrl,
} from '../mockups/feed/round2/semantic-review-client.js';

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
  const result = { brickModel, assemblyPlan, instructionPlan: assemblyPlan, guide };
  const input = createSemanticGuideInput({ plan: assemblyPlan, guide, subject: 'red tower' });
  const annotation = {
    version: 1,
    fingerprint: input.fingerprint,
    sections: [{
      startStepId: assemblyPlan.steps[0].id,
      endStepId: assemblyPlan.steps.at(-1).id,
      label: 'Red form',
      confidence: 'inferred',
      evidence: 'A broad label for the aligned red courses.',
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

test('only the whitelisted review id maps static semantic guide URLs', () => {
  assert.equal(semanticReviewId('?naming-review=consensus-v1'), 'consensus-v1');
  assert.equal(semanticReviewId('?naming-review=../../private'), null);
  assert.equal(semanticReviewId('?naming-review=future-review'), null);
  assert.equal(semanticReviewUrl('/semantic-guides/index.json', 'consensus-v1'),
    '/semantic-guide-reviews/consensus-v1/index.json');
  assert.equal(semanticReviewUrl('/semantic-guides/abc_123.json', 'consensus-v1'),
    '/semantic-guide-reviews/consensus-v1/abc_123.json');
  assert.equal(semanticReviewUrl('/semantic-guides/../secret.json', 'consensus-v1'), null);
  assert.equal(semanticReviewUrl('/api/semantic-guide', 'consensus-v1'), null);
});

test('the default and unknown review paths retain canonical client requests', async () => {
  for (const search of ['', '?naming-review=unknown']) {
    const calls = [];
    const client = createSemanticReviewClient({
      search,
      fetchImpl: async url => {
        calls.push(url);
        return jsonResponse(null, 404);
      },
    });
    const { input } = fixture();
    assert.equal(await client.get(input, { allowInference: false }), null);
    assert.equal(client.reviewId, null);
    assert.deepEqual(calls, [
      '/semantic-guides/index.json',
      `/api/semantic-guide?fingerprint=${encodeURIComponent(input.fingerprint)}`,
    ]);
  }
});

test('a review candidate loads only from its isolated static namespace', async () => {
  const { input, annotation } = fixture();
  const calls = [];
  const client = createSemanticReviewClient({
    search: '?naming-review=consensus-v1',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET' });
      if (url.endsWith('/index.json')) {
        return jsonResponse({ version: 1, entries: { [input.fingerprint]: 'candidate.json' } });
      }
      if (url.endsWith('/candidate.json')) return jsonResponse({ annotation, metadata: { phase: 'consensus' } });
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const receipt = await client.get(input, { allowInference: true });

  assert.equal(receipt.annotation.fingerprint, input.fingerprint);
  assert.equal(receipt.metadata.phase, 'consensus');
  assert.deepEqual(calls, [
    { url: '/semantic-guide-reviews/consensus-v1/index.json', method: 'GET' },
    { url: '/semantic-guide-reviews/consensus-v1/candidate.json', method: 'GET' },
  ]);
});

test('missing review data falls back to the geometric guide without canonical or provider calls', async () => {
  const { result } = fixture();
  const calls = [];
  const client = createSemanticReviewClient({
    search: '?naming-review=consensus-v1',
    fetchImpl: async url => {
      calls.push(url);
      return jsonResponse(null, 404);
    },
  });

  const named = await nameConstructionGuide(result, {
    subject: 'red tower', client, allowInference: true,
  });

  assert.equal(named.guide, result.guide);
  assert.equal(Object.hasOwn(named, 'semanticGuide'), false);
  assert.match(named.semanticStatus, /No saved section names/);
  assert.deepEqual(calls, ['/semantic-guide-reviews/consensus-v1/index.json']);
});

test('a mismatched review receipt cannot fall through to canonical names or a provider', async () => {
  const { result, input, annotation } = fixture();
  const stale = { ...annotation, fingerprint: '0'.repeat(64) };
  const calls = [];
  const client = createSemanticReviewClient({
    search: '?naming-review=consensus-v1',
    fetchImpl: async url => {
      calls.push(url);
      if (url.endsWith('/index.json')) {
        return jsonResponse({ version: 1, entries: { [input.fingerprint]: 'candidate.json' } });
      }
      if (url.endsWith('/candidate.json')) return jsonResponse({ annotation: stale, metadata: {} });
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const named = await nameConstructionGuide(result, {
    subject: 'red tower', client, allowInference: true,
  });

  assert.equal(named.guide, result.guide);
  assert.equal(Object.hasOwn(named, 'semanticGuide'), false);
  assert.deepEqual(calls, [
    '/semantic-guide-reviews/consensus-v1/index.json',
    '/semantic-guide-reviews/consensus-v1/candidate.json',
  ]);
});
