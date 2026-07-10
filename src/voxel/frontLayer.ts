import { buildSteps, allBricks } from './steps.ts';
import type { Brick, Color, Voxel, VoxelGrid } from './types.ts';

const COLORS: readonly Color[] = [
  'red',
  'yellow',
  'blue',
  'green',
  'white',
  'black',
  'lightGray',
];

function toColor(name: string): Color {
  return (COLORS as readonly string[]).includes(name) ? (name as Color) : 'lightGray';
}

/**
 * A 256-char front mask ('#'/'.' , 16 rows row-major) → a one-voxel-deep
 * brick layer at the front plane (z=0). The mask arrives from the Worker at
 * t=0 (the FA silhouette is known before the model designs any depth), so
 * this is what assembles on the stage during the model wait — real data, not
 * filler. The mapping matches the hull's front convention (`front[size-1-y][x]`,
 * z back) so the partial front layer sits exactly where the finished model's
 * front face lands when it replaces it.
 */
export function frontMaskToBricks(mask: string, color: string, size = 16): Brick[] {
  if (mask.length < size * size) return [];
  const c = toColor(color);
  const voxels: Voxel[] = [];
  for (let r = 0; r < size; r++) {
    for (let col = 0; col < size; col++) {
      if (mask[r * size + col] === '#') {
        voxels.push({ x: col, y: size - 1 - r, z: 0, color: c });
      }
    }
  }
  const grid: VoxelGrid = { size, voxels };
  return allBricks(buildSteps(grid));
}
