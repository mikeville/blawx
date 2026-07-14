import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packLayer } from './pack.ts';
import type { Brick, Voxel } from './types.ts';

const v = (x: number, z: number, color: Voxel['color'], y = 0): Voxel => ({ x, y, z, color });

// Real LEGO System run lengths — mirrors the packer's own catalog so tests
// can assert "every brick is a legal footprint" without hardcoding it twice.
const RUN_LENGTHS = [1, 2, 3, 4, 6, 8];
function isLegalFootprint(b: Brick): boolean {
  return RUN_LENGTHS.includes(b.w) && RUN_LENGTHS.includes(b.d) && Math.min(b.w, b.d) <= 2;
}

// Shared invariant check: every input voxel is covered exactly once, no
// brick covers a cell outside its own color or footprint legality, and no
// brick spills onto a cell that wasn't filled in the input.
function assertValidPacking(voxels: Voxel[], bricks: Brick[]): void {
  const byCell = new Map<string, Voxel>();
  for (const vx of voxels) byCell.set(`${vx.x},${vx.z}`, vx);

  const covered = new Map<string, number>();
  for (const b of bricks) {
    assert.ok(isLegalFootprint(b), `illegal footprint ${b.w}x${b.d}`);
    for (let i = 0; i < b.w; i++) {
      for (let j = 0; j < b.d; j++) {
        const k = `${b.x + i},${b.z + j}`;
        const src = byCell.get(k);
        assert.ok(src, `brick at (${b.x},${b.z}) ${b.w}x${b.d} covers empty cell ${k}`);
        assert.equal(src!.color, b.color, `brick at (${b.x},${b.z}) covers a different color at ${k}`);
        assert.equal(covered.get(k) ?? 0, 0, `cell ${k} double-covered`);
        covered.set(k, 1);
      }
    }
  }
  assert.equal(covered.size, voxels.length, 'not every filled cell was covered exactly once');
}

test('single voxel packs as one 1x1', () => {
  const voxels = [v(3, 4, 'yellow')];
  const out = packLayer(voxels);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { x: 3, y: 0, z: 4, w: 1, d: 1, color: 'yellow' });
  assertValidPacking(voxels, out);
});

test('same-color 1x4 run on an even layer (x-major) packs as one 1x4', () => {
  const voxels = [v(0, 0, 'red'), v(1, 0, 'red'), v(2, 0, 'red'), v(3, 0, 'red')];
  const out = packLayer(voxels);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { x: 0, y: 0, z: 0, w: 4, d: 1, color: 'red' });
  assertValidPacking(voxels, out);
});

test('same-color 4-wide x 2-deep block packs into one 2x4, not two 2x2s', () => {
  // 4 wide (x) x 2 deep (z), one color — proves the 2x4 workhorse wins over
  // fragmenting into smaller squares.
  const voxels: Voxel[] = [];
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 2; z++) voxels.push(v(x, z, 'blue'));
  }
  const out = packLayer(voxels);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.w, 4);
  assert.equal(out[0]!.d, 2);
  assertValidPacking(voxels, out);
});

test('same-color 8-wide x 2-deep region on an even layer packs into two 2x4s, not one 2x8', () => {
  // Commonality ranking beats maximal area: even though a single 2x8 would
  // legally cover this region in one brick, the 2x4 workhorse is preferred
  // and fires twice instead.
  const voxels: Voxel[] = [];
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 2; z++) voxels.push(v(x, z, 'blue', 0));
  }
  const out = packLayer(voxels);
  assert.equal(out.length, 2);
  assert.ok(out.every(b => b.w === 4 && b.d === 2));
  assertValidPacking(voxels, out);
});

test('color boundaries are respected — no brick merges across a color change', () => {
  const voxels = [v(0, 0, 'yellow'), v(1, 0, 'red'), v(0, 1, 'yellow'), v(1, 1, 'yellow')];
  const out = packLayer(voxels);
  assertValidPacking(voxels, out);
  // The lone red cell must stand alone — never absorbed into a neighboring brick.
  const redBricks = out.filter(b => b.color === 'red');
  assert.equal(redBricks.length, 1);
  assert.deepEqual(redBricks[0], { x: 1, y: 0, z: 0, w: 1, d: 1, color: 'red' });
});

test('running bond: same 4x4 same-color square tiles x-major on an even layer, z-major on an odd one', () => {
  const square = (y: number): Voxel[] => {
    const out: Voxel[] = [];
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) out.push(v(x, z, 'green', y));
    }
    return out;
  };

  const evenVoxels = square(0);
  const evenOut = packLayer(evenVoxels);
  assertValidPacking(evenVoxels, evenOut);
  assert.equal(evenOut.length, 2);
  assert.ok(evenOut.every(b => b.w === 4 && b.d === 2), 'even layer should tile x-major (wide bricks)');

  const oddVoxels = square(1);
  const oddOut = packLayer(oddVoxels);
  assertValidPacking(oddVoxels, oddOut);
  assert.equal(oddOut.length, 2);
  assert.ok(oddOut.every(b => b.w === 2 && b.d === 4), 'odd layer should tile z-major (deep bricks)');
});

test('every brick in a dense multi-color layer is a legal catalog footprint', () => {
  const colors: Voxel['color'][] = ['red', 'yellow', 'blue', 'green', 'white', 'black'];
  const voxels: Voxel[] = [];
  for (let x = 0; x < 6; x++) {
    for (let z = 0; z < 6; z++) {
      // Stripe by a mix of x and z so color regions are irregular, not a
      // clean grid — stresses the "same color" boundary check.
      const color = colors[(x + z * 2) % colors.length]!;
      voxels.push(v(x, z, color));
    }
  }
  const out = packLayer(voxels);
  assertValidPacking(voxels, out);
});

test('16x16 dense same-color layer packs cleanly with 2x4 workhorse bricks (grid-size independence)', () => {
  const voxels: Voxel[] = [];
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) voxels.push(v(x, z, 'lightGray'));
  }
  const out = packLayer(voxels);
  assertValidPacking(voxels, out);
  // Fully dense + one color + even layer: commonality ranking tiles the
  // whole grid in the 2x4 workhorse, never reaching for a bigger footprint
  // even though larger legal footprints (2x6, 2x8) would also fit cleanly.
  assert.equal(out.length, 32);
  assert.ok(out.every(b => b.w === 4 && b.d === 2));
  assert.ok(out.every(b => Math.max(b.w, b.d) <= 4), 'no giant bricks on a clean dense region');
});
