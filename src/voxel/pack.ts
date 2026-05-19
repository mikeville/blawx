import type { Brick, Voxel } from './types.ts';
import { GRID_SIZE } from './types.ts';

function key(x: number, z: number): string {
  return `${x},${z}`;
}

export function packLayer(layerVoxels: Voxel[]): Brick[] {
  if (layerVoxels.length === 0) return [];
  const y = layerVoxels[0]!.y;
  const cells = new Map<string, Voxel>();
  for (const v of layerVoxels) cells.set(key(v.x, v.z), v);

  const consumed = new Set<string>();
  const bricks: Brick[] = [];

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const k = key(x, z);
      if (consumed.has(k)) continue;
      const v = cells.get(k);
      if (!v) continue;

      const v01 = cells.get(key(x + 1, z));
      const v10 = cells.get(key(x, z + 1));
      const v11 = cells.get(key(x + 1, z + 1));
      const canPack2x2 =
        v01 !== undefined &&
        v10 !== undefined &&
        v11 !== undefined &&
        !consumed.has(key(x + 1, z)) &&
        !consumed.has(key(x, z + 1)) &&
        !consumed.has(key(x + 1, z + 1)) &&
        v01.color === v.color &&
        v10.color === v.color &&
        v11.color === v.color;

      if (canPack2x2) {
        bricks.push({ x, y, z, w: 2, d: 2, color: v.color });
        consumed.add(k);
        consumed.add(key(x + 1, z));
        consumed.add(key(x, z + 1));
        consumed.add(key(x + 1, z + 1));
      } else {
        bricks.push({ x, y, z, w: 1, d: 1, color: v.color });
        consumed.add(k);
      }
    }
  }
  return bricks;
}

export function packAllLayers(voxels: Voxel[]): Brick[] {
  const byLayer = new Map<number, Voxel[]>();
  for (const v of voxels) {
    const arr = byLayer.get(v.y);
    if (arr) arr.push(v);
    else byLayer.set(v.y, [v]);
  }
  const out: Brick[] = [];
  const ys = [...byLayer.keys()].sort((a, b) => a - b);
  for (const y of ys) out.push(...packLayer(byLayer.get(y)!));
  return out;
}
