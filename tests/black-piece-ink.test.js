import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLACK_PIECE_OUTLINE_COLORS,
  DARK_BRICK_OUTLINE_COLOR,
  DEFAULT_BLACK_PIECE_OUTLINE,
  groupBrickOutlinesBySourceColor,
  isNearBlackSourceColor,
} from '../src/black-piece-ink.js';

test('near-black classification uses source palette tones rather than rendered face tones', () => {
  assert.equal(isNearBlackSourceColor('black'), true);
  assert.equal(isNearBlackSourceColor('blue'), false);
  assert.equal(isNearBlackSourceColor('darkGray'), false);
  assert.equal(isNearBlackSourceColor('#111111'), true);
  assert.equal(isNearBlackSourceColor('#0055bf'), false);
});

test('white trial splits source-black bodies and studs into one light batch', () => {
  const bodies = [
    { id: 'black-body', color: 'black' },
    { id: 'blue-body', color: 'blue' },
  ];
  const studs = [
    { id: 'black-stud', color: 'black' },
    { id: 'blue-stud', color: 'blue' },
  ];
  const groups = groupBrickOutlinesBySourceColor({ bodies, studs }, 'white');

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.kind), ['normal', 'light']);
  assert.deepEqual(groups[0].bodies, [bodies[1]]);
  assert.deepEqual(groups[0].studs, [studs[1]]);
  assert.equal(groups[0].color, DARK_BRICK_OUTLINE_COLOR);
  assert.deepEqual(groups[1].bodies, [bodies[0]]);
  assert.deepEqual(groups[1].studs, [studs[0]]);
  assert.equal(groups[1].color, BLACK_PIECE_OUTLINE_COLORS.white);
  assert.equal(groups[1].sidewallColor, DARK_BRICK_OUTLINE_COLOR);
});

test('soft mode changes only near-black linework and is the production fallback', () => {
  const data = {
    bodies: [{ id: 'black', color: 'black' }],
    studs: [{ id: 'blue', color: 'blue' }],
  };
  assert.equal(DEFAULT_BLACK_PIECE_OUTLINE, 'soft');
  for (const mode of [undefined, 'soft', 'unknown']) {
    const groups = groupBrickOutlinesBySourceColor(data, mode);
    assert.equal(groups.length, 2);
    assert.equal(groups.find(group => group.kind === 'light').color, BLACK_PIECE_OUTLINE_COLORS.soft);
    assert.equal(groups.find(group => group.kind === 'light').sidewallColor, DARK_BRICK_OUTLINE_COLOR);
  }

  const dark = groupBrickOutlinesBySourceColor(data, 'dark');
  assert.equal(dark.length, 1);
  assert.equal(dark[0].color, DARK_BRICK_OUTLINE_COLOR);
  assert.strictEqual(dark[0].bodies, data.bodies);
  assert.strictEqual(dark[0].studs, data.studs);
});
