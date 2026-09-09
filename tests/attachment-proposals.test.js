import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { proposeAttachmentExtensions } from '../src/attachment-proposals.js';

const brick = (x, y, z, w = 1, d = 1, color = 'orange') => ({ x, y, z, w, d, color });

function resultFor(bricks) {
  const brickModel = { version: 1, kind: 'bricks', bricks };
  return { brickModel, assemblyPlan: createAssemblyPlan({ brickModel }) };
}

function rotate(bricks, turns, dx, dz, color) {
  return bricks.map((source) => {
    let item = { ...source, color };
    for (let turn = 0; turn < turns; turn += 1) item = {
      ...item, x: -item.z - item.d, z: item.x, w: item.d, d: item.w,
    };
    return { ...item, x: item.x + dx, z: item.z + dz };
  });
}

test('covered-lower proposals are deterministic across rotation, translation, and recoloring', () => {
  const source = [
    brick(0, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'blue'),
    brick(1, 1, 0, 1, 1, 'orange'),
    brick(0, 2, 0, 2, 1, 'blue'),
  ];
  for (let turns = 0; turns < 4; turns += 1) {
    const input = resultFor(rotate(source, turns, 14, -11, 'green'));
    const saved = structuredClone(input);
    const first = proposeAttachmentExtensions(input, { maxAddedCells: 4 });
    const second = proposeAttachmentExtensions(structuredClone(input), { maxAddedCells: 4 });
    assert.deepEqual(first, second);
    assert.equal(first.proposals.length, 1);
    const proposal = first.proposals[0];
    assert.equal(proposal.direction, 'covered-lower');
    assert.equal(proposal.addedCells.length, 1);
    assert.equal(proposal.addedCells[0].color, 'green');
    assert.equal(proposal.targetIds.length, 1);
    assert.equal(proposal.anchorIds.length, 1);
    assert.equal(proposal.newlyEngagedTargetCellCount, 1);
    assert.ok(proposal.supportRatio >= 0 && proposal.supportRatio <= 1);
    assert.equal(proposal.bricks.every((item) => !Object.hasOwn(item, 'id')), true);
    assert.deepEqual(input, saved);
  }
});

test('a disconnected unresolved join is targeted when rootFailureCount is zero', () => {
  const input = resultFor([
    brick(1, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'orange'),
  ]);
  assert.equal(input.assemblyPlan.stats.rootFailureCount, 0);
  assert.equal(input.assemblyPlan.graph.components.some(({ grounded }) => !grounded), true);

  const generated = proposeAttachmentExtensions(input, { maxAddedCells: 1 });
  assert.deepEqual(generated.proposals.map(({ direction }) => direction), ['covered-lower', 'seated-upper']);
  assert.equal(generated.proposals.every(({ targetIds, anchorIds }) => targetIds.length === 1 && anchorIds.length === 1), true);
  const seated = generated.proposals.find(({ direction }) => direction === 'seated-upper');
  assert.equal(seated.addedCells[0].color, 'orange');
  assert.equal(seated.newlyEngagedTargetCellCount, 1);
});

test('same-course collisions, uncovered additions, and exhausted budgets fail closed', () => {
  const blocked = resultFor([
    brick(0, 0, 0, 1, 1, 'blue'),
    brick(1, 0, 0, 1, 1, 'red'),
    brick(0, 1, 0, 1, 1, 'blue'),
    brick(1, 1, 0, 1, 1, 'orange'),
    brick(0, 2, 0, 2, 1, 'blue'),
  ]);
  assert.deepEqual(proposeAttachmentExtensions(blocked, { maxAddedCells: 4 }).proposals, []);
  assert.deepEqual(proposeAttachmentExtensions(blocked, { maxAddedCells: 0 }).proposals, []);

  const uncovered = resultFor([
    brick(0, 0, 0, 1, 1, 'blue'),
    brick(2, 0, 0, 1, 1, 'red'),
    brick(0, 1, 0, 1, 1, 'orange'),
    brick(2, 1, 0, 1, 1, 'orange'),
  ]);
  assert.deepEqual(proposeAttachmentExtensions(uncovered, { maxAddedCells: 4 }).proposals, []);
});

test('an anchor mentioned by an unresolved join cannot be reused', () => {
  const input = resultFor([
    brick(1, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'orange'),
  ]);
  const anchorId = input.assemblyPlan.bricks.find(({ y }) => y === 0).id;
  input.assemblyPlan.steps.push({
    id: 'synthetic-unresolved-anchor',
    kind: 'unresolved',
    newBrickIds: [],
    highlightBrickIds: [anchorId],
    issues: [{ code: 'no-stud-engagement', brickIds: [anchorId] }],
  });
  const generated = proposeAttachmentExtensions(input, { maxAddedCells: 4 });
  assert.deepEqual(generated.proposals, []);
  assert.equal(generated.stats.resolvedAnchorCount, 0);
});

test('proposal and cell budgets are validated and truncation is explicit', () => {
  const input = resultFor([
    brick(1, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'orange'),
  ]);
  const generated = proposeAttachmentExtensions(input, { maxAddedCells: 1, maxProposals: 1 });
  assert.equal(generated.proposals.length, 1);
  assert.equal(generated.stats.legalProposalCount, 2);
  assert.equal(generated.stats.truncated, true);
  assert.ok(generated.stats.rectanglesConsidered >= generated.stats.legalProposalCount);

  assert.throws(() => proposeAttachmentExtensions(input), /maxAddedCells/);
  assert.throws(() => proposeAttachmentExtensions(input, { maxAddedCells: -1 }), /maxAddedCells/);
  assert.throws(() => proposeAttachmentExtensions(input, { maxAddedCells: 1, maxProposals: 0 }), /maxProposals/);
});

test('bridged-upper crosses a one-stud gap within the endpoint corridor in every rotation', () => {
  const source = [
    brick(2, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'orange'),
  ];
  for (let turns = 0; turns < 4; turns += 1) {
    const input = resultFor(rotate(source, turns, 20, -7, 'tan'));
    const generated = proposeAttachmentExtensions(input, { maxAddedCells: 4 });
    const bridge = generated.proposals.find(({ direction }) => direction === 'bridged-upper');
    assert.ok(bridge);
    assert.equal(bridge.addedCells.length, 2);
    assert.equal(bridge.after[0].color, 'tan');
    assert.equal(bridge.supportedArea, 1);
    assert.equal(bridge.supportRatio, 1 / 3);
    assert.match(generated.stats.limitations, /25%/);
  }
});

test('bridged-upper rejects shifts beyond two studs, weak support, and occupied corridor cells', () => {
  const tooFar = resultFor([
    brick(3, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'orange'),
  ]);
  assert.equal(proposeAttachmentExtensions(tooFar, { maxAddedCells: 4 }).proposals
    .some(({ direction }) => direction === 'bridged-upper'), false);

  const weak = resultFor([
    brick(1, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 4, 'orange'),
  ]);
  assert.equal(proposeAttachmentExtensions(weak, { maxAddedCells: 4 }).proposals
    .some(({ direction }) => direction === 'bridged-upper'), false);

  const collision = resultFor([
    brick(2, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'orange'),
    brick(1, 1, 0, 1, 1, 'red'),
  ]);
  assert.equal(proposeAttachmentExtensions(collision, { maxAddedCells: 4 }).proposals
    .some(({ direction }) => direction === 'bridged-upper'), false);
});
