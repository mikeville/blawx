import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDetailTuples, expandDetailProgram } from '../src/detail-program.js';

const frame = (axis) => ({ type: 'frame', x: 1, y: 2, z: 3, w: 5, h: 7, d: 6, axis, thickness: 1, color: 'D' });
const at = (model, x, y, z) => model.cells.find((cell) => cell.x === x && cell.y === y && cell.z === z);
const bays = (axis = 'z') => ({ type: 'bays', x: 1, y: 2, z: 3, axis, columns: 2, rows: 2, bayW: 2, bayH: 3, pier: 1, beam: 1, depth: 2, color: 'D' });

for (const axis of ['x', 'y', 'z']) test(`frame preserves a hollow opening along ${axis}`, () => {
  const model = expandDetailProgram({ ops: [frame(axis)] });
  const center = { x: 3, y: 5, z: 5 };
  assert.equal(at(model, center.x, center.y, center.z), undefined);
  if (axis === 'x') assert.ok(at(model, 1, center.y, center.z) === undefined && at(model, 1, 2, 3));
  if (axis === 'y') assert.ok(at(model, center.x, 2, center.z) === undefined && at(model, 1, 2, 3));
  if (axis === 'z') assert.ok(at(model, center.x, center.y, 3) === undefined && at(model, 1, 2, 3));
  assert.equal(compileDetailTuples({ ops: [frame(axis)] }).length, 4);
});

test('frames are additive and normal last-write color order applies', () => {
  const model = expandDetailProgram({ ops: [
    ['b', 0, 0, 0, 5, 5, 2, 'R'],
    { type: 'frame', x: 0, y: 0, z: 0, w: 5, h: 5, d: 2, axis: 'z', thickness: 1, color: 'B' },
  ] });
  assert.equal(at(model, 2, 2, 0).color, 'red', 'frame does not carve an earlier solid');
  assert.equal(at(model, 0, 2, 0).color, 'blue', 'later frame overwrites its perimeter');
});

for (const axis of ['x', 'y', 'z']) test(`bays make repeated through-openings along ${axis}`, () => {
  const model = expandDetailProgram({ ops: [bays(axis)] });
  assert.equal(model.cells.length, 78);
  assert.equal(compileDetailTuples({ ops: [bays(axis)] }).length, 9);
  if (axis === 'z') {
    assert.equal(at(model, 2, 3, 3), undefined);
    assert.equal(at(model, 5, 7, 4), undefined);
    assert.ok(at(model, 1, 3, 3) && at(model, 2, 2, 3));
  } else if (axis === 'x') {
    assert.equal(at(model, 1, 3, 4), undefined);
    assert.equal(at(model, 2, 7, 7), undefined);
    assert.ok(at(model, 1, 3, 3) && at(model, 1, 2, 4));
  } else {
    assert.equal(at(model, 2, 2, 4), undefined);
    assert.equal(at(model, 5, 3, 8), undefined);
    assert.ok(at(model, 1, 2, 4) && at(model, 2, 2, 3));
  }
});

test('bays reject aperture obstructions across operation order but allow solid-bar overlap', () => {
  const apertureCell = ['b', 2, 3, 3, 1, 1, 1, 'R'];
  assert.throws(() => expandDetailProgram({ ops: [apertureCell, bays()] }), /obstructs a bays aperture/);
  assert.throws(() => expandDetailProgram({ ops: [bays(), apertureCell] }), /obstructs a bays aperture/);
  const allowed = expandDetailProgram({ ops: [bays(), ['b', 1, 3, 3, 1, 1, 1, 'R'], ['b', 30, 30, 30, 1, 1, 1, 'B']] });
  assert.equal(at(allowed, 1, 3, 3).color, 'red');
  assert.equal(at(allowed, 30, 30, 30).color, 'blue');
});

