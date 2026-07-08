import type { Color, Voxel, VoxelGrid } from './types.ts';

// Seed4 JSON shape: `{noun, size, voxels: [[x,y,z], ...]}` with no color
// information. v1 assigns a single hand-authored color per noun; misses
// fall back to lightGray. When live-gen lands (v2), the model will emit
// colors and this table becomes vestigial for cache misses.
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

export function seed4ToGrid(json: Seed4Json): VoxelGrid {
  const color = colorFor(json.noun);
  const voxels: Voxel[] = json.voxels.map(([x, y, z]) => ({ x, y, z, color }));
  return { size: json.size, voxels };
}
