import test from 'node:test';
import assert from 'node:assert/strict';
import { expandLoftProgram } from '../src/loft-program.js';
import { expandVoxelTuples } from '../src/voxels.js';

const coordinates = (model) => model.cells.map(({ x, y, z }) => `${x},${y},${z}`).sort();

test('lofts map axial, U, and V coordinates for all three axes', () => {
  const sections = [[0, 2, 3, 2, 2], [1, 2, 3, 2, 2]];
  assert.deepEqual(coordinates(expandLoftProgram({ ops: [['l', 'x', 'box', 'R', sections]] })), ['0,1,2', '0,1,3', '0,2,2', '0,2,3']);
  assert.deepEqual(coordinates(expandLoftProgram({ ops: [['l', 'y', 'box', 'R', sections]] })), ['1,0,2', '1,0,3', '2,0,2', '2,0,3']);
  assert.deepEqual(coordinates(expandLoftProgram({ ops: [['l', 'z', 'box', 'R', sections]] })), ['1,2,0', '1,3,0', '2,2,0', '2,3,0']);
});

test('lofts interpolate known box cross-sections at voxel centers', () => {
  const model = expandLoftProgram({ ops: [['l', 'x', 'box', 'B', [[0, 3.5, 3.5, 2, 2], [2, 3.5, 3.5, 6, 6]]]] });
  const first = model.cells.filter(({ x }) => x === 0);
  const second = model.cells.filter(({ x }) => x === 1);
  assert.equal(first.length, 9);
  assert.equal(second.length, 25);
  assert.deepEqual([Math.min(...first.map(({ y }) => y)), Math.max(...first.map(({ y }) => y))], [2, 4]);
  assert.deepEqual([Math.min(...second.map(({ y }) => y)), Math.max(...second.map(({ y }) => y))], [1, 5]);
});

test('ellipse includes normalized boundary cells and charges its empty bounding candidates', () => {
  const model = expandLoftProgram({ ops: [['l', 'z', 'ellipse', 'G', [[0, 2, 2, 3, 3], [1, 2, 2, 3, 3]]]] });
  assert.deepEqual(coordinates(model), ['1,1,0', '1,2,0', '2,1,0', '2,2,0']);
  const repeated = Array.from({ length: 9 }, () =>
    ['l', 'x', 'ellipse', 'G', [[0, 32, 32, 64, 64], [8, 32, 32, 64, 64]]]);
  assert.throws(() => expandLoftProgram({ ops: repeated }), /lattice-work limit/);
});

test('ellipse includes cells exactly on both positive and negative profile boundaries', () => {
  const model = expandLoftProgram({ ops: [['l', 'x', 'ellipse', 'G', [[0, 1.5, 0.5, 2, 1], [1, 1.5, 0.5, 2, 1]]]] });
  assert.deepEqual(coordinates(model), ['0,0,0', '0,1,0', '0,2,0']);
});

test('mixed loft and primitive operations use last-color-wins paint order', () => {
  const loftLast = expandLoftProgram({ ops: [
    ['b', 0, 0, 0, 1, 1, 1, 'R'],
    ['l', 'x', 'box', 'B', [[0, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1]]],
  ] });
  assert.equal(loftLast.cells[0].color, 'blue');
  const primitiveLast = expandLoftProgram({ ops: [
    ['l', 'x', 'box', 'B', [[0, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1]]],
    ['b', 0, 0, 0, 1, 1, 1, 'R'],
  ] });
  assert.equal(primitiveLast.cells[0].color, 'red');
});

test('primitive-only loft programs preserve tuple expansion exactly', () => {
  const source = { ops: [['b', 0, 0, 0, 3, 2, 2, 'R'], ['e', 1, 0, 0, 2, 2, 2, 'B'], ['t', 0, 1, 0, 3, 2, 2, 'O', 1, 1]] };
  assert.deepEqual(expandLoftProgram(source, { method: 'loft' }), expandVoxelTuples(source, { method: 'loft' }));
});

test('loft intervals have inclusive starts, exclusive ends, and no caps', () => {
  const model = expandLoftProgram({ ops: [['l', 'x', 'box', 'W', [[0.5, 0.5, 0.5, 1, 1], [2.5, 0.5, 0.5, 1, 1]]]] });
  assert.deepEqual(coordinates(model), ['0,0,0', '1,0,0']);
});

test('rings map circularly symmetric annuli across all three axes', () => {
  const ring = (axis) => expandLoftProgram({ ops: [['r', axis, 2, 1, 3.5, 3.5, 2.5, 1.5, 'K']] });
  for (const [axis, axialField, uField, vField] of [['x', 'x', 'y', 'z'], ['y', 'y', 'x', 'z'], ['z', 'z', 'x', 'y']]) {
    const cells = ring(axis).cells;
    assert.ok(cells.every((cell) => cell[axialField] === 2));
    const pairs = new Set(cells.map((cell) => `${cell[uField]},${cell[vField]}`));
    assert.ok(pairs.size > 0);
    for (const cell of cells) {
      assert.ok(pairs.has(`${6 - cell[uField]},${cell[vField]}`));
      assert.ok(pairs.has(`${cell[uField]},${6 - cell[vField]}`));
      const du = cell[uField] + 0.5 - 3.5;
      const dv = cell[vField] + 0.5 - 3.5;
      assert.ok(1.5 ** 2 <= du * du + dv * dv && du * du + dv * dv <= 2.5 ** 2);
    }
  }
});

