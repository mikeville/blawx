import { colorGridWithOverlay, overlayRows } from './colorOverlay.ts';
import type { Color, Voxel, VoxelGrid } from './types.ts';

// Seed4 JSON shape: `{noun, size, voxels: [[x,y,z], ...]}` with no color
// information. v1 assigns a single hand-authored color per noun; misses
// fall back to lightGray. An optional per-noun overlay file (16 rows of 16
// '.'/legend-letter chars — the same format as the Worker's live paint
// frame) can recolor the bundled seed on top of that fallback; a missing or
// malformed overlay leaves the flat NOUN_COLOR behavior unchanged. When
// live-gen lands (v2), the model will emit colors and this table becomes
// vestigial for cache misses.
export type Seed4Json = {
  noun: string;
  size: number;
  voxels: [number, number, number][];
};

const NOUN_COLOR: Record<string, Color> = {
  bird: 'blue',
  car: 'red',
  cat: 'black',
  chair: 'yellow',
  dragon: 'green',
  duck: 'yellow',
  fish: 'blue',
  fox: 'red',
  frog: 'green',
  hat: 'black',
  horse: 'black',
  house: 'red',
  'ice-cream-cone': 'white',
  lighthouse: 'red',
  love: 'red',
  mug: 'blue',
  mushroom: 'red',
  octopus: 'red',
  'palm-tree': 'green',
  penguin: 'black',
  robot: 'lightGray',
  rooster: 'red',
  'rocket-ship': 'white',
  run: 'lightGray',
  sailboat: 'white',
  snail: 'yellow',
  spider: 'black',
  sword: 'blue',
  table: 'yellow',
  tree: 'green',
};

export function colorFor(noun: string): Color {
  return NOUN_COLOR[noun] ?? 'lightGray';
}

// Split an overlay file's raw text into rows, tolerating a trailing
// newline. Reuses `overlayRows`'s length/charset validation by re-joining
// once every line has already been confirmed to be exactly `size` chars —
// that guarantees the re-chunking lines back up with the original rows
// rather than silently drifting on a malformed line.
function parseOverlayFile(text: string, size = 16): string[] | null {
  let lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines = lines.slice(0, -1);
  if (lines.length !== size || lines.some((line) => line.length !== size)) return null;
  return overlayRows(lines.join(''), size);
}

export function seed4ToGrid(json: Seed4Json, overlay?: string): VoxelGrid {
  const color = colorFor(json.noun);
  const voxels: Voxel[] = json.voxels.map(([x, y, z]) => ({ x, y, z, color }));
  const grid: VoxelGrid = { size: json.size, voxels };
  if (overlay === undefined) return grid;
  const rows = parseOverlayFile(overlay);
  if (!rows) return grid;
  return colorGridWithOverlay(grid, rows, color);
}
