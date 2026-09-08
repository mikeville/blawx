import test from 'node:test';
import assert from 'node:assert/strict';
import { expandBidirectionalLoftProgram } from '../src/bidirectional-loft.js';
import { expandLoftProgram } from '../src/loft-program.js';

const reverseSections = (operation) => [...operation.slice(0, 4), [...operation[4]].reverse()];

test('ascending and descending lofts have exact voxel and color parity across axes and profiles', () => {
  for (const axis of ['x', 'y', 'z']) for (const profile of ['box', 'ellipse']) {
    const ascending = ['l', axis, profile, profile === 'box' ? 'B' : 'O', [
      [1, 4, 5, 2, 4],
      [3, 5, 4.5, 4, 3],
      [6, 6, 6, 6, 2],
    ]];
    const expected = expandBidirectionalLoftProgram({ ops: [ascending] }, { axis, profile });
    const actual = expandBidirectionalLoftProgram({ ops: [reverseSections(ascending)] }, { axis, profile });
    assert.deepEqual(actual, expected, `${axis} ${profile}`);
  }
});

test('descending loft normalization preserves operation paint order', () => {
  const descending = ['l', 'x', 'box', 'B', [[1, 0.5, 0.5, 1, 1], [0, 0.5, 0.5, 1, 1]]];
  const loftLast = expandBidirectionalLoftProgram({ ops: [
    ['b', 0, 0, 0, 1, 1, 1, 'R'], descending,
  ] });
  assert.equal(loftLast.cells[0].color, 'blue');
  const primitiveLast = expandBidirectionalLoftProgram({ ops: [
    descending, ['b', 0, 0, 0, 1, 1, 1, 'R'],
  ] });
  assert.equal(primitiveLast.cells[0].color, 'red');
});

test('normalization does not mutate the source program', () => {
  const source = { ops: [['l', 'z', 'ellipse', 'G', [
    [3, 4, 4, 3, 5], [1, 3, 5, 2, 4],
  ]], ['b', 0, 0, 0, 1, 1, 1, 'W']] };
  const snapshot = structuredClone(source);
  expandBidirectionalLoftProgram(source);
  assert.deepEqual(source, snapshot);
});

test('legacy loft expansion still rejects descending sections', () => {
  const source = { ops: [['l', 'x', 'box', 'R', [[2, 1, 1, 1, 1], [0, 1, 1, 1, 1]]]] };
  assert.throws(() => expandLoftProgram(source), /strictly increasing/);
  assert.doesNotThrow(() => expandBidirectionalLoftProgram(source));
});

test('bidirectional lofts reject equal, nonmonotonic, nonfinite, and malformed sections', () => {
  const loft = (sections) => ({ ops: [['l', 'x', 'box', 'R', sections]] });
  assert.throws(() => expandBidirectionalLoftProgram(loft([[0, 1, 1, 1, 1], [0, 1, 1, 1, 1]])), /strictly increasing or strictly decreasing/);
  assert.throws(() => expandBidirectionalLoftProgram(loft([[0, 1, 1, 1, 1], [2, 1, 1, 1, 1], [1, 1, 1, 1, 1]])), /strictly increasing or strictly decreasing/);
  assert.throws(() => expandBidirectionalLoftProgram(loft([[Infinity, 1, 1, 1, 1], [0, 1, 1, 1, 1]])), /must be finite/);
  assert.throws(() => expandBidirectionalLoftProgram({ ops: [['l', 'x', 'box', 'R', 'bad']] }), /between 2 and 16/);
  assert.throws(() => expandBidirectionalLoftProgram(loft([[1, 1], [0, 1, 1, 1, 1]])), /exactly 5 values/);
  assert.throws(() => expandBidirectionalLoftProgram({ ops: [['l', 'x', 'box', 'R', [], 'extra']] }), /exactly 5 values/);
});

test('legacy bounds, numeric, occupied-cell, and lattice-work caps apply after normalization', () => {
  assert.throws(() => expandBidirectionalLoftProgram({ ops: [
    ['l', 'x', 'box', 'R', [[0, 0, 1, 1, 1], [1, 1, 1, 1, 1]]],
  ] }), /axis bounds/);
  assert.throws(() => expandBidirectionalLoftProgram({ ops: [
    ['l', 'x', 'box', 'R', [[1, 1, 1, 1, 1], [0, 1.25, 1, 1, 1]]],
  ] }), /multiples of 0.5/);
  const maximalDescending = ['l', 'x', 'box', 'R', [[8, 32, 32, 64, 64], [0, 32, 32, 64, 64]]];
  assert.throws(() => expandBidirectionalLoftProgram({ ops: Array.from({ length: 9 }, () => maximalDescending) }), /lattice-work limit/);
  assert.throws(() => expandBidirectionalLoftProgram({ ops: [
    ['b', 0, 0, 0, 64, 13, 64, 'R'],
  ] }), /Occupied voxel count/);
});

test('source envelope and operation count are rejected before operation mapping', () => {
  let reads = 0;
  const invalidEnvelopeOps = new Proxy([['b']], { get(target, property, receiver) {
    if (property === 'map') reads += 1;
    return Reflect.get(target, property, receiver);
  } });
  assert.throws(() => expandBidirectionalLoftProgram({ ops: invalidEnvelopeOps, extra: true }), /exactly the ops field/);
  assert.equal(reads, 0);
  assert.throws(() => expandBidirectionalLoftProgram({ ops: Array.from({ length: 257 }, () => ['bad']) }), /256-source-operation limit/);
});
