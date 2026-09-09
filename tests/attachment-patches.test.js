import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { proposeAttachmentPatches } from '../src/attachment-patches.js';

const brick = (x, y, z, w = 1, d = 1, color = 'orange') => ({ x, y, z, w, d, color });

function resultFor(bricks) {
  const brickModel = { version: 1, kind: 'bricks', bricks };
  return { brickModel, assemblyPlan: createAssemblyPlan({ brickModel }) };
}

function rotate(bricks, turns, dx, dz, colors = ['blue', 'orange']) {
  return bricks.map((source, index) => {
    let item = { ...source, color: colors[index] ?? source.color };
    for (let turn = 0; turn < turns; turn += 1) item = {
      ...item, x: -item.z - item.d, z: item.x, w: item.d, d: item.w,
    };
    return { ...item, x: item.x + dx, z: item.z + dz };
  });
}

test('same-part covered patches are deterministic across rotation, translation, and color', () => {
  const source = [brick(0, 0, 0, 4, 1), brick(1, 1, 1, 4, 1)];
  for (let turns = 0; turns < 4; turns += 1) {
    const input = resultFor(rotate(source, turns, 18, -9, ['green', 'tan']));
    const saved = structuredClone(input);
    const first = proposeAttachmentPatches(input, { maxAddedCells: 4, maxAdditionalParts: 0 });
    const second = proposeAttachmentPatches(structuredClone(input), { maxAddedCells: 4, maxAdditionalParts: 0 });
    assert.deepEqual(first, second);
    assert.equal(first.proposals.length, 1);
    const proposal = first.proposals[0];
    assert.equal(proposal.direction, 'covered-patch');
    assert.equal(proposal.before.length, 1);
    assert.equal(proposal.after.length, 1);
    assert.equal(proposal.additionalPartCount, 0);
    assert.equal(proposal.addedCells.length, 4);
    assert.equal(proposal.addedCells.every(({ color }) => color === 'green'), true);
    assert.equal(proposal.bricks.every((item) => !Object.hasOwn(item, 'id')), true);
    assert.deepEqual(input, saved);
  }
});

test('optional one-part retiling can extend a saturated 4x2 interface', () => {
  const input = resultFor([
    brick(0, 0, 2, 4, 2, 'blue'),
    brick(0, 1, 0, 2, 2, 'orange'),
  ]);
  const generated = proposeAttachmentPatches(input, { maxAddedCells: 2, maxAdditionalParts: 1 });
  const expected = generated.proposals.find(({ after, addedCells }) => after.length === 2
    && addedCells.length === 2 && after.some(({ x, y, z, w, d }) => x === 0 && y === 0 && z === 1 && w === 2 && d === 3)
    && after.some(({ x, y, z, w, d }) => x === 2 && y === 0 && z === 2 && w === 2 && d === 2));
  assert.ok(expected);
  assert.equal(expected.additionalPartCount, 1);
  assert.deepEqual(expected.addedCells, [
    { x: 0, y: 0, z: 1, color: 'blue' },
    { x: 1, y: 0, z: 1, color: 'blue' },
  ]);
});

test('collisions, insufficient cell budgets, and unavailable extra parts fail closed', () => {
  const source = [brick(0, 0, 0, 4, 1, 'blue'), brick(1, 1, 1, 4, 1, 'orange')];
  assert.deepEqual(proposeAttachmentPatches(resultFor(source), {
    maxAddedCells: 3, maxAdditionalParts: 0,
  }).proposals, []);

  const blocked = resultFor([
    ...source,
    brick(0, 0, 1, 4, 1, 'red'),
  ]);
  const blockedTargetId = blocked.assemblyPlan.bricks.find(({ y }) => y === 1).id;
  blocked.assemblyPlan.steps.push({
    id: 'synthetic-blocked-root', kind: 'unresolved', newBrickIds: [blockedTargetId],
    highlightBrickIds: [blockedTargetId],
    issues: [{ code: 'unsupported-addition', brickIds: [blockedTargetId] }],
  });
  assert.deepEqual(proposeAttachmentPatches(blocked, {
    maxAddedCells: 4, maxAdditionalParts: 0,
  }).proposals, []);

  const saturated = resultFor([brick(0, 0, 2, 4, 2, 'blue'), brick(0, 1, 0, 2, 2, 'orange')]);
  assert.deepEqual(proposeAttachmentPatches(saturated, {
    maxAddedCells: 2, maxAdditionalParts: 0,
  }).proposals, []);
});

