import test from 'node:test';
import assert from 'node:assert/strict';
import { expandLayers, expandVoxelProgram, expandVoxelTuples, validateVoxels, VOXEL_PALETTE } from '../src/voxels.js';

test('expands colored cells without padding or scale conversion', () => {
  const output = expandLayers({ layers: [{ repeat: 1, rows: ['R.', '.B'] }] }, { prompt: 'test' });
  assert.deepEqual(output, {
    version: 1,
    kind: 'voxels',
    cells: [{ x: 0, y: 0, z: 0, color: 'red' }, { x: 1, y: 0, z: 1, color: 'blue' }],
    meta: { prompt: 'test' },
  });
  assert.equal(Object.keys(VOXEL_PALETTE).length, 11);
});

test('repeat creates identical consecutive cubic layers', () => {
  const output = expandLayers({ layers: [
    { repeat: 2, rows: ['G.'] },
    { repeat: 1, rows: ['.W'] },
  ] });
  assert.deepEqual(output.cells, [
    { x: 0, y: 0, z: 0, color: 'green' },
    { x: 0, y: 1, z: 0, color: 'green' },
    { x: 1, y: 2, z: 0, color: 'white' },
  ]);
});

test('rejects mismatched rows, layer dimensions, and palette symbols', () => {
  assert.throws(() => expandLayers({ layers: [{ repeat: 1, rows: ['..', '.'] }] }), /fixed width/);
  assert.throws(() => expandLayers({ layers: [
    { repeat: 1, rows: ['..'] }, { repeat: 1, rows: ['..', '..'] },
  ] }), /dimensions/);
  assert.throws(() => expandLayers({ layers: [{ repeat: 1, rows: ['?'] }] }), /unknown symbol/);
});

test('rejects empty shape models and duplicate or invalid imported cells', () => {
  assert.equal(validateVoxels({ version: 1, kind: 'voxels', cells: [] }).valid, false);
  const result = validateVoxels({ version: 1, kind: 'voxels', cells: [
    { x: 0, y: 0, z: 0, color: 'red' },
    { x: 0, y: 0, z: 0, color: 'red' },
    { x: Number.MAX_SAFE_INTEGER + 1, y: 0, z: 0, color: 'red' },
    { x: 1, y: 0, z: 0, color: 'magenta' },
  ] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /duplicates/);
  assert.match(result.errors.join(' '), /safe integers/);
  assert.match(result.errors.join(' '), /unknown color/);
});

test('enforces repeat, dimension, lattice, and occupied-cell caps before expansion', () => {
  assert.throws(() => expandLayers({ layers: [{ repeat: 0, rows: ['R'] }] }), /positive safe integer/);
  assert.throws(() => expandLayers({ layers: [{ repeat: 65, rows: ['R'] }] }), /dimensions/);
  const row64 = 'R'.repeat(64);
  assert.throws(() => expandLayers({ layers: [{ repeat: 64, rows: Array(64).fill(row64) }] }), /Occupied voxel count/);
  const overCount = { version: 1, kind: 'voxels', cells: Array(50_001).fill(null) };
  assert.match(validateVoxels(overCount).errors[0], /cell limit/);
});

test('disconnected floating islands warn but do not invalidate schema', () => {
  const model = { version: 1, kind: 'voxels', cells: [
    { x: 0, y: 0, z: 0, color: 'red' },
    { x: 4, y: 3, z: 2, color: 'blue' },
  ], meta: {} };
  const result = validateVoxels(model);
  assert.equal(result.valid, true);
  assert.equal(result.checks.schema, true);
  assert.deepEqual(result.stats, {
    cellCount: 2,
    componentCount: 2,
    groundedComponents: 1,
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 3, minZ: 0, maxZ: 2 },
  });
  assert.match(result.warnings.join(' '), /disconnected/);
  assert.match(result.warnings.join(' '), /ground/);
});

