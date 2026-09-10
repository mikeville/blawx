import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideSectionsFromRanges } from '../src/guide-sections.js';
import { createBalancedSemanticProposal } from '../src/semantic-balanced-grouping.js';
import { createSemanticGuideInput, validateSemanticGuideAnnotation } from '../src/semantic-guide.js';

function inputWithSteps(count, { joinAt = new Set() } = {}) {
  const bricks = Array.from({ length: count - joinAt.size }, (_, index) => ({
    id: `brick-${index + 1}`, x: index % 20, y: Math.floor(index / 20), z: 0, w: 1, d: 1,
    color: index % 2 ? 'red' : 'blue',
  }));
  let brickIndex = 0;
  const steps = Array.from({ length: count }, (_, index) => {
    const brick = joinAt.has(index) ? null : bricks[brickIndex++];
    return {
      id: `step-${index + 1}`, moduleId: 'module-1', kind: brick ? 'build' : 'join',
      label: brick ? 'Build' : 'Attach', newBrickIds: brick ? [brick.id] : [],
      insertionDirection: 'down', issues: [],
    };
  });
  const plan = {
    version: 1, bricks,
    modules: [{ id: 'module-1', label: 'Build area', kind: 'grounded', status: 'ready', componentIds: [], brickIds: bricks.map(({ id }) => id) }],
    steps, graph: { edges: [] },
    inventory: bricks.map((brick) => ({ key: brick.id, w: 1, d: 1, color: brick.color, count: 1 })),
  };
  return createSemanticGuideInput({ plan, subject: 'synthetic construction' });
}

function repeatedInput(repeatCount) {
  const ordinaryBricks = Array.from({ length: repeatCount + 1 }, (_, index) => ({
    id: `ordinary-${index}`, x: index, y: 0, z: 20, w: 1, d: 1, color: 'blue',
  }));
  const repeatedBricks = Array.from({ length: repeatCount }, (_, index) => ({
    id: `repeat-${index}`, x: index * 4, y: 0, z: 0, w: 2, d: 1, color: 'red',
  }));
  const bricks = [...ordinaryBricks, ...repeatedBricks];
  const modules = [
    { id: 'ordinary', label: 'Main build', kind: 'grounded', status: 'ready', componentIds: [], brickIds: ordinaryBricks.map(({ id }) => id) },
    ...repeatedBricks.map((brick, index) => ({
      id: `repeat-module-${index}`, label: 'Matching part', kind: 'grounded', status: 'ready', componentIds: [], brickIds: [brick.id],
    })),
  ];
  const steps = [];
  const ranges = [];
  for (let index = 0; index < repeatCount; index += 1) {
    const ordinary = {
      id: `ordinary-step-${index}`, moduleId: 'ordinary', kind: 'build', label: 'Build',
      newBrickIds: [ordinaryBricks[index].id], insertionDirection: 'down', issues: [],
    };
    const join = {
      id: `join-step-${index}`, moduleId: 'ordinary', kind: 'join', label: 'Attach',
      newBrickIds: [], insertionDirection: 'down', issues: [],
    };
    const repeated = {
      id: `repeat-step-${index}`, moduleId: `repeat-module-${index}`, kind: 'build', label: 'Matching part',
      newBrickIds: [repeatedBricks[index].id], insertionDirection: 'down', issues: [],
    };
    steps.push(ordinary, join, repeated);
    ranges.push({ startStepId: ordinary.id, endStepId: join.id });
    ranges.push({ startStepId: repeated.id, endStepId: repeated.id });
  }
  const last = {
    id: 'ordinary-step-last', moduleId: 'ordinary', kind: 'build', label: 'Build',
    newBrickIds: [ordinaryBricks.at(-1).id], insertionDirection: 'down', issues: [],
  };
  steps.push(last);
  ranges.push({ startStepId: last.id, endStepId: last.id });
  const plan = {
    version: 1, bricks, modules, steps, graph: { edges: [] },
    inventory: bricks.map((brick) => ({ key: brick.id, w: brick.w, d: brick.d, color: brick.color, count: 1 })),
  };
  return createSemanticGuideInput({
    plan, guide: createGuideSectionsFromRanges(plan, ranges), subject: 'matching red supports',
  });
}

function numericRanges(input, proposal) {
  const indexes = new Map(input.steps.map((step, index) => [step.id, index]));
  return proposal.sections.map(({ startStepId, endStepId }) => [indexes.get(startStepId), indexes.get(endStepId)]);
}

test('balanced grouping is deterministic, immutable, valid, and does not oversplit a short guide', () => {
  const input = inputWithSteps(17);
  const before = structuredClone(input);
  const first = createBalancedSemanticProposal(input);
  const second = createBalancedSemanticProposal(structuredClone(input));
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.deepEqual(validateSemanticGuideAnnotation(input, first), first);
  assert.equal(first.sections.length, 2);
  assert.deepEqual(numericRanges(input, first), [[0, 7], [8, 16]]);
});

test('protected repeats remain exact and join-only steps stay covered by brick-bearing ranges', () => {
  const input = repeatedInput(2);
  assert.equal(input.protectedRanges.length, 2);
  const proposal = createBalancedSemanticProposal(input);
  const signatures = new Set(proposal.sections.map(({ startStepId, endStepId }) => `${startStepId}:${endStepId}`));
  for (const range of input.protectedRanges) {
    assert.ok(signatures.has(`${range.startStepId}:${range.endStepId}`));
  }
  const ranges = numericRanges(input, proposal);
  assert.deepEqual(ranges.flatMap(([start, end]) => input.steps.slice(start, end + 1)), input.steps);
  for (const [start, end] of ranges) {
    assert.ok(input.steps.slice(start, end + 1).some((step) => step.newBrickIds.length));
  }
});

test('protected ranges that require more than twelve sections fail honestly', () => {
  const input = repeatedInput(13);
  assert.equal(input.protectedRanges.length, 13);
  assert.throws(
    () => createBalancedSemanticProposal(input),
    /Protected ranges require at least 27 balanced semantic sections; maximum is 12/u,
  );
});

test('long inputs use bounded fallback work and keep balanced complete coverage', () => {
  const input = inputWithSteps(2_000, { joinAt: new Set(Array.from({ length: 80 }, (_, index) => index)) });
  const started = performance.now();
  const proposal = createBalancedSemanticProposal(input);
  const elapsed = performance.now() - started;
  const ranges = numericRanges(input, proposal);
  assert.equal(ranges.length, 12);
  assert.deepEqual(ranges.flatMap(([start, end]) => input.steps.slice(start, end + 1)), input.steps);
  assert.ok(Math.max(...ranges.map(([start, end]) => end - start + 1)) <= 168);
  assert.ok(ranges.every(([start, end]) => input.steps.slice(start, end + 1).some((step) => step.newBrickIds.length)));
  assert.ok(elapsed < 1_500, `expected bounded local work, took ${elapsed.toFixed(1)}ms`);
});