test('an unresolved or ungrounded lower brick is never an attachment anchor', () => {
  const input = resultFor([brick(0, 0, 0, 4, 1, 'blue'), brick(1, 1, 1, 4, 1, 'orange')]);
  const anchorId = input.assemblyPlan.bricks.find(({ y }) => y === 0).id;
  input.assemblyPlan.steps.push({
    id: 'synthetic-unresolved-anchor', kind: 'unresolved', newBrickIds: [],
    highlightBrickIds: [anchorId], issues: [{ code: 'no-stud-engagement', brickIds: [anchorId] }],
  });
  const generated = proposeAttachmentPatches(input, { maxAddedCells: 4, maxAdditionalParts: 0 });
  assert.deepEqual(generated.proposals, []);
  assert.equal(generated.stats.resolvedAnchorCount, 0);
});

test('options and output truncation are explicit and bounded', () => {
  const input = resultFor([brick(0, 0, 2, 4, 2, 'blue'), brick(0, 1, 0, 2, 2, 'orange')]);
  const generated = proposeAttachmentPatches(input, {
    maxAddedCells: 2, maxAdditionalParts: 1, maxProposals: 1,
  });
  assert.equal(generated.proposals.length, 1);
  assert.ok(generated.stats.legalProposalCount > 1);
  assert.equal(generated.stats.truncated, true);
  assert.ok(generated.stats.patchVisits <= generated.stats.patchVisitLimit);
  assert.ok(generated.stats.searchNodes <= generated.stats.searchNodeLimit);
  assert.ok(generated.stats.additionCombinationCount <= generated.stats.additionCombinationLimit);
  assert.equal(generated.stats.additionCombinationLimit, 4096);

  assert.throws(() => proposeAttachmentPatches(input), /maxAddedCells/);
  assert.throws(() => proposeAttachmentPatches(input, { maxAddedCells: -1 }), /maxAddedCells/);
  assert.throws(() => proposeAttachmentPatches(input, { maxAddedCells: 1, maxProposals: 0 }), /maxProposals/);
  assert.throws(() => proposeAttachmentPatches(input, { maxAddedCells: 1, maxAdditionalParts: -1 }), /maxAdditionalParts/);
});

test('unchanged neighboring padding is removed before actual deltas are deduplicated', () => {
  const input = resultFor([
    brick(0, 0, 0, 4, 1, 'blue'),
    brick(4, 0, 0, 1, 1, 'blue'),
    brick(1, 1, 1, 4, 1, 'orange'),
  ]);
  const generated = proposeAttachmentPatches(input, { maxAddedCells: 4, maxAdditionalParts: 0 });
  const signatures = generated.proposals.map(({ signature }) => signature);
  assert.equal(new Set(signatures).size, signatures.length);
  for (const proposal of generated.proposals) {
    const beforeKeys = new Set(proposal.before.map(({ x, y, z, w, d, color }) => `${x},${y},${z}:${w}x${d}:${color}`));
    assert.equal(proposal.after.some(({ x, y, z, w, d, color }) => beforeKeys.has(`${x},${y},${z}:${w}x${d}:${color}`)), false);
  }
  const direct = generated.proposals.filter(({ before, after }) => before.length === 1
    && before[0].x === 0 && before[0].w === 4 && after.length === 1 && after[0].w === 4 && after[0].d === 2);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].changedBrickCount, 2);
  assert.equal(direct[0].iconicBrickGain, 1);
});
