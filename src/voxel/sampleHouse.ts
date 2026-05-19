import type { VoxelGrid, Voxel } from './types.ts';
import { GRID_SIZE } from './types.ts';

// Small reference house: 3×3 white walls 2 high, single black door on the
// front face (z=4), 3×3 red roof base, single red apex. Used as a worked
// example in the generation prompts (alongside duck + tree).

const voxels: Voxel[] = [];

// y=0..1: 3×3 white walls at (x=2..4, z=2..4), with a black door at front.
for (let y = 0; y <= 1; y++) {
  for (let x = 2; x <= 4; x++) {
    for (let z = 2; z <= 4; z++) {
      const isDoor = y <= 1 && x === 3 && z === 4;
      voxels.push({ x, y, z, color: isDoor ? 'black' : 'white' });
    }
  }
}

// y=2: 3×3 red roof base
for (let x = 2; x <= 4; x++) {
  for (let z = 2; z <= 4; z++) {
    voxels.push({ x, y: 2, z, color: 'red' });
  }
}

// y=3: red apex
voxels.push({ x: 3, y: 3, z: 3, color: 'red' });

export const sampleHouse: VoxelGrid = { size: GRID_SIZE, voxels };
