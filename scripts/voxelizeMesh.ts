// Triangle soup → solid 8³ VoxelGrid.
//
// 1. Fit: uniform-scale the mesh so its longest axis spans the grid,
//    centered on x/z, resting on y=0.
// 2. Surface: sample each triangle at sub-voxel spacing, marking cells and
//    accumulating the triangle color per cell.
// 3. Solid fill: flood the exterior from the grid boundary; every unreached
//    empty cell is interior and gets filled, inheriting the color of the
//    nearest surface cell.
// 4. Keep the largest face-connected component (thin diagonal features can
//    shear off at this resolution), snap colors to the 7-color palette.

import type { Color, Voxel, VoxelGrid } from '../src/voxel/types.ts';
import { GRID_SIZE } from '../src/voxel/types.ts';
import { COLORS } from '../src/render/palette.ts';
import type { Triangle, Vec3 } from './glb.ts';

const N = GRID_SIZE;
const CELLS = N * N * N;

export type VoxelizeStats = {
  surfaceCells: number;
  interiorFilled: number;
  droppedCells: number;
};

const idx = (x: number, y: number, z: number) => (y * N + z) * N + x;

const NEIGHBORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function paletteRgb(): { color: Color; rgb: [number, number, number] }[] {
  return (Object.entries(COLORS) as [Color, string][]).map(([color, hex]) => {
    const v = hex.replace('#', '');
    return {
      color,
      rgb: [
        parseInt(v.slice(0, 2), 16) / 255,
        parseInt(v.slice(2, 4), 16) / 255,
        parseInt(v.slice(4, 6), 16) / 255,
      ],
    };
  });
}

const PALETTE = paletteRgb();

export function snapToPalette(r: number, g: number, b: number): Color {
  let best: Color = 'yellow';
  let bestDist = Infinity;
  for (const entry of PALETTE) {
    const dr = r - entry.rgb[0];
    const dg = g - entry.rgb[1];
    const db = b - entry.rgb[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry.color;
    }
  }
  return best;
}

