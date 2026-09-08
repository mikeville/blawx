import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publicAttempt, publishAttempts, summarizeAttempt } from '../scripts/publish-attempts.mjs';

const metadata = {
  runtime: 'openai-responses-api', requestedModel: 'gpt-6-astra', actualModel: 'gpt-6-astra-2026-09-01',
  requestedServiceTier: 'priority', actualServiceTier: 'priority',
  timingScope: 'API request start through response body receipt and shape validation; excludes browser load/render',
};

test('API failures receive fixed summaries for each safe stage', () => {
  assert.deepEqual(summarizeAttempt({ error: { stage: 'http-status', message: 'secret provider body' } }), {
    status: 'api-failed', errorSummary: 'API request returned an unsuccessful HTTP status.',
  });
  assert.deepEqual(summarizeAttempt({ error: { stage: 'response-output', message: 'raw refusal' } }), {
    status: 'api-failed', errorSummary: 'API response was incomplete or contained no usable output.',
  });
  assert.deepEqual(summarizeAttempt({ error: { stage: 'unknown', message: 'stack and key' } }), {
    status: 'api-failed', errorSummary: 'API generation failed.',
  });
});

test('timeout and publication failure take precedence and use fixed summaries', () => {
  assert.deepEqual(summarizeAttempt({ timedOut: true, error: { stage: 'response-body', message: 'partial secret' } }), {
    status: 'timeout', errorSummary: 'Timed out before a usable model was produced.',
  });
  assert.deepEqual(summarizeAttempt({ publishError: 'stack with provider response' }), {
    status: 'publish-failed', errorSummary: 'Generated model could not be published.',
  });
});

test('historical success behavior and safe metadata are preserved', () => {
  const attempt = publicAttempt({ runId: 'old-success', prompt: 'x\nUSER PROMPT: a cat\n', method: 'voxel-program',
    startedAt: '2026-09-01T00:00:00.000Z', generationMs: 123, publishedUrl: '/experiments/old.json', ...metadata }, 'fallback');
  assert.equal(attempt.status, 'published');
  assert.equal(attempt.errorSummary, null);
  assert.equal(attempt.prompt, 'a cat');
  assert.equal(attempt.runtime, metadata.runtime);
  assert.equal(attempt.actualModel, metadata.actualModel);
  assert.equal(attempt.timingScope, metadata.timingScope);
});

test('publisher preserves ordering and excludes secrets and raw response data', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'blawx-publish-attempts-'));
  const runsRoot = join(projectRoot, 'experiments', 'runs');
  await mkdir(join(runsRoot, 'b'), { recursive: true });
  await mkdir(join(runsRoot, 'a'), { recursive: true });
  await writeFile(join(runsRoot, 'b', 'record.json'), JSON.stringify({ runId: 'second', startedAt: '2026-09-02T00:00:00.000Z',
    error: { stage: 'response-json', message: 'sk-secret raw body' }, rawResponse: '{"api_key":"sk-secret"}',
    requestBody: { input: 'private request' }, ...metadata }));
  await writeFile(join(runsRoot, 'a', 'record.json'), JSON.stringify({ runId: 'first', startedAt: '2026-09-01T00:00:00.000Z',
    publishedUrl: '/experiments/first.json', ...metadata }));
  const outputPath = join(projectRoot, 'public', 'examples', 'attempts.json');
  const { attempts } = await publishAttempts({ runsRoot, outputPath });
  assert.deepEqual(attempts.map(({ id }) => id), ['first', 'second']);
  assert.equal(attempts[1].errorSummary, 'API response could not be parsed.');
  const published = await readFile(outputPath, 'utf8');
  assert.doesNotMatch(published, /sk-secret|raw body|private request|rawResponse|requestBody|message/);
});

test('unsafe metadata strings are omitted as null', () => {
  const attempt = publicAttempt({ runtime: 'openai-responses-api\nSECRET=sk-key', requestedModel: '<script>alert(1)</script>' }, 'unsafe');
  assert.equal(attempt.runtime, null);
  assert.equal(attempt.requestedModel, null);
});
