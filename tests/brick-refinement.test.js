import test from 'node:test';
import assert from 'node:assert/strict';

import { proposeBrickRefinements } from '../src/brick-refinement.js';

const brick = (x, y, z, w = 1, d = 1, color = 'orange') => ({ x, y, z, w, d, color });
const model = (bricks) => ({ version: 1, kind: 'bricks', bricks });

function cells(bricks) {
  const result = new Map();
  for (const item of bricks) for (let dz = 0; dz < item.d; dz += 1) for (let dx = 0; dx < item.w; dx += 1) {
    const key = `${item.x + dx},${item.y},${item.z + dz}`;
    assert.equal(result.has(key), false, `overlap at ${key}`);
    result.set(key, item.color);
  }
  return result;
}

test('proposes the cited 2x2 pair as one exact 2x4 replacement', () => {
  const source = model([
    brick(20, 0, 11, 1, 1),
    brick(20, 1, 11, 2, 2),
    brick(20, 1, 13, 2, 2),
  ]);
  const result = proposeBrickRefinements(source, { maxSearchNodes: 0 });
  const proposal = result.proposals.find(({ before, after }) => before.length === 2 && after.length === 1
    && after[0].x === 20 && after[0].y === 1 && after[0].z === 11 && after[0].w === 2 && after[0].d === 4);
  assert.ok(proposal);
  assert.deepEqual(cells(proposal.bricks), cells(source.bricks));
  assert.equal(proposal.localBefore.unsupportedBrickCount, 1);
  assert.equal(proposal.localAfter.unsupportedBrickCount, 0);
  assert.equal(result.stats.searchNodes, 0);
});

test('retiles a 1x1 beside a 1x4 into 1x2 and 1x3 without changing cells', () => {
  const source = model([brick(0, 0, 0, 1, 1), brick(1, 0, 0, 4, 1)]);
  const result = proposeBrickRefinements(source);
  const proposal = result.proposals.find(({ localBefore, localAfter }) => localBefore.oneByOneCount === 1
    && localAfter.oneByOneCount === 0);
  assert.ok(proposal);
  assert.deepEqual(cells(proposal.bricks), cells(source.bricks));
  assert.deepEqual(proposal.after.map(({ w, d }) => [w, d]).sort(), [[2, 1], [3, 1]]);
});

test('never crosses color or course boundaries and preserves holes', () => {
  const source = model([
    brick(0, 0, 0, 1, 1, 'orange'), brick(1, 0, 0, 1, 1, 'white'),
    brick(0, 1, 0, 1, 1, 'orange'),
    brick(4, 0, 0, 2, 1), brick(4, 0, 1, 1, 1), brick(5, 0, 2, 1, 1),
  ]);
  const result = proposeBrickRefinements(source);
  const expected = cells(source.bricks);
  for (const proposal of result.proposals) {
    assert.deepEqual(cells(proposal.bricks), expected);
    assert.equal(new Set(proposal.before.map(({ color }) => color)).size, 1);
    assert.equal(new Set(proposal.before.map(({ y }) => y)).size, 1);
    assert.equal(proposal.bricks.some((item) => item.x <= 5 && item.x + item.w > 5 && item.z <= 1 && item.z + item.d > 1), false);
  }
});

test('can rotate an unsupported 2x4 patch around supported neighbors', () => {
  const source = model([
    brick(0, 0, 2, 1, 1),
    brick(0, 1, 0, 4, 2),
    brick(0, 1, 2, 2, 2),
  ]);
  const result = proposeBrickRefinements(source);
  const proposal = result.proposals.find(({ localBefore, localAfter, after }) =>
    localAfter.unsupportedFootprintArea < localBefore.unsupportedFootprintArea
    && after.some(({ w, d }) => w === 2 && d === 4));
  assert.ok(proposal);
  assert.deepEqual(cells(proposal.bricks), cells(source.bricks));
});

test('honors budgets and returns deterministic proposals', () => {
  const source = model([
    brick(0, 0, 0, 1, 1), brick(1, 0, 0, 4, 1),
    brick(0, 1, 0, 2, 2), brick(0, 1, 2, 2, 2),
  ]);
  const limited = proposeBrickRefinements(source, { maxPatches: 1, maxSearchNodes: 1 });
  assert.ok(limited.stats.patchesVisited <= 1);
  assert.ok(limited.stats.searchNodes <= 1);
  assert.equal(limited.stats.limitReached, true);
  assert.ok(limited.proposals.every(({ bricks }) => bricks.length <= source.bricks.length));
  assert.deepEqual(proposeBrickRefinements(source), proposeBrickRefinements(structuredClone(source)));
});

test('can reserve proposals for an actual unsupported target without admitting cosmetic work', () => {
  const target = brick(0, 1, 2, 2, 2);
  const source = model([
    brick(0, 0, 0),
    brick(0, 1, 0, 2, 2), target,
    brick(10, 0, 0, 2, 2), brick(10, 0, 2, 2, 2),
  ]);
  const result = proposeBrickRefinements(source, { targetBricks: [{ ...target }], supportOnly: true });
  assert.ok(result.proposals.length > 0);
  assert.ok(result.proposals.every(({ before, localBefore, localAfter }) =>
    before.some((item) => item.x === target.x && item.y === target.y && item.z === target.z
      && item.w === target.w && item.d === target.d && item.color === target.color)
    && localAfter.unsupportedFootprintArea < localBefore.unsupportedFootprintArea));
  assert.equal(result.proposals.some(({ before }) => before.some(({ x }) => x === 10)), false);
});
