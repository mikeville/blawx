import type { Voxel, VoxelGrid } from './types.ts';
import { GRID_SIZE } from './types.ts';

export type Rotation = 0 | 1 | 2 | 3;

const MAX = GRID_SIZE - 1;

function rotateXZ(x: number, z: number, rotation: Rotation): { x: number; z: number } {
  switch (rotation) {
    case 0:
      return { x, z };
    case 1:
      return { x: z, z: MAX - x };
    case 2:
      return { x: MAX - x, z: MAX - z };
    case 3:
      return { x: MAX - z, z: x };
  }
}

export function rotateVoxel(v: Voxel, rotation: Rotation): Voxel {
  const { x, z } = rotateXZ(v.x, v.z, rotation);
  return { x, y: v.y, z, color: v.color };
}

export function rotateGrid(grid: VoxelGrid, rotation: Rotation): VoxelGrid {
  if (rotation === 0) return grid;
  return {
    size: grid.size,
    voxels: grid.voxels.map(v => rotateVoxel(v, rotation)),
  };
}

export function shiftToGround(grid: VoxelGrid): VoxelGrid {
  if (grid.voxels.length === 0) return grid;
  let minY = Infinity;
  for (const v of grid.voxels) if (v.y < minY) minY = v.y;
  if (minY === 0) return grid;
  return {
    size: grid.size,
    voxels: grid.voxels.map(v => ({ ...v, y: v.y - minY })),
  };
}
