import { buildSteps, allBricks } from './steps.ts';
import type { Brick, Color, Voxel, VoxelGrid } from './types.ts';

// Canonical letter legend shared with the Worker's paint frame — one letter
// per brick color, '.' for an empty cell. Kept as a hand copy (the client
// owns no server import) so this must stay in sync with the Worker by hand.
export const LETTER_COLOR: Record<string, Color> = {
  R: 'red',
  O: 'orange',
  Y: 'yellow',
  G: 'green',
  B: 'blue',
  N: 'brown',
  T: 'tan',
  W: 'white',
  L: 'lightGray',
  K: 'black',
};

const OVERLAY_CHARS = new Set(['.', ...Object.keys(LETTER_COLOR)]);

/**
 * Split a 256-char row-major overlay string into `size` rows of `size`
 * chars each. Returns null if the length is wrong or any character falls
 * outside the '.' + legend-letter charset — malformed input is a signal to
 * fall back, not a crash.
 */
export function overlayRows(overlay: string, size = 16): string[] | null {
  if (overlay.length !== size * size) return null;
  for (const ch of overlay) {
    if (!OVERLAY_CHARS.has(ch)) return null;
  }
  const rows: string[] = [];
  for (let r = 0; r < size; r++) {
    rows.push(overlay.slice(r * size, (r + 1) * size));
  }
  return rows;
}

/**
 * A 256-char paint overlay (row-major, '.' empty / letter = filled cell's
 * color) → a one-voxel-deep brick layer at the front plane (z=0), same
 * shape as `frontMaskToBricks` but carrying per-cell color instead of a
 * single flat color. The Worker streams this mid-build once the model has
 * assigned real colors to the front silhouette already on stage, so the
 * geometry here matches `frontMaskToBricks`'s exactly — same row/col → x/y
 * mapping — only the color varies per cell. Malformed input (wrong length
 * or a stray character) returns [] rather than throwing.
 */
export function overlayToBricks(overlay: string, size = 16): Brick[] {
  const rows = overlayRows(overlay, size);
  if (!rows) return [];
  const voxels: Voxel[] = [];
  for (let r = 0; r < size; r++) {
    const row = rows[r]!;
    for (let c = 0; c < size; c++) {
      const letter = row[c]!;
      const color = LETTER_COLOR[letter];
      if (color) voxels.push({ x: c, y: size - 1 - r, z: 0, color });
    }
  }
  const grid: VoxelGrid = { size, voxels };
  return allBricks(buildSteps(grid));
}

/**
 * Recolor every voxel in `grid` from a parsed overlay (`rows`, as returned
 * by `overlayRows`), falling back to `fallback` for any voxel whose cell
 * isn't a legend letter (overlay shorter/sparser than the grid, or a '.'
 * where the grid has a filled voxel). Geometry is untouched — only `color`
 * changes.
 */
export function colorGridWithOverlay(
  grid: VoxelGrid,
  rows: string[],
  fallback: Color,
): VoxelGrid {
  const size = grid.size;
  const voxels = grid.voxels.map((v) => {
    const row = rows[size - 1 - v.y];
    const letter = row?.[v.x];
    const color = letter ? LETTER_COLOR[letter] : undefined;
    return color ? { ...v, color } : { ...v, color: fallback };
  });
  return { size, voxels };
}