test('ring holes preserve earlier geometry and overlaps use mixed-operation paint order', () => {
  const model = expandLoftProgram({ ops: [
    ['b', 0, 0, 0, 2, 7, 7, 'R'],
    ['r', 'x', 0, 2, 3.5, 3.5, 3.5, 1.5, 'B'],
    ['l', 'x', 'box', 'G', [[1, 0.5, 3.5, 1, 1], [2, 0.5, 3.5, 1, 1]]],
  ] });
  const at = (x, y, z) => model.cells.find((cell) => cell.x === x && cell.y === y && cell.z === z)?.color;
  assert.equal(at(0, 3, 3), 'red');
  assert.equal(at(0, 0, 3), 'blue');
  assert.equal(at(1, 0, 3), 'green');
});

test('ring work is preflighted from outer bounds before occupancy rasterization', () => {
  const maximal = ['r', 'x', 0, 64, 32, 32, 32, 0.5, 'K'];
  assert.throws(() => expandLoftProgram({ ops: [maximal, maximal] }), /lattice-work limit/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 16, 32, 32, 32, 0.5, 'K']] }), /Occupied voxel count/);
});

test('rings enforce exact schema, numeric domains, radial order, and full bounds', () => {
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 1, 2, 2, 2, 1, 'K', 'extra']] }), /exactly 9/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'q', 0, 1, 2, 2, 2, 1, 'K']] }), /axis/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0.5, 1, 2, 2, 2, 1, 'K']] }), /safe integers/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 0, 2, 2, 2, 1, 'K']] }), /depth must be positive/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 1, 2.25, 2, 2, 1, 'K']] }), /multiples of 0.5/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 1, 2, 2, Infinity, 1, 'K']] }), /finite multiples/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 1, 2, 2, 2, 2, 'K']] }), /innerRadius < outerRadius/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 64, 1, 2, 2, 2, 1, 'K']] }), /axis bounds/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 1, 1.5, 2, 2, 1, 'K']] }), /axis bounds/);
  assert.throws(() => expandLoftProgram({ ops: [['r', 'x', 0, 1, 2, 2, 2, 1, '.']] }), /unknown palette/);
});

test('aggregate work includes primitive volumes', () => {
  const ops = Array.from({ length: 65 }, () => ['b', 0, 0, 0, 64, 1, 64, 'R']);
  assert.throws(() => expandLoftProgram({ ops }), /lattice-work limit/);
});

test('occupied-cell cap applies to pure primitive and mixed loft unions', () => {
  assert.throws(() => expandLoftProgram({ ops: [
    ['b', 0, 0, 0, 64, 7, 64, 'R'],
    ['b', 0, 7, 0, 64, 7, 64, 'B'],
  ] }), /Occupied voxel count/);

  assert.throws(() => expandLoftProgram({ ops: [
    ['l', 'y', 'box', 'G', [[0, 32, 32, 64, 64], [1, 32, 32, 64, 64]]],
    ['b', 0, 1, 0, 64, 12, 64, 'R'],
  ] }), /Occupied voxel count/);
});

test('loft programs reject malformed schemas and invalid section domains', () => {
  assert.throws(() => expandLoftProgram({ ops: [], extra: true }), /exactly the ops field/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'q', 'box', 'R', [[0, 1, 1, 1, 1], [1, 1, 1, 1, 1]]]] }), /axis/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'round', 'R', [[0, 1, 1, 1, 1], [1, 1, 1, 1, 1]]]] }), /profile/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 1, 1, 1, 1]]]] }), /between 2 and 16/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 1, 1, 1, 1], [0, 1, 1, 1, 1]]]] }), /strictly increasing/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 1.25, 1, 1, 1], [1, 1, 1, 1, 1]]]] }), /multiples of 0.5/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, NaN, 1, 1, 1], [1, 1, 1, 1, 1]]]] }), /finite multiples of 0.5/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 1, 1, 1, 1], [Infinity, 1, 1, 1, 1]]]] }), /finite multiples of 0.5/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 0, 1, 1, 1], [1, 1, 1, 1, 1]]]] }), /axis bounds/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 1, 1, 0, 1], [1, 1, 1, 1, 1]]]] }), /positive/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 1, 1, 1, 1], [1, 1, 1, 1, 1]], 'extra']] }), /exactly 5/);
  assert.throws(() => expandLoftProgram({ ops: [['l', 'x', 'box', 'R', [[0, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 1, 1]]]] }), /at least one occupied cell/);
});
