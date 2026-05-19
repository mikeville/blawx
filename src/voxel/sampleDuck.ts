import type { VoxelGrid, Voxel } from './types.ts';
import { GRID_SIZE } from './types.ts';

const Y: Voxel['color'] = 'yellow';
const R: Voxel['color'] = 'red';
const B: Voxel['color'] = 'black';

const voxels: Voxel[] = [
  { x: 2, y: 0, z: 3, color: Y }, { x: 2, y: 0, z: 4, color: Y },
  { x: 3, y: 0, z: 3, color: Y }, { x: 3, y: 0, z: 4, color: Y },
  { x: 4, y: 0, z: 3, color: Y }, { x: 4, y: 0, z: 4, color: Y },
  { x: 5, y: 0, z: 3, color: Y }, { x: 5, y: 0, z: 4, color: Y },

  { x: 1, y: 1, z: 3, color: Y }, { x: 1, y: 1, z: 4, color: Y },
  { x: 2, y: 1, z: 3, color: Y }, { x: 2, y: 1, z: 4, color: Y },
  { x: 3, y: 1, z: 3, color: Y }, { x: 3, y: 1, z: 4, color: Y },
  { x: 4, y: 1, z: 3, color: Y }, { x: 4, y: 1, z: 4, color: Y },
  { x: 5, y: 1, z: 3, color: Y }, { x: 5, y: 1, z: 4, color: Y },
  { x: 6, y: 1, z: 3, color: Y }, { x: 6, y: 1, z: 4, color: Y },

  { x: 1, y: 2, z: 3, color: Y }, { x: 1, y: 2, z: 4, color: Y },
  { x: 2, y: 2, z: 3, color: Y }, { x: 2, y: 2, z: 4, color: Y },
  { x: 3, y: 2, z: 3, color: Y }, { x: 3, y: 2, z: 4, color: Y },
  { x: 4, y: 2, z: 3, color: Y }, { x: 4, y: 2, z: 4, color: Y },
  { x: 5, y: 2, z: 3, color: Y }, { x: 5, y: 2, z: 4, color: Y },

  { x: 3, y: 3, z: 3, color: Y }, { x: 3, y: 3, z: 4, color: Y },

  { x: 3, y: 4, z: 3, color: Y }, { x: 3, y: 4, z: 4, color: Y },
  { x: 4, y: 4, z: 3, color: Y }, { x: 4, y: 4, z: 4, color: B },
  { x: 5, y: 4, z: 3, color: R }, { x: 5, y: 4, z: 4, color: R },

  { x: 3, y: 5, z: 3, color: Y }, { x: 3, y: 5, z: 4, color: Y },
  { x: 4, y: 5, z: 3, color: Y }, { x: 4, y: 5, z: 4, color: Y },
];

export const sampleDuck: VoxelGrid = { size: GRID_SIZE, voxels };
