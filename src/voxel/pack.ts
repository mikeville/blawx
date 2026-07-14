import type { Brick, Voxel } from './types.ts';

function key(x: number, z: number): string {
  return `${x},${z}`;
}

type Footprint = { w: number; d: number };

// Footprint preference, most-common-first (real LEGO commonality; 2×4 is the
// iconic workhorse brick). Greedy takes the FIRST candidate that fits, so on a
// clean flat region the 2×4 dominates and the longer 2×6/2×8/1×6/1×8 stay legal
// but almost never fire — that's intentional: we prioritize common shapes over
// maximal coverage. Entries are unoriented [long, short].
const FOOTPRINT_PREFERENCE: ReadonlyArray<readonly [number, number]> = [
  [4, 2], // 2×4
  [2, 2], // 2×2
  [3, 2], // 2×3
  [4, 1], // 1×4
  [2, 1], // 1×2
  [1, 1], // 1×1
  [3, 1], // 1×3
  [6, 2], // 2×6  — legal, rarely chosen
  [6, 1], // 1×6
  [8, 2], // 2×8  — rare, last resort
  [8, 1], // 1×8
];

// Candidate footprints in preference order, oriented for a given layer. Each
// preference entry expands to one footprint (square) or two (rectangular —
// both orientations). For rectangular entries, running bond decides which
// orientation goes first: on even layers the x-major orientation (wider
// along x) leads, on odd layers the z-major orientation (deeper along z)
// leads. That staggers long seams between courses instead of stacking them
// straight up, layer after layer.
function candidateOrder(y: number): Footprint[] {
  const out: Footprint[] = [];
  const xMajorFirst = y % 2 === 0;
  for (const [long, short] of FOOTPRINT_PREFERENCE) {
    if (long === short) {
      out.push({ w: long, d: short });
      continue;
    }
    const xMajor: Footprint = { w: long, d: short };
    const zMajor: Footprint = { w: short, d: long };
    out.push(...(xMajorFirst ? [xMajor, zMajor] : [zMajor, xMajor]));
  }
  return out;
}

export function packLayer(layerVoxels: Voxel[]): Brick[] {
  if (layerVoxels.length === 0) return [];
  const y = layerVoxels[0]!.y;
  const cells = new Map<string, Voxel>();
  // Loop bounds derived from filled cells so pack.ts is grid-size-independent
  // (the ported 8³ version hardcoded GRID_SIZE here).
  let maxX = 0;
  let maxZ = 0;
  for (const v of layerVoxels) {
    cells.set(key(v.x, v.z), v);
    if (v.x > maxX) maxX = v.x;
    if (v.z > maxZ) maxZ = v.z;
  }

  const candidates = candidateOrder(y);
  const consumed = new Set<string>();
  const bricks: Brick[] = [];

  for (let z = 0; z <= maxZ; z++) {
    for (let x = 0; x <= maxX; x++) {
      const k = key(x, z);
      if (consumed.has(k)) continue;
      const v = cells.get(k);
      if (!v) continue;

      // Candidates are pre-sorted most-common-first, so the first one that
      // fits (same color, unconsumed, in-bounds for every covered cell) is
      // the preferred legal brick for this anchor.
      let placed: Footprint | null = null;
      for (const c of candidates) {
        let fits = true;
        for (let i = 0; i < c.w && fits; i++) {
          for (let j = 0; j < c.d && fits; j++) {
            const ck = key(x + i, z + j);
            if (consumed.has(ck)) { fits = false; break; }
            const cv = cells.get(ck);
            if (!cv || cv.color !== v.color) { fits = false; break; }
          }
        }
        if (fits) {
          placed = c;
          break;
        }
      }
      // candidates always includes 1x1, so placed is never null here.
      const { w, d } = placed!;
      bricks.push({ x, y, z, w, d, color: v.color });
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < d; j++) {
          consumed.add(key(x + i, z + j));
        }
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
