// Offline $0 generator for open-ended nouns that aren't in the FA/FLUX seed
// table (scripts/seed-library.ts). The front silhouette is hand-authored
// here — this session IS the "subscription generator" in the human-in-loop
// scaffold, so there is NO model / Anthropic / Replicate call anywhere in
// this path. Depth is synthesized with the same deterministic profiles used
// by the library seed, and the output is byte-compatible with
// runs/seed4-16char-mixed/*.json so ../api/scripts/seed4.ts can seed it to
// KV and the SPA renders it identically to the library nouns.
//
// Usage: npx tsx scripts/gen-noun.ts <noun>
//   Writes runs/seed4-16char-mixed/<stem>.json (BenchResult).
//   Remember to add a NOUN_COLOR entry in src/voxel/seed4.ts (else the grid
//   falls back to lightGray), then reseed: cd ../api && npx tsx scripts/seed4.ts --local

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftHull } from '../src/bench/hull.ts';
import { maskToRows } from '../src/bench/maskOps.ts';
import type { BenchResult } from '../src/bench/types.ts';
import type { Mask } from '../src/bench/encodings.ts';
import {
  applyDepthProfile,
  emptyMask,
  groundMask,
  SIZE,
  type DepthProfile,
} from './lib/silhouette.ts';

// Hand-authored front silhouettes as filled-column sets per row (row 0 =
// top, col 0 = left). Column-sets rather than '#/.' strings so each row is
// verifiable at a glance and can't drift to the wrong width.
type Authored = { profile: DepthProfile; cols: number[][] };

const AUTHORED: Record<string, Authored> = {
  // Rooster facing left: comb + head + beak upper-left, bulky body center,
  // sickle tail sweeping up on the right, two legs. inflate profile (the
  // same one every library animal uses) rounds the body to ~depth 4.
  rooster: {
    profile: { kind: 'inflate' },
    cols: [
      [13, 14], //  0  tail tips
      [3, 4, 12, 13, 14], //  1  comb tips · tail
      [2, 3, 4, 5, 12, 13, 14], //  2  comb · tail
      [3, 4, 5, 11, 12, 13, 14], //  3  head · tail
      [1, 2, 3, 4, 5, 6, 11, 12, 13], //  4  beak · head · tail
      [0, 1, 2, 3, 4, 5, 6, 11, 12, 13], //  5  beak · head · tail
      [2, 3, 4, 5, 6, 7, 11, 12, 13], //  6  wattle · neck · tail
      [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14], //  7  neck · body · tail
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], //  8  breast · body · tail base
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], //  9  body
      [4, 5, 6, 7, 8, 9, 10, 11], // 10  body
      [4, 5, 6, 7, 8, 9, 10, 11], // 11  body
      [5, 6, 7, 8, 9, 10], // 12  lower body
      [6, 7, 9, 10], // 13  legs
      [6, 7, 9, 10], // 14  legs
      [5, 6, 7, 9, 10, 11], // 15  feet
    ],
  },
};

function colsToMask(cols: number[][]): Mask {
  if (cols.length !== SIZE) {
    throw new Error(`need ${SIZE} rows, got ${cols.length}`);
  }
  const mask = emptyMask();
  cols.forEach((row, r) => {
    for (const c of row) {
      if (c < 0 || c >= SIZE) throw new Error(`row ${r}: col ${c} out of [0,${SIZE})`);
      mask[r][c] = true;
    }
  });
  return mask;
}

function asciiPreview(mask: Mask): string {
  return maskToRows(mask)
    .map((row) => [...row].map((ch) => (ch === '#' ? '█' : '·')).join(''))
    .join('\n');
}

function main(): void {
  const noun = process.argv[2];
  if (!noun) throw new Error('usage: npx tsx scripts/gen-noun.ts <noun>');
  const authored = AUTHORED[noun];
  if (!authored) {
    throw new Error(`no hand-authored mask for "${noun}"; known: ${Object.keys(AUTHORED).join(', ')}`);
  }

  const raw = colsToMask(authored.cols);
  const grounded = groundMask(raw);
  const { front, side, top, maxDepthUsed } = applyDepthProfile(
    authored.profile,
    grounded,
    grounded,
    noun,
  );
  const { voxels } = liftHull(front, side, top, SIZE);

  const result: BenchResult = {
    noun,
    size: SIZE,
    voxels,
    meta: {
      model: 'none-handauthored',
      encoding: 'char',
      tokensIn: 0,
      tokensOut: 0,
      hull: {
        malformedRows: 0,
        reprojectionLoss: { front: 0, side: 0, top: 0 },
        variant: 'icon',
      },
      masks: {
        front: maskToRows(front),
        side: maskToRows(side),
        top: maskToRows(top),
      },
      notes: `hand-authored front silhouette, depth profile ${authored.profile.kind}`,
    },
  };

  const stem = noun.replace(/\s+/g, '-');
  const runDir = join(import.meta.dirname, '..', 'runs', 'seed4-16char-mixed');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, `${stem}.json`), JSON.stringify(result));

  console.log(asciiPreview(front));
  console.log(
    `\n${noun}: ${voxels.length} voxels, max depth ${maxDepthUsed}, ` +
      `wrote runs/seed4-16char-mixed/${stem}.json`,
  );
}

main();