export function voxelizeTriangles(
  triangles: Triangle[],
): { grid: VoxelGrid; stats: VoxelizeStats } {
  if (triangles.length === 0) {
    return {
      grid: { size: N, voxels: [] },
      stats: { surfaceCells: 0, interiorFilled: 0, droppedCells: 0 },
    };
  }

  // --- fit transform ---
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      for (let axis = 0; axis < 3; axis++) {
        if (p[axis] < min[axis]) min[axis] = p[axis];
        if (p[axis] > max[axis]) max[axis] = p[axis];
      }
    }
  }
  const extent: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const maxExtent = Math.max(...extent, 1e-9);
  const scale = (N - 1e-6) / maxExtent;
  // Center each axis's occupied span within the grid; y stays bottom-aligned.
  const pad: Vec3 = [
    (N - extent[0] * scale) / 2,
    0,
    (N - extent[2] * scale) / 2,
  ];
  const toCell = (p: Vec3): [number, number, number] => {
    const cx = Math.floor((p[0] - min[0]) * scale + pad[0]);
    const cy = Math.floor((p[1] - min[1]) * scale);
    const cz = Math.floor((p[2] - min[2]) * scale + pad[2]);
    const clamp = (v: number) => Math.max(0, Math.min(N - 1, v));
    return [clamp(cx), clamp(cy), clamp(cz)];
  };

  // --- surface sampling ---
  const occupied = new Uint8Array(CELLS);
  const colorSum = new Float64Array(CELLS * 3);
  const colorCount = new Uint32Array(CELLS);
  const cellSize = 1 / scale;
  const spacing = cellSize / 3;

  for (const t of triangles) {
    const len = (p: Vec3, q: Vec3) =>
      Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const maxEdge = Math.max(len(t.a, t.b), len(t.b, t.c), len(t.c, t.a));
    const steps = Math.max(1, Math.ceil(maxEdge / spacing));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        const p: Vec3 = [
          u * t.a[0] + v * t.b[0] + w * t.c[0],
          u * t.a[1] + v * t.b[1] + w * t.c[1],
          u * t.a[2] + v * t.b[2] + w * t.c[2],
        ];
        const [cx, cy, cz] = toCell(p);
        const k = idx(cx, cy, cz);
        occupied[k] = 1;
        colorSum[k * 3] += t.rgb[0];
        colorSum[k * 3 + 1] += t.rgb[1];
        colorSum[k * 3 + 2] += t.rgb[2];
        colorCount[k]++;
      }
    }
  }
  let surfaceCells = 0;
  for (let k = 0; k < CELLS; k++) if (occupied[k]) surfaceCells++;

  // --- solid fill: flood exterior from boundary, fill the rest ---
  const exterior = new Uint8Array(CELLS);
  const queue: number[] = [];
  for (let y = 0; y < N; y++) {
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const boundary =
          x === 0 || x === N - 1 || y === 0 || y === N - 1 || z === 0 || z === N - 1;
        const k = idx(x, y, z);
        if (boundary && !occupied[k] && !exterior[k]) {
          exterior[k] = 1;
          queue.push(k);
        }
      }
    }
  }
  while (queue.length > 0) {
    const k = queue.pop()!;
    const x = k % N;
    const z = Math.floor(k / N) % N;
    const y = Math.floor(k / (N * N));
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= N || ny < 0 || ny >= N || nz < 0 || nz >= N) continue;
      const nk = idx(nx, ny, nz);
      if (!occupied[nk] && !exterior[nk]) {
        exterior[nk] = 1;
        queue.push(nk);
      }
    }
  }

  // Interior cells inherit color from the nearest surface cell (BFS inward).
  const interiorQueue: number[] = [];
  for (let k = 0; k < CELLS; k++) if (occupied[k]) interiorQueue.push(k);
  let interiorFilled = 0;
  let head = 0;
  while (head < interiorQueue.length) {
    const k = interiorQueue[head++];
    const x = k % N;
    const z = Math.floor(k / N) % N;
    const y = Math.floor(k / (N * N));
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || nx >= N || ny < 0 || ny >= N || nz < 0 || nz >= N) continue;
      const nk = idx(nx, ny, nz);
      if (!occupied[nk] && !exterior[nk]) {
        occupied[nk] = 1;
        interiorFilled++;
        colorSum[nk * 3] = colorSum[k * 3];
        colorSum[nk * 3 + 1] = colorSum[k * 3 + 1];
        colorSum[nk * 3 + 2] = colorSum[k * 3 + 2];
        colorCount[nk] = colorCount[k];
        interiorQueue.push(nk);
      }
    }
  }

  // --- largest face-connected component ---
  const component = new Int32Array(CELLS).fill(-1);
  const sizes: number[] = [];
  for (let k = 0; k < CELLS; k++) {
    if (!occupied[k] || component[k] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [k];
    component[k] = id;
    while (stack.length > 0) {
      const c = stack.pop()!;
      size++;
      const x = c % N;
      const z = Math.floor(c / N) % N;
      const y = Math.floor(c / (N * N));
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nx >= N || ny < 0 || ny >= N || nz < 0 || nz >= N) continue;
        const nk = idx(nx, ny, nz);
        if (occupied[nk] && component[nk] === -1) {
          component[nk] = id;
          stack.push(nk);
        }
      }
    }
    sizes.push(size);
  }
  let keep = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[keep]) keep = i;
  const droppedCells = sizes.reduce((sum, s, i) => (i === keep ? sum : sum + s), 0);

  // --- emit voxels ---
  const voxels: Voxel[] = [];
  let minY = N;
  for (let y = 0; y < N; y++) {
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const k = idx(x, y, z);
        if (!occupied[k] || component[k] !== keep) continue;
        const count = Math.max(1, colorCount[k]);
        const color = snapToPalette(
          colorSum[k * 3] / count,
          colorSum[k * 3 + 1] / count,
          colorSum[k * 3 + 2] / count,
        );
        voxels.push({ x, y, z, color });
        if (y < minY) minY = y;
      }
    }
  }
  if (minY > 0 && minY < N) {
    for (const v of voxels) v.y -= minY;
  }

  return {
    grid: { size: N, voxels },
    stats: { surfaceCells, interiorFilled, droppedCells },
  };
}