test('profiles step extents and support signed shifts', () => {
  const source = { ops: [{ type: 'profile', x: 10, y: 1, z: 10, w: 9, d: 7, levels: 3, rise: 2, insetX: 1, insetZ: 1, shiftX: -2, shiftZ: 1, color: 'L' }] };
  assert.deepEqual(compileDetailTuples(source), [
    ['b', 10, 1, 10, 9, 2, 7, 'L'],
    ['b', 9, 3, 12, 7, 2, 5, 'L'],
    ['b', 8, 5, 14, 5, 2, 3, 'L'],
  ]);
  const model = expandDetailProgram(source);
  assert.deepEqual({ minX: Math.min(...model.cells.map(c => c.x)), maxY: Math.max(...model.cells.map(c => c.y)), maxZ: Math.max(...model.cells.map(c => c.z)) }, { minX: 8, maxY: 6, maxZ: 16 });
});

test('ordinary primitive tuples retain their schema and behavior', () => {
  assert.deepEqual(compileDetailTuples({ ops: [['b', 1, 2, 3, 2, 1, 1, 'G']] }), [['b', 1, 2, 3, 2, 1, 1, 'G']]);
  assert.throws(() => expandDetailProgram({ ops: [['b', 0, 0, 0, 1, 1, 1]] }), /exactly 8/);
});

test('rejects malformed, fractional, unknown, degenerate, and out-of-bounds macros', () => {
  assert.throws(() => compileDetailTuples({ ops: [{ ...frame('z'), surprise: 1 }] }), /unknown field/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...frame('z'), thickness: 1.5 }] }), /safe integer/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...frame('q') }] }), /axis/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...frame('z'), w: 2 }] }), /opening must be positive/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...frame('z'), color: 'purple' }] }), /palette symbol/);
  assert.throws(() => compileDetailTuples({ ops: [{ type: 'profile', x: 0, y: 0, z: 0, w: 4, d: 4, levels: 3, rise: 1, insetX: 1, insetZ: 1, shiftX: 0, shiftZ: 0, color: 'D' }] }), /extents must be positive/);
  assert.throws(() => compileDetailTuples({ ops: [{ type: 'profile', x: 63, y: 0, z: 0, w: 2, d: 2, levels: 1, rise: 1, insetX: 0, insetZ: 0, shiftX: 0, shiftZ: 0, color: 'D' }] }), /axis bounds/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...bays(), rows: 1.5 }] }), /safe integer/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...bays(), unknown: 1 }] }), /unknown field/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...bays(), axis: 'q' }] }), /axis/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...bays(), bayW: 0 }] }), /must be positive/);
});

test('rejects massive repetition and source, expanded, and lattice-work cap violations', () => {
  const profile = { type: 'profile', x: 0, y: 0, z: 0, w: 1, d: 1, levels: 2049, rise: 1, insetX: 0, insetZ: 0, shiftX: 0, shiftZ: 0, color: 'D' };
  assert.throws(() => compileDetailTuples({ ops: [profile] }), /expanded-operation limit/);
  const valid64TierProfile = { ...profile, levels: 64 };
  assert.throws(() => compileDetailTuples({ ops: Array(33).fill(valid64TierProfile) }), /expanded-operation limit/);
  assert.throws(() => compileDetailTuples({ ops: Array(257).fill(['b', 0, 0, 0, 1, 1, 1, 'D']) }), /source-operation limit/);
  assert.throws(() => compileDetailTuples({ ops: Array(65).fill(['b', 0, 0, 0, 64, 64, 1, 'D']) }), /lattice-work limit/);
  assert.throws(() => compileDetailTuples({ ops: [], extra: true }), /unknown field/);
  const exactLimit = { ...bays(), x: 0, y: 0, z: 0, columns: 1, rows: 1, bayW: 62, bayH: 62, pier: 1, beam: 1, depth: 64 };
  assert.equal(expandDetailProgram({ ops: [exactLimit] }).cells.length, 16128);
  assert.throws(() => compileDetailTuples({ ops: [exactLimit, ['b', 0, 0, 0, 1, 1, 1, 'D']] }), /lattice-work limit/);
  assert.throws(() => compileDetailTuples({ ops: [{ ...bays(), columns: Number.MAX_SAFE_INTEGER }] }), /dimensions are too large/);
});
