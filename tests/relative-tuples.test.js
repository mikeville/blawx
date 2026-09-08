import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRelativeTuples, resolveRelativeTuples } from '../src/relative-tuples.js';

test('compact tuples preserve exact absolute tuple parity', () => {
  const ops = [
    ['e', 10, 10, 10, 4, 4, 4, 'W'],
    ['b', 12, 13, 12, 1, 1, 1, 'K'],
  ];
  assert.deepEqual(resolveRelativeTuples({ ops }).ops, ops);
});

test('relative tuples resolve forward references while retaining paint order', () => {
  const source = { ops: [
    ['@', 1, [0.5, 1, 0.5], [0, -1, 0], ['b', -1, 0, 0, 1, 1, 1, 'K']],
    ['e', 10, 10, 10, 4, 4, 4, 'W'],
  ] };
  assert.deepEqual(resolveRelativeTuples(source).ops, [
    ['b', 12, 13, 12, 1, 1, 1, 'K'],
    source.ops[1],
  ]);
  const model = expandRelativeTuples(source, { source: 'compact-relative' });
  assert.equal(model.meta.source, 'compact-relative');
  assert.equal(model.cells.find((cell) => cell.x === 12 && cell.y === 13 && cell.z === 12).color, 'white');
});

test('compact tuple schema rejects invalid roots, references, cycles, and nesting', () => {
  const box = ['b', 0, 0, 0, 1, 1, 1, 'R'];
  for (const source of [null, { ops: [box], extra: true }, { ops: [] }, { ops: Array(257).fill(box) }]) {
    assert.throws(() => resolveRelativeTuples(source));
  }
  assert.throws(() => resolveRelativeTuples({ ops: [['@', 1, [0, 0, 0], [0, 0, 0], box]] }), /reference index/);
  assert.throws(() => resolveRelativeTuples({ ops: [['@', 0.5, [0, 0, 0], [0, 0, 0], box], box] }), /reference index/);
  assert.throws(() => resolveRelativeTuples({ ops: [
    ['@', 1, [0, 0, 0], [0, 0, 0], box],
    ['@', 0, [0, 0, 0], [0, 0, 0], box],
  ] }), /cycle/);
  assert.throws(() => resolveRelativeTuples({ ops: [
    box,
    ['@', 0, [0, 0, 0], [0, 0, 0], ['@', 0, [0, 0, 0], [0, 0, 0], box]],
  ] }), /non-nested/);
});