test('voxel programs expand boxes and ellipsoids without brick packing', () => {
  const output = expandVoxelProgram({ operations: [
    { type: 'box', x: 0, y: 0, z: 0, w: 2, h: 1, d: 1, color: 'red' },
    { type: 'ellipsoid', x: 10, y: 0, z: 0, w: 3, h: 3, d: 3, color: 'blue' },
  ] }, { method: 'voxel-program' });
  assert.equal(output.cells.length, 21);
  assert.deepEqual(output.cells.slice(0, 2), [
    { x: 0, y: 0, z: 0, color: 'red' },
    { x: 1, y: 0, z: 0, color: 'red' },
  ]);
  assert.equal(output.kind, 'voxels');
  assert.deepEqual(output.meta, { method: 'voxel-program' });
});

test('voxel program y extents produce unit-spaced cubic coordinates', () => {
  const output = expandVoxelProgram({ operations: [
    { type: 'box', x: 2, y: 4, z: 3, w: 1, h: 3, d: 1, color: 'tan' },
  ] });
  assert.deepEqual(output.cells.map(({ y }) => y), [4, 5, 6]);
});

test('voxel programs reject oversized bounds and work before expansion', () => {
  assert.throws(() => expandVoxelProgram({ operations: [
    { type: 'box', x: 64, y: 0, z: 0, w: 1, h: 1, d: 1, color: 'red' },
  ] }), /axis bounds/);
  assert.throws(() => expandVoxelProgram({ operations: [
    { type: 'box', x: 0, y: 0, z: 0, w: 64, h: 64, d: 64, color: 'red' },
  ] }), /Occupied voxel count/);
});

test('voxel-program shape warnings remain separate from expansion', () => {
  const output = expandVoxelProgram({ operations: [
    { type: 'box', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, color: 'red' },
    { type: 'box', x: 5, y: 5, z: 5, w: 1, h: 1, d: 1, color: 'blue' },
  ] });
  const validation = validateVoxels(output);
  assert.equal(validation.valid, true);
  assert.equal(validation.stats.componentCount, 2);
  assert.match(validation.warnings.join(' '), /disconnected/);
  assert.match(validation.warnings.join(' '), /ground/);
});

test('compact voxel tuples preserve verbose primitive geometry, overwrite order, colors, and metadata', () => {
  const meta = { method: 'equivalence-test' };
  const verbose = expandVoxelProgram({ operations: [
    { type: 'box', x: 0, y: 0, z: 0, w: 4, h: 3, d: 4, color: 'red' },
    { type: 'ellipsoid', x: 1, y: 0, z: 1, w: 3, h: 3, d: 3, color: 'blue' },
    { type: 'taper', x: 0, y: 1, z: 0, w: 4, h: 3, d: 4, color: 'orange', topW: 2, topD: 2 },
  ] }, meta);
  const compact = expandVoxelTuples({ ops: [
    ['b', 0, 0, 0, 4, 3, 4, 'R'],
    ['e', 1, 0, 1, 3, 3, 3, 'B'],
    ['t', 0, 1, 0, 4, 3, 4, 'O', 2, 2],
  ] }, meta);

  assert.deepEqual(compact, verbose);
  assert.ok(compact.cells.some((cell) => cell.color === 'orange'));
  assert.ok(compact.cells.some((cell) => cell.color === 'blue'));
  assert.ok(compact.cells.some((cell) => cell.color === 'red'));
});

test('compact voxel tuples reject malformed arity, opcodes, and palette symbols', () => {
  assert.throws(() => expandVoxelTuples({ ops: [['b', 0, 0, 0, 1, 1, 1]] }), /exactly 8/);
  assert.throws(() => expandVoxelTuples({ ops: [['t', 0, 0, 0, 1, 1, 1, 'R', 1]] }), /exactly 10/);
  assert.throws(() => expandVoxelTuples({ ops: [['x', 0, 0, 0, 1, 1, 1, 'R']] }), /unknown opcode/);
  assert.throws(() => expandVoxelTuples({ ops: [['b', 0, 0, 0, 1, 1, 1, '.']] }), /unknown palette symbol/);
  assert.throws(() => expandVoxelTuples({ ops: [['b', 0, 0, 0, 1, 1, 1, 'red']] }), /unknown palette symbol/);
});
