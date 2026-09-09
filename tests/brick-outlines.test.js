import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrickOutlineBatch,
  STUD_OUTLINE_SEGMENTS,
  buildBodyOutlinePositions,
  studOutlinePositionCount,
  writeStudOutlinePositions,
} from '../src/brick-outlines.js';

test('brick outlines keep twelve box edges and no face diagonals', () => {
  const positions = buildBodyOutlinePositions([{ x: 2, y: 3, z: 4, w: 2, h: 1, d: 4 }]);
  assert.equal(positions.length, 12 * 6);
  for (let cursor = 0; cursor < positions.length; cursor += 6) {
    const changedAxes = [0, 1, 2].filter(axis => positions[cursor + axis] !== positions[cursor + 3 + axis]);
    assert.equal(changedAxes.length, 1, 'every segment follows one box edge');
  }
});

test('stud outlines contain a full top rim, facing lower arc and two silhouette sides', () => {
  const stud = { x: 2, y: 3, z: 4 };
  const positions = new Float32Array(studOutlinePositionCount(1));
  writeStudOutlinePositions(positions, [stud], {
    radius: 0.3,
    height: 0.2,
    viewDirection: { x: 1, z: 0 },
    surfaceOffset: 0,
  });

  assert.equal(positions.length / 6, STUD_OUTLINE_SEGMENTS + STUD_OUTLINE_SEGMENTS / 2 + 2);
  for (let segment = 0; segment < STUD_OUTLINE_SEGMENTS; segment++) {
    assert.ok(Math.abs(positions[segment * 6 + 1] - 3.1) < 1e-6);
    assert.ok(Math.abs(positions[segment * 6 + 4] - 3.1) < 1e-6);
  }

  const lowerStart = STUD_OUTLINE_SEGMENTS * 6;
  const lowerEnd = (STUD_OUTLINE_SEGMENTS + STUD_OUTLINE_SEGMENTS / 2) * 6;
  for (let cursor = lowerStart; cursor < lowerEnd; cursor += 6) {
    assert.ok(positions[cursor] >= stud.x - 1e-6, 'lower arc stays on the camera-facing half');
    assert.ok(positions[cursor + 3] >= stud.x - 1e-6, 'lower arc stays on the camera-facing half');
  }

  for (let cursor = lowerEnd; cursor < positions.length; cursor += 6) {
    assert.equal(positions[cursor], positions[cursor + 3], 'silhouette side is vertical');
    assert.equal(positions[cursor + 2], positions[cursor + 5], 'silhouette side is vertical');
    assert.notEqual(positions[cursor + 1], positions[cursor + 4]);
  }
});

test('hidden entries retain fixed buffers with degenerate geometry', () => {
  const positions = new Float32Array(studOutlinePositionCount(1));
  writeStudOutlinePositions(positions, [{ x: 7, y: 8, z: 9, visible: false }], {
    radius: 0.3,
    height: 0.2,
    viewDirection: { x: 1, z: 0 },
  });
  for (let cursor = 0; cursor < positions.length; cursor += 3) {
    assert.deepEqual(Array.from(positions.slice(cursor, cursor + 3)), [7, 8, 9]);
  }
});

test('stud sidewall ink can remain dark while rims and body edges use light ink', () => {
  const batch = new BrickOutlineBatch({
    bodies: [{ x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 }],
    studs: [{ x: 0, y: 1, z: 0 }],
    studRadius: 0.3,
    studHeight: 0.2,
    color: 0xf4f4f4,
    sidewallColor: 0x171612,
  });

  assert.equal(batch.material.color.getHex(), 0xf4f4f4);
  assert.equal(batch.studSideMaterial.color.getHex(), 0x171612);
  batch.dispose();
});
