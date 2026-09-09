import test from 'node:test';
import assert from 'node:assert/strict';
import { generationDiagnosticRows } from '../src/generation-diagnostics.js';

test('reports fresh generation and browser timing without HTML rendering', () => {
  assert.deepEqual(generationDiagnosticRows({ metadata: {
    generationMs: 1_250,
    actualModel: 'actual-model',
    requestedModel: 'requested-model',
    timingScope: 'provider generation',
  } }, 1_500), [
    { label: 'Generation', value: '1.3 seconds' },
    { label: 'Browser wait', value: '1.5 seconds' },
    { label: 'Model', value: 'actual-model' },
    { label: 'Timing scope', value: 'provider generation' },
  ]);
});

test('cache hits never present historical metadata as current usage', () => {
  assert.deepEqual(generationDiagnosticRows({ cacheHit: true, metadata: {
    generationMs: 9_999,
    actualModel: 'historical-model',
  } }, 25), [
    { label: 'Generation', value: 'Exact-prompt cache hit · no new generation usage' },
  ]);
});

test('cache-only rows and examples do not fabricate generation diagnostics', () => {
  assert.deepEqual(generationDiagnosticRows({ metadata: { generationMs: 1_000 } }, undefined), []);
  assert.deepEqual(generationDiagnosticRows({}, 100), []);
});
