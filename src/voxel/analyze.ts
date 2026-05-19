import type { Voxel, VoxelGrid } from './types.ts';

export type Connectivity = {
  components: number;
  largestComponent: number;
  floatingCount: number;
  touchesGround: boolean;
};

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

const NEIGHBORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function analyze(grid: VoxelGrid): Connectivity {
  const set = new Set<string>();
  for (const v of grid.voxels) set.add(key(v.x, v.y, v.z));

  let touchesGround = false;
  for (const v of grid.voxels) {
    if (v.y === 0) {
      touchesGround = true;
      break;
    }
  }

  let floatingCount = 0;
  for (const v of grid.voxels) {
    if (v.y === 0) continue;
    if (!set.has(key(v.x, v.y - 1, v.z))) floatingCount++;
  }

  const visited = new Set<string>();
  let components = 0;
  let largestComponent = 0;
  for (const v of grid.voxels) {
    const k = key(v.x, v.y, v.z);
    if (visited.has(k)) continue;
    components++;
    let size = 0;
    const stack: Voxel[] = [v];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const ck = key(cur.x, cur.y, cur.z);
      if (visited.has(ck)) continue;
      visited.add(ck);
      size++;
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nz = cur.z + dz;
        const nk = key(nx, ny, nz);
        if (set.has(nk) && !visited.has(nk)) {
          stack.push({ x: nx, y: ny, z: nz, color: 'red' });
        }
      }
    }
    if (size > largestComponent) largestComponent = size;
  }

  return { components, largestComponent, floatingCount, touchesGround };
}
