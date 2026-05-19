import type { VoxelGrid, Voxel } from './types.ts';
import { GRID_SIZE } from './types.ts';

// Small reference tree: 3-high gray trunk, 2-layer green canopy, single tip.
// Used as a worked example in the generation prompts (alongside duck + house).

const voxels: Voxel[] = [
  // Trunk (lightGray)
  { x: 3, y: 0, z: 3, color: 'lightGray' },
  { x: 3, y: 1, z: 3, color: 'lightGray' },
  { x: 3, y: 2, z: 3, color: 'lightGray' },

  // Lower canopy: 3×3 at y=3, centered on trunk
  ...range3x3(3),

  // Upper canopy: 3×3 at y=4
  ...range3x3(4),

  // Tip
  { x: 3, y: 5, z: 3, color: 'green' },
];

function range3x3(y: number): Voxel[] {
  const out: Voxel[] = [];
  for (let x = 2; x <= 4; x++) {
    for (let z = 2; z <= 4; z++) {
      out.push({ x, y, z, color: 'green' });
    }
  }
  return out;
}

export const sampleTree: VoxelGrid = { size: GRID_SIZE, voxels };
