import type { Color, VoxelGrid } from './types.ts';
import { GRID_SIZE } from './types.ts';

export type Cell = Color | null;
export type Silhouette = Cell[][];

export type Projections = {
  front: Silhouette; // [y][x], row 0 = top of grid (y=GRID_SIZE-1)
  side: Silhouette;  // [y][z], row 0 = top of grid (y=GRID_SIZE-1)
  top: Silhouette;   // [z][x], row 0 = top of grid (z=0)
};

const LETTER: Record<Color, string> = {
  yellow: 'Y',
  red: 'R',
  blue: 'B',
  green: 'G',
  white: 'W',
  black: 'K',
  lightGray: 'L',
};

function emptyGrid(): Silhouette {
  return Array.from({ length: GRID_SIZE }, () =>
    Array<Cell>(GRID_SIZE).fill(null),
  );
}

/**
 * Compute front, side, and top orthographic projections of a VoxelGrid.
 * Each cell holds the color of the OUTERMOST voxel along the projection
 * ray (max-Z for front, max-X for side, max-Y for top), or null for empty.
 *
 * Output conventions match the prompt format:
 * - front: rows are y (row 0 = top of model, y=7), columns are x (left to right)
 * - side:  rows are y (row 0 = top), columns are z (left = back, right = front)
 * - top:   rows are z (row 0 = back of model, z=0), columns are x (left to right)
 */
export function project(grid: VoxelGrid): Projections {
  const front = emptyGrid();
  const side = emptyGrid();
  const top = emptyGrid();

  // For front view at (x, y): voxel with max z wins.
  const frontMaxZ: number[][] = Array.from({ length: GRID_SIZE }, () =>
    Array<number>(GRID_SIZE).fill(-1),
  );
  // For side view at (z, y): voxel with max x wins.
  const sideMaxX: number[][] = Array.from({ length: GRID_SIZE }, () =>
    Array<number>(GRID_SIZE).fill(-1),
  );
  // For top view at (x, z): voxel with max y wins.
  const topMaxY: number[][] = Array.from({ length: GRID_SIZE }, () =>
    Array<number>(GRID_SIZE).fill(-1),
  );

  for (const v of grid.voxels) {
    if (v.z > frontMaxZ[v.y][v.x]) {
      frontMaxZ[v.y][v.x] = v.z;
      // Render row: top of grid = y=GRID_SIZE-1. So front[GRID_SIZE-1 - y][x]
      front[GRID_SIZE - 1 - v.y][v.x] = v.color;
    }
    if (v.x > sideMaxX[v.y][v.z]) {
      sideMaxX[v.y][v.z] = v.x;
      side[GRID_SIZE - 1 - v.y][v.z] = v.color;
    }
    if (v.y > topMaxY[v.z][v.x]) {
      topMaxY[v.z][v.x] = v.y;
      // Top view: row 0 = back of model (z=0)
      top[v.z][v.x] = v.color;
    }
  }

  return { front, side, top };
}

export function silhouetteToAscii(s: Silhouette): string {
  return s
    .map(row => row.map(c => (c ? LETTER[c] : '.')).join(''))
    .join('\n');
}

export function projectionsToPromptBlock(p: Projections): string {
  return [
    'front:',
    silhouetteToAscii(p.front),
    '',
    'side:',
    silhouetteToAscii(p.side),
    '',
    'top:',
    silhouetteToAscii(p.top),
  ].join('\n');
}

/**
 * Format a VoxelGrid as the 8-layer voxel ASCII used in pass-2 prompts.
 * Rows within each layer: row 0 = z=0 (back), row 7 = z=7 (front).
 * Columns: x=0 left, x=7 right.
 */
export function gridToLayerAscii(grid: VoxelGrid): string {
  const layers: string[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    const rows: string[][] = Array.from({ length: GRID_SIZE }, () =>
      Array<string>(GRID_SIZE).fill('.'),
    );
    for (const v of grid.voxels) {
      if (v.y !== y) continue;
      rows[v.z][v.x] = LETTER[v.color];
    }
    layers.push(`y=${y}\n${rows.map(r => r.join('')).join('\n')}`);
  }
  return layers.join('\n\n');
}
