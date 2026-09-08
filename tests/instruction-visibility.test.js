import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateInstructionVisibility } from '../src/instruction-visibility.js';

const brick = (id, x, y, z, w = 1, d = 1) => ({ id, x, y, z, w, d, color: 'orange' });

test('default instruction view rejects a source operation hidden behind final geometry', () => {
  const hidden = brick('hidden', 0, 0, 0);
  // At the 135-degree isometric view this upper plate covers the lower brick's projection.
  const blocker = brick('blocker', -1, 1, -3, 4, 4);
  const result = evaluateInstructionVisibility({
    visibleBricks: [hidden, blocker],
    highlightGroups: [{ id: 'earlier-step', bricks: [hidden] }],
  });

  assert.equal(result.passes, false);
  assert.equal(result.truncated, false);
  assert.equal(result.groups[0].visibleBrickCount, 0);
});

test('covered top remains eligible when the ordinary isometric view exposes a side', () => {
  const lower = brick('lower', 0, 0, 0, 2, 2);
  const upper = brick('upper', 0, 1, 0, 2, 2);
  const result = evaluateInstructionVisibility({
    visibleBricks: [lower, upper],
    highlightGroups: [
      { id: 'lower-course', bricks: [lower] },
      { id: 'upper-course', bricks: [upper] },
    ],
  });

  assert.equal(result.passes, true);
  assert.deepEqual(result.groups.map(({ visibleBrickCount }) => visibleBrickCount), [1, 1]);
});

test('ray budget fails closed when it cannot examine one brick from every source group', () => {
  const first = brick('first', 0, 0, 0);
  const second = brick('second', 3, 0, 0);
  const result = evaluateInstructionVisibility({
    visibleBricks: [first, second],
    highlightGroups: [
      { id: 'step-1', bricks: [first] },
      { id: 'step-2', bricks: [second] },
    ],
    maxRayTests: 9,
  });

  assert.equal(result.passes, false);
  assert.equal(result.truncated, true);
  assert.equal(result.testedHighlightBrickCount, 0);
});
