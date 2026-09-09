import test from 'node:test';
import assert from 'node:assert/strict';

import { MODEL_STAGE_CAMERA, modelStageGeometry, modelStageOutlineGroups } from '../src/model-stage.js';
import { BLACK_PIECE_OUTLINE_COLORS, DARK_BRICK_OUTLINE_COLOR } from '../src/black-piece-ink.js';
import { LEGO_MOVIE, legoMovieDurationFrames } from '../src/model-stage-motion.js';

test('shared stage retains the approved reference motion and camera constants', () => {
  assert.equal(LEGO_MOVIE.fps, 10);
  assert.equal(legoMovieDurationFrames(), 5);
  assert.deepEqual(MODEL_STAGE_CAMERA, {
    azimuth: Math.PI * .75,
    elevation: Math.atan(1 / Math.sqrt(2)),
    fitPadding: 1.18,
    minimumDistance: 18,
    distanceScale: 3.2,
  });
});

test('raw stage geometry preserves cubic proportions and input data', () => {
  const model = { version: 1, kind: 'voxels', cells: [{ x: 2, y: 4, z: 6, color: 'black' }] };
  const before = JSON.stringify(model);
  const geometry = modelStageGeometry(model);
  assert.deepEqual(geometry.bodies[0], { x: 2.5, y: 4.5, z: 6.5, color: 'black', w: .96, h: .96, d: .96 });
  assert.deepEqual(geometry.studs, []);
  assert.equal(JSON.stringify(model), before);
});

test('frame geometry is independently derived for stable raw-model camera bounds', () => {
  const shown = modelStageGeometry({ version: 1, kind: 'voxels', cells: [{ x: 20, y: 0, z: 0, color: 'red' }] });
  const frame = modelStageGeometry({ version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }] });
  assert.notEqual(shown.bodies[0].x, frame.bodies[0].x);
  assert.equal(frame.bodies[0].x, .5);
});

test('shared stage uses soft ink only for source-black LEGO pieces', () => {
  const bodies = [
    { id: 'black-body', color: 'black' },
    { id: 'red-body', color: 'red' },
  ];
  const studs = [
    { id: 'black-stud', color: 'black' },
    { id: 'red-stud', color: 'red' },
  ];
  const groups = modelStageOutlineGroups({ kind: 'bricks' }, { bodies, studs });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.color), [
    DARK_BRICK_OUTLINE_COLOR,
    BLACK_PIECE_OUTLINE_COLORS.soft,
  ]);
  assert.deepEqual(groups[0].bodies, [bodies[1]]);
  assert.deepEqual(groups[0].studs, [studs[1]]);
  assert.deepEqual(groups[1].bodies, [bodies[0]]);
  assert.deepEqual(groups[1].studs, [studs[0]]);
  assert.equal(groups[1].sidewallColor, DARK_BRICK_OUTLINE_COLOR);
});

test('shared stage keeps raw voxel outlines in one dark batch', () => {
  const data = {
    bodies: [{ color: 'black' }, { color: 'red' }],
    studs: [],
  };
  const groups = modelStageOutlineGroups({ kind: 'voxels' }, data);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].color, DARK_BRICK_OUTLINE_COLOR);
  assert.strictEqual(groups[0].bodies, data.bodies);
});
