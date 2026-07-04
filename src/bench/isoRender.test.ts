import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, renderIsoSVG, shade, UNIT } from './isoRender.ts';
import { parseBenchResult } from './types.ts';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

const polyCount = (svg: string) => (svg.match(/<polygon/g) ?? []).length;

test('project matches the shared iso constants', () => {
  assert.deepEqual(project(0, 0, 0), [0, 0]);
  const [x1, y1] = project(1, 0, 0);
  assert.ok(Math.abs(x1 - COS30 * UNIT) < 1e-9);
  assert.ok(Math.abs(y1 - SIN30 * UNIT) < 1e-9);
  assert.deepEqual(project(0, 1, 0), [0, -UNIT]);
});

test('the (1,1,1) view axis projects to a point', () => {
  const [x, y] = project(1, 1, 1);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9);
});

test('single voxel renders exactly three faces', () => {
  assert.equal(polyCount(renderIsoSVG([[0, 0, 0]])), 3);
});

test('2x2x2 solid culls hidden faces and voxels', () => {
  const voxels: [number, number, number][] = [];
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++) voxels.push([x, y, z]);
  // 4 top faces on the top layer + 4 right faces at x=1 + 4 left faces at z=1
  assert.equal(polyCount(renderIsoSVG(voxels)), 12);
});

test('painter order: nearer voxel drawn after farther one', () => {
  const svg = renderIsoSVG(
    [
      [1, 1, 1], // nearer (larger x+y+z), listed first on purpose
      [0, 0, 0],
    ],
    { mode: 'color', colors: ['#ff0000', '#0000ff'] },
  );
  const near = svg.indexOf(shade('#ff0000', 1));
  const far = svg.indexOf(shade('#0000ff', 1));
  assert.ok(far !== -1 && near !== -1);
  assert.ok(far < near, 'far voxel polygons must precede near voxel polygons');
});

test('shade scales hex channels', () => {
  assert.equal(shade('#ffffff', 0.5), '#808080');
  assert.equal(shade('#fff', 1), '#ffffff');
  assert.equal(shade('#000000', 0.5), '#000000');
});

test('parseBenchResult drops out-of-range and duplicate voxels', () => {
  const { result, dropped } = parseBenchResult({
    noun: 'fox',
    size: 8,
    voxels: [
      [0, 0, 0],
      [7, 7, 7],
      [8, 0, 0], // out of range
      [0, 0, 0], // duplicate
      [-1, 2, 2], // out of range
    ],
    colors: ['#a00', '#b00', '#c00', '#d00', '#e00'],
  });
  assert.equal(result.voxels.length, 2);
  assert.equal(dropped, 3);
  // colors stay parallel to the surviving voxels
  assert.deepEqual(result.colors, ['#a00', '#b00']);
});

test('parseBenchResult rejects structural garbage', () => {
  assert.throws(() => parseBenchResult(null));
  assert.throws(() => parseBenchResult({ noun: '', size: 8, voxels: [] }));
  assert.throws(() => parseBenchResult({ noun: 'x', size: 0, voxels: [] }));
  assert.throws(() => parseBenchResult({ noun: 'x', size: 8, voxels: [[1, 2]] }));
  assert.throws(() =>
    parseBenchResult({ noun: 'x', size: 8, voxels: [[1, 2, 3]], colors: [] }),
  );
});
