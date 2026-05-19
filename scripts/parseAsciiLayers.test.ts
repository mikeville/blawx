import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsciiLayers } from './parseAsciiLayers.ts';

test('parses single layer with header', () => {
  const grid = parseAsciiLayers(`
y=0
........
........
...YYY..
...YYY..
...YYY..
........
........
........
`);
  assert.equal(grid.size, 8);
  assert.equal(grid.voxels.length, 9);
  for (const v of grid.voxels) {
    assert.equal(v.y, 0);
    assert.equal(v.color, 'yellow');
  }
});

test('parses all 8 layers with headers', () => {
  const text = ['y=0', 'y=1', 'y=2', 'y=3', 'y=4', 'y=5', 'y=6', 'y=7']
    .map(h => `${h}\n` + Array(8).fill('Y.......').join('\n'))
    .join('\n');
  const grid = parseAsciiLayers(text);
  assert.equal(grid.voxels.length, 64); // 8 layers × 8 z rows × 1 voxel per row
  const ys = new Set(grid.voxels.map(v => v.y));
  assert.equal(ys.size, 8);
});

test('headerless format groups rows by 8s into layers', () => {
  const layer = ['Y.......', '........', '........', '........', '........', '........', '........', '........'].join('\n');
  const grid = parseAsciiLayers(`${layer}\n\n${layer}\n\n${layer}`);
  // 3 layers, each with 1 voxel
  assert.equal(grid.voxels.length, 3);
  assert.equal(grid.voxels[0].y, 0);
  assert.equal(grid.voxels[1].y, 1);
  assert.equal(grid.voxels[2].y, 2);
});

test('strips markdown code fences', () => {
  const text = '```\ny=0\n........\n........\n........\n..YYY...\n........\n........\n........\n........\n```';
  const grid = parseAsciiLayers(text);
  assert.equal(grid.voxels.length, 3);
});

test('accepts spaces between cells', () => {
  const grid = parseAsciiLayers(`y=0
. . . Y Y Y . .
. . . . . . . .
. . . . . . . .
. . . . . . . .
. . . . . . . .
. . . . . . . .
. . . . . . . .
. . . . . . . .`);
  assert.equal(grid.voxels.length, 3);
  assert.deepEqual(grid.voxels.map(v => v.x).sort(), [3, 4, 5]);
});

test('accepts lowercase palette letters', () => {
  const grid = parseAsciiLayers(`y=0
........
....r...
....y...
........
........
........
........
........`);
  assert.equal(grid.voxels.length, 2);
  const colors = new Set(grid.voxels.map(v => v.color));
  assert.ok(colors.has('red'));
  assert.ok(colors.has('yellow'));
});

test('maps all 7 palette letters correctly', () => {
  const grid = parseAsciiLayers(`y=0
YRBGWKL.
........
........
........
........
........
........
........`);
  assert.equal(grid.voxels.length, 7);
  const map = new Map(grid.voxels.map(v => [v.x, v.color]));
  assert.equal(map.get(0), 'yellow');
  assert.equal(map.get(1), 'red');
  assert.equal(map.get(2), 'blue');
  assert.equal(map.get(3), 'green');
  assert.equal(map.get(4), 'white');
  assert.equal(map.get(5), 'black');
  assert.equal(map.get(6), 'lightGray');
});

test('coordinates: x=column, z=row, y=layer index', () => {
  const grid = parseAsciiLayers(`y=0
........
.Y......
........
........
........
........
........
........

y=1
........
........
..R.....
........
........
........
........
........`);
  const sorted = [...grid.voxels].sort((a, b) => a.y - b.y);
  assert.deepEqual(sorted[0], { x: 1, y: 0, z: 1, color: 'yellow' });
  assert.deepEqual(sorted[1], { x: 2, y: 1, z: 2, color: 'red' });
});

test('short rows are padded with empty cells', () => {
  const grid = parseAsciiLayers(`y=0
YYY
........
........
........
........
........
........
........`);
  assert.equal(grid.voxels.length, 3);
});

test('ignores prose lines between grid rows', () => {
  const grid = parseAsciiLayers(`Here is the model:

y=0
........
........
...YYY..
this is the body
...YYY..
...YYY..
........
........
........`);
  // Prose line is rejected; expected 9 voxels total
  assert.equal(grid.voxels.length, 9);
});

test('discards layers beyond y=7', () => {
  const layers = Array.from({ length: 10 }, (_, i) => {
    return `y=${i}\n` + Array(8).fill('Y.......').join('\n');
  }).join('\n\n');
  const grid = parseAsciiLayers(layers);
  // Each valid layer has 8 voxels, only y=0..7 counted
  assert.equal(grid.voxels.length, 64);
  for (const v of grid.voxels) {
    assert.ok(v.y < 8);
  }
});
