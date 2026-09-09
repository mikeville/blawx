import test from 'node:test';
import assert from 'node:assert/strict';

import { createRectangularLayerGroups } from '../src/rectangular-layer-groups.js';

const brick = (id, x, y, z, w = 2, d = 1, color = 'red') => ({ id, x, y, z, w, d, color });

function rotateTranslate(bricks, quarterTurns) {
  return bricks.map((item) => {
    let { x, z, w, d } = item;
    for (let turn = 0; turn < quarterTurns; turn += 1) [x, z, w, d] = [-z - d, x, d, w];
    return { ...item, x: x + 30, z: z - 17, w, d, color: item.color === 'red' ? 'blue' : 'yellow' };
  });
}

function canonicalMembership(groups) {
  return groups.map(({ brickIds, course, fillRatio }) => ({
    brickIds: [...brickIds].sort(),
    course,
    fillRatio,
  })).sort((a, b) => a.course - b.course || a.brickIds.join(',').localeCompare(b.brickIds.join(',')));
}

test('keeps a bounded regular rectangle as one complete layer', () => {
  const bricks = [
    brick('a', 0, 2, 0), brick('b', 2, 2, 0), brick('c', 4, 2, 0), brick('d', 6, 2, 0),
    brick('e', 0, 2, 1), brick('f', 2, 2, 1), brick('g', 4, 2, 1), brick('h', 6, 2, 1),
  ];
  const groups = createRectangularLayerGroups(bricks);

  assert.deepEqual(groups, [{
    brickIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    course: 2,
    bounds: { minX: 0, maxX: 8, minZ: 0, maxZ: 2, width: 8, depth: 2 },
    fillRatio: 1,
  }]);
});

test('cuts only between bricks when count, span, or part-type bounds require row subdivision', () => {
  const row = [
    brick('a', 0, 1, 0, 2, 1, 'red'),
    brick('b', 2, 1, 0, 1, 1, 'blue'),
    brick('c', 3, 1, 0, 2, 1, 'red'),
    brick('d', 5, 1, 0, 1, 1, 'blue'),
  ];

  assert.deepEqual(
    createRectangularLayerGroups(row, { maxBricks: 2, maxSpan: 24, maxPartTypes: 4 })
      .map(({ brickIds }) => brickIds),
    [['a', 'b'], ['c', 'd']],
  );
  assert.deepEqual(
    createRectangularLayerGroups(row, { maxBricks: 12, maxSpan: 3, maxPartTypes: 4 })
      .map(({ brickIds }) => brickIds),
    [['a', 'b'], ['c', 'd']],
  );
  assert.deepEqual(
    createRectangularLayerGroups(row, { maxBricks: 12, maxSpan: 24, maxPartTypes: 1 })
      .map(({ brickIds }) => brickIds),
    [['a'], ['b'], ['c'], ['d']],
  );
});

test('reports holes without dropping or duplicating bricks', () => {
  const groups = createRectangularLayerGroups([
    brick('left', 0, 3, 0),
    brick('right', 4, 3, 0),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].brickIds, ['left', 'right']);
  assert.deepEqual(groups[0].bounds, { minX: 0, maxX: 6, minZ: 0, maxZ: 1, width: 6, depth: 1 });
  assert.equal(groups[0].fillRatio, 2 / 3);
});

test('is deterministic under input shuffling and stable across translation, palette changes, and quarter turns', () => {
  const bricks = [
    brick('a', 0, 1, 0, 2, 1, 'red'), brick('b', 2, 1, 0, 2, 1, 'blue'),
    brick('c', 0, 1, 1, 2, 1, 'blue'), brick('d', 2, 1, 1, 2, 1, 'red'),
    brick('e', 0, 2, 0, 4, 1, 'red'), brick('f', 0, 2, 1, 4, 1, 'blue'),
  ];
  const limits = { maxBricks: 2, maxSpan: 24, maxPartTypes: 4 };
  const expected = createRectangularLayerGroups(bricks, limits);
  assert.deepEqual(createRectangularLayerGroups([...bricks].reverse(), limits), expected);

  for (let rotation = 0; rotation < 4; rotation += 1) {
    const transformed = createRectangularLayerGroups(rotateTranslate(bricks, rotation), limits);
    assert.deepEqual(canonicalMembership(transformed), canonicalMembership(expected));
    assert.deepEqual(new Set(transformed.flatMap(({ brickIds }) => brickIds)), new Set(bricks.map(({ id }) => id)));
  }
});

test('rejects inputs that cannot fit a bounded partition', () => {
  assert.throws(
    () => createRectangularLayerGroups([brick('wide', 0, 1, 0, 4, 1)], { maxSpan: 3 }),
    /cannot fit/,
  );
  assert.throws(() => createRectangularLayerGroups([], { maxBricks: 0 }), /positive integer/);
  assert.throws(() => createRectangularLayerGroups([brick('same', 0, 1, 0), brick('same', 2, 1, 0)]), /Duplicate/);
});
