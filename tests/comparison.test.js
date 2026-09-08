import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonCost, filterComparisonRows, findFixtureIndex, formatSeconds, formatUsd, sortComparisonRows } from '../src/comparison.js';

const rows = [
  { shape: 2, subject: 'Coral reef', generationMs: null, apiEquivalentUsd: null },
  { shape: 10, subject: 'Pickup truck', generationMs: 20_544, apiEquivalentUsd: 0.0312 },
  { shape: 4, subject: 'Cat', generationMs: 9_001, apiEquivalentUsd: 0.0123 },
];

test('time and dollar sorting keep missing measurements last', () => {
  assert.deepEqual(sortComparisonRows(rows, 'time-asc').map((row) => row.shape), [4, 10, 2]);
  assert.deepEqual(sortComparisonRows(rows, 'dollars-desc').map((row) => row.shape), [10, 4, 2]);
  assert.deepEqual(sortComparisonRows(rows, 'shape-desc').map((row) => row.shape), [10, 4, 2]);
});

test('dollar sorting does not substitute a zero subscription charge for an unknown API equivalent', () => {
  const subscriptionUnknown = { shape: 11, recordedCostUsd: 0, apiEquivalentUsd: null };
  const estimated = { shape: 12, recordedCostUsd: null, apiEquivalentUsd: 0.04 };
  assert.deepEqual(sortComparisonRows([subscriptionUnknown, estimated], 'dollars-asc').map((row) => row.shape), [12, 11]);
  assert.deepEqual(sortComparisonRows([subscriptionUnknown, estimated], 'dollars-desc').map((row) => row.shape), [12, 11]);
});

test('cost basis changes dollar ranking without overwriting observed estimates', () => {
  const differentlyRanked = [
    { shape: 1, apiEquivalentUsd: 0.08, standardizedColdUsd: 0.03, standardizedWarmUsd: 0.01 },
    { shape: 2, apiEquivalentUsd: 0.04, standardizedColdUsd: 0.06, standardizedWarmUsd: null },
  ];
  assert.deepEqual(sortComparisonRows(differentlyRanked, 'dollars-asc', 'observed').map((row) => row.shape), [2, 1]);
  assert.deepEqual(sortComparisonRows(differentlyRanked, 'dollars-asc', 'cold').map((row) => row.shape), [1, 2]);
  assert.deepEqual(sortComparisonRows(differentlyRanked, 'dollars-asc', 'warm').map((row) => row.shape), [1, 2]);
  assert.equal(comparisonCost(differentlyRanked[0], 'observed'), 0.08);
});

test('formatters preserve useful timing and small-cost precision', () => {
  assert.equal(formatSeconds(20_544), '20.544 s');
  assert.equal(formatSeconds(null), '—');
  assert.equal(formatUsd(0.00321), '$0.0032');
  assert.equal(formatUsd(null), '—');
});

test('filter searches subject and configuration fields without case sensitivity', () => {
  const configured = rows.map((row) => ({ ...row, model: row.shape === 2 ? 'Astra' : 'Terra', reasoning: 'high' }));
  assert.deepEqual(filterComparisonRows(configured, 'REEF').map((row) => row.shape), [2]);
  assert.deepEqual(filterComparisonRows(configured, 'astra').map((row) => row.shape), [2]);
});

test('fixture lookup prefers stable URL, then id, then original shape number', () => {
  const entries = [
    { id: 'new', url: '/new.json', sourceKind: 'experiment', shapeNumber: 10 },
    { id: 'old', url: '/old.json', sourceKind: 'experiment', shapeNumber: 2 },
  ];
  assert.equal(findFixtureIndex({ shape: 2, url: '/old.json' }, entries), 1);
  assert.equal(findFixtureIndex({ id: 'new' }, entries), 0);
  assert.equal(findFixtureIndex({ shape: 10 }, entries), 0);
});
