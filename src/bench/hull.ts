// Three-view visual-hull intersection: lift front/side/top silhouette masks
// into a voxel set. Strict intersection only — no symmetry, no repairs
// (those are Phase 2 pipeline concerns; the sweep measures raw emission).
//
// Coordinates match the renderer: x right, y up, z back. Mask conventions
// are documented in encodings.ts. A voxel exists iff all three views claim
// its projection cell.

import type { Mask } from './encodings.ts';
import type { Vec3 } from './types.ts';

export type HullResult = {
  voxels: Vec3[];
  /**
   * Per view: fraction of filled mask cells that NO hull voxel projects
   * back onto. 0 = views perfectly consistent; high values = the views
   * contradict each other (a key sweep failure metric).
   */
  reprojectionLoss: { front: number; side: number; top: number };
};

/** Fraction of `mask`'s filled cells that `hit` never marked. */
export function reprojectionLoss(mask: Mask, hit: boolean[][], size: number): number {
  let set = 0;
  let missed = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (mask[r][c]) {
        set += 1;
        if (!hit[r][c]) missed += 1;
      }
    }
  }
  return set === 0 ? 0 : missed / set;
}

/**
 * Lift three views into voxels using a per-voxel vote threshold: `minVotes`
 * of the three views must claim a voxel's projection for it to lift. Strict
 * intersection (liftHull) is minVotes=3; 2-of-3 voting (liftVote in
 * maskOps.ts) is minVotes=2. Shared here so both stay in sync on the
 * projection/axis conventions.
 */
export function liftByVote(front: Mask, side: Mask, top: Mask, size: number, minVotes: number): HullResult {
  const voxels: Vec3[] = [];
  const hitF: boolean[][] = front.map((r) => r.map(() => false));
  const hitS: boolean[][] = side.map((r) => r.map(() => false));
  const hitT: boolean[][] = top.map((r) => r.map(() => false));

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const fr = size - 1 - y;
        const tr = size - 1 - z;
        const fHit = front[fr][x];
        const sHit = side[fr][z];
        const tHit = top[tr][x];
        const votes = (fHit ? 1 : 0) + (sHit ? 1 : 0) + (tHit ? 1 : 0);
        if (votes >= minVotes) {
          voxels.push([x, y, z]);
          if (fHit) hitF[fr][x] = true;
          if (sHit) hitS[fr][z] = true;
          if (tHit) hitT[tr][x] = true;
        }
      }
    }
  }

  return {
    voxels,
    reprojectionLoss: {
      front: reprojectionLoss(front, hitF, size),
      side: reprojectionLoss(side, hitS, size),
      top: reprojectionLoss(top, hitT, size),
    },
  };
}

export function liftHull(front: Mask, side: Mask, top: Mask, size: number): HullResult {
  return liftByVote(front, side, top, size, 3);
}
