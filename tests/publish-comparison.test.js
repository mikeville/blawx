import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildComparison, estimateCliApiEquivalent, publishComparison, standardizedCosts,
} from '../scripts/publish-comparison.mjs';

test('CLI estimate handles cached and cache-write input and counts reasoning output once', () => {
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 20,
    cache_write_input_tokens: 30,
    output_tokens: 40,
    reasoning_output_tokens: 25,
  };
  assert.equal(estimateCliApiEquivalent(usage, 'gpt-5.6-sol', 'fast'), 0.002316);
});

test('CLI estimate returns null for missing or inconsistent main counts and unsupported tiers', () => {
  assert.equal(estimateCliApiEquivalent({ output_tokens: 1 }, 'gpt-5.6-sol', 'fast'), null);
  assert.equal(estimateCliApiEquivalent({
    input_tokens: 10, cached_input_tokens: 8, cache_write_input_tokens: 3, output_tokens: 1,
  }, 'gpt-5.6-sol', 'fast'), null);
  assert.equal(estimateCliApiEquivalent({
    input_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1,
  }, 'gpt-5.6-sol', 'standard'), null);
});

test('standardized costs use fixed cold/warm input assumptions and count observed reasoning output once', () => {
  const usage = { output_tokens: 40, reasoning_output_tokens: 25 };
  const result = standardizedCosts(usage, 'gpt-5.6-sol', 'fast');
  assert.equal(result.coldUsd, 0.0136);
  assert.equal(result.warmUsd, 0.00352);
  assert.match(result.basis, /1,500 uncached input tokens/);
  assert.match(result.basis, /already includes reasoning/);
});

test('standardized costs are null for unknown model, tier, or observed output', () => {
  const missing = { coldUsd: null, warmUsd: null, basis: null };
  assert.deepEqual(standardizedCosts({}, 'gpt-5.6-sol', 'fast'), missing);
  assert.deepEqual(standardizedCosts({ output_tokens: 10 }, 'unknown', 'fast'), missing);
  assert.deepEqual(standardizedCosts({ output_tokens: 10 }, 'gpt-5.6-sol', 'standard'), missing);
});

test('publisher preserves index order, applies Shape32 correction, and reads staged metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'comparison-'));
  await mkdir(join(root, 'public', 'experiments'), { recursive: true });
  await mkdir(join(root, 'public', 'staged'), { recursive: true });
  const index = Array.from({ length: 32 }, (_, indexOffset) => ({
    id: `run-${indexOffset + 1}`, label: `subject ${indexOffset + 1} · generated`, url: `/experiments/run-${indexOffset + 1}.json`,
  }));
  index.push({ id: 'staged-id', label: 'stage subject · staged', url: '/staged/model.json' });
  await writeFile(join(root, 'public', 'experiments', 'index.json'), JSON.stringify(index));
  await writeFile(join(root, 'public', 'experiments', 'feedback.json'), JSON.stringify({ 32: 'corrected', 33: 'staged' }));
  for (let shape = 1; shape <= 32; shape += 1) {
    const id = `run-${shape}`;
    await mkdir(join(root, 'experiments', 'runs', id), { recursive: true });
    await writeFile(join(root, 'experiments', 'runs', id, 'record.json'), JSON.stringify({
      runId: id, prompt: `USER PROMPT: subject ${shape}`, runtime: 'openai-responses-api',
      requestedModel: 'gpt-5.6-sol', reasoningEffort: 'low', generationMs: shape,
      timingScope: 'measured', cost: { amountUsd: 0.5 },
    }));
  }
  await writeFile(join(root, 'experiments', 'shape32-cost-correction.json'), JSON.stringify({ runId: 'run-32', amountUsd: 0.25 }));
  await writeFile(join(root, 'public', 'staged', 'model.json'), JSON.stringify({ meta: {
    prompt: 'USER PROMPT: stage subject', generationMs: 123, timingScope: 'stage sum',
  } }));

  const rows = await buildComparison(root);
  assert.deepEqual(rows.map((row) => row.shape), Array.from({ length: 33 }, (_, i) => i + 1));
  assert.equal(rows[31].recordedCostUsd, 0.25);
  assert.equal(rows[31].apiEquivalentUsd, 0.25);
  assert.equal(rows[31].feedback, 'corrected');
  assert.equal(rows[32].subject, 'stage subject');
  assert.equal(rows[32].generationMs, 123);
  assert.equal(rows[32].recordedCostUsd, null);
  const outputPath = join(root, 'public', 'experiments', 'comparison.json');
  await publishComparison(root, { outputPath });
  assert.deepEqual(JSON.parse(await readFile(outputPath)), rows);
});
