import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRelativeProgram, resolveRelativeProgram } from '../src/relative-program.js';

test('anchors bounds, resolves forward references, and preserves paint order', () => {
  const result = resolveRelativeProgram({ nodes: [
    { id: 'eye', shape: ['b', -1, 0, 0, 1, 1, 1, 'K'], relativeTo: { id: 'head', anchor: [0.5, 1, 0.5], offset: [0, -1, 0] } },
    { id: 'head', shape: ['e', 10, 10, 10, 4, 4, 4, 'W'] },
  ] });
  assert.deepEqual(result.ops, [['b', 12, 13, 12, 1, 1, 1, 'K'], ['e', 10, 10, 10, 4, 4, 4, 'W']]);
});

test('translates primitives, lofts, and rings through every axis mapping', () => {
  const nodes = [{ id: 'base', shape: ['b', 8, 8, 8, 4, 4, 4, 'W'] }];
  for (const opcode of ['b', 'e', 't']) nodes.push({ id: opcode, shape: opcode === 't' ? ['t', -2, -2, -2, 2, 2, 2, 'R', 1, 1] : [opcode, -2, -2, -2, 2, 2, 2, 'R'], relativeTo: { id: 'base', anchor: [0, 0, 0], offset: [0, 0, 0] } });
  for (const axis of ['x', 'y', 'z']) {
    nodes.push({ id: `loft-${axis}`, shape: ['l', axis, 'box', 'B', [[-2, -3, -4, 2, 2], [0, -3, -4, 2, 2]]], relativeTo: { id: 'base', anchor: [0, 0, 0], offset: [0, 0, 0] } });
    nodes.push({ id: `ring-${axis}`, shape: ['r', axis, -2, 2, -3, -4, 1, 0.5, 'G'], relativeTo: { id: 'base', anchor: [0, 0, 0], offset: [0, 0, 0] } });
  }
  const { ops } = resolveRelativeProgram({ nodes });
  assert.deepEqual(ops.slice(1, 4).map((op) => op.slice(1, 4)), [[8, 8, 8], [8, 8, 8], [8, 8, 8]]);
  for (const op of ops.slice(4)) {
    if (op[0] === 'l') assert.deepEqual(op[4][0].slice(0, 3), [8, 9, 9]);
    else assert.deepEqual([op[2], op[4], op[5]], [8, 9, 9]);
  }
});

test('expansion retains caller metadata', () => {
  const model = expandRelativeProgram({ nodes: [{ id: 'a', shape: ['b', 0, 0, 0, 1, 1, 1, 'R'] }] }, { source: 'relative' });
  assert.equal(model.meta.source, 'relative');
});

test('local halfstep primitive origins and ring axial coordinates may resolve to final integers', () => {
  const { ops } = resolveRelativeProgram({ nodes: [
    { id: 'base', shape: ['b', 0, 0, 0, 3, 3, 3, 'W'] },
    { id: 'half-primitive', shape: ['b', -0.5, -0.5, -0.5, 1, 1, 1, 'R'], relativeTo: { id: 'base', anchor: [0.5, 0.5, 0.5], offset: [-0.5, -0.5, -0.5] } },
    { id: 'half-ring', shape: ['r', 'x', -0.5, 1, 1, 1, 1, 0.5, 'B'], relativeTo: { id: 'base', anchor: [0.5, 0, 0], offset: [-0.5, 1, 1] } },
  ] });
  assert.deepEqual(ops[1].slice(1, 4), [1, 1, 1]);
  assert.equal(ops[2][2], 1);
});

test('rejects source, node, reference, dependency, and limit violations', () => {
  const good = { id: 'a', shape: ['b', 0, 0, 0, 1, 1, 1, 'R'] };
  for (const source of [null, { nodes: [good], extra: true }, { nodes: [] }, { nodes: Array.from({ length: 257 }, (_, i) => ({ ...good, id: `n${i}` })) }]) assert.throws(() => resolveRelativeProgram(source));
  assert.throws(() => resolveRelativeProgram({ nodes: [{ ...good, extra: true }] }), /invalid fields/);
  assert.throws(() => resolveRelativeProgram({ nodes: [good, good] }), /Duplicate/);
  assert.throws(() => resolveRelativeProgram({ nodes: [{ ...good, id: 'bad id' }] }), /id is invalid/);
  assert.throws(() => resolveRelativeProgram({ nodes: [{ ...good, relativeTo: { id: 'missing', anchor: [0, 0, 0], offset: [0, 0, 0] } }] }), /Missing/);
  assert.throws(() => resolveRelativeProgram({ nodes: [{ ...good, relativeTo: { id: 'bad id', anchor: [0, 0, 0], offset: [0, 0, 0] } }] }), /relativeTo id/);
  assert.throws(() => resolveRelativeProgram({ nodes: [
    { ...good, id: 'a', relativeTo: { id: 'b', anchor: [0, 0, 0], offset: [0, 0, 0] } },
    { ...good, id: 'b', relativeTo: { id: 'a', anchor: [0, 0, 0], offset: [0, 0, 0] } },
  ] }), /cycle/);
  assert.throws(() => resolveRelativeProgram({ nodes: [{ ...good, relativeTo: { id: 'a', anchor: [0.25, 0, 0], offset: [0, 0, 0] } }] }), /anchor/);
  assert.throws(() => resolveRelativeProgram({ nodes: [{ ...good, relativeTo: { id: 'a', anchor: [0, 0, 0], offset: [0.25, 0, 0] } }] }), /multiple of 0.5/);
  assert.throws(() => resolveRelativeProgram({ nodes: [{ ...good, relativeTo: { id: 'a', anchor: [0, 0, 0], offset: [128.5, 0, 0] } }] }), /within/);
  assert.throws(() => resolveRelativeProgram({ nodes: [
    { id: 'child', shape: ['b', 0, 0, 0, 1, 1, 1, 'R'], relativeTo: { id: 'quarter-bounds', anchor: [0, 0, 0], offset: [0, 0, 0] } },
    { id: 'quarter-bounds', shape: ['l', 'x', 'box', 'W', [[0, 2, 2, 2.5, 2], [2, 2, 2, 2.5, 2]]] },
  ] }), /translation must resolve to halfsteps/);
});

test('rejects malformed local tuples, extrema, and invalid resolved global geometry', () => {
  const invalidShapes = [
    ['b', 0, 0, 0, 1, 1, 'R'],
    ['b', 0.5, 0, 0, 1, 1, 1, 'R'],
    ['t', 0, 0, 0, 2, 2, 2, 'R', 3, 1],
    ['l', 'x', 'box', 'R', [[0, 0, 0, 2, 2]]],
    ['r', 'x', 0, 1, 0, 0, 2, 2, 'R'],
  ];
  for (const shape of invalidShapes) assert.throws(() => resolveRelativeProgram({ nodes: [{ id: 'a', shape }] }));
  assert.throws(() => resolveRelativeProgram({ nodes: [{ id: 'a', shape: ['b', -1, 0, 0, 1, 1, 1, 'R'] }] }), /nonnegative/);
  assert.throws(() => resolveRelativeProgram({ nodes: [{ id: 'a', shape: ['b', 0, 0, 0, 65, 1, 1, 'R'] }] }), /no greater/);
});
