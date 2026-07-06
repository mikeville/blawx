// Backfill meta.masks (front/side/top silhouette strings) onto the gen2
// 16-char sheet JSONs, which were generated before meta.masks existed.
//
// Does NOT touch noun/size/voxels or any other field — only inserts a
// `meta.masks` object, matching the shape the viewer already renders
// (see runs/probe1-16char-sonnet/*.json for reference).
//
// Projection convention (matches src/bench/hull.ts liftByVote):
//   coords: x right, y up, z back. size = 16.
//   front[row][col]: row = size-1-y, col = x
//   side[row][col]:  row = size-1-y, col = z
//   top[row][col]:   row = size-1-z, col = x
//
// Usage: npx tsx scripts/backfill-gen2-sheets-masks.ts

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RUNS_DIR = join(import.meta.dirname, '..', 'runs', 'gen2-16char-sheets');

type Voxel = [number, number, number];

function buildMasks(voxels: Voxel[], size: number): { front: string[]; side: string[]; top: string[] } {
  const front: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const side: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const top: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  for (const [x, y, z] of voxels) {
    const fr = size - 1 - y;
    const tr = size - 1 - z;
    front[fr][x] = true;
    side[fr][z] = true;
    top[tr][x] = true;
  }

  const toRows = (mask: boolean[][]): string[] =>
    mask.map((row) => row.map((v) => (v ? '#' : '.')).join(''));

  return { front: toRows(front), side: toRows(side), top: toRows(top) };
}

// Non-result sidecars that live alongside per-noun result files in a run
// dir (manifest, generation candidates, miss lists, calibration passes).
// Mirrors the skip-list in src/App.tsx's run loader.
const NON_RESULT_BASENAMES = new Set(['run', 'gen', 'scores', 'misses', 'scores-calibration']);

function main() {
  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !NON_RESULT_BASENAMES.has(f.replace(/\.json$/, '')));
  let updated = 0;

  for (const file of files) {
    const path = join(RUNS_DIR, file);
    const raw = readFileSync(path, 'utf8');
    const hadTrailingNewline = raw.endsWith('\n');
    const data = JSON.parse(raw);

    if (data.meta && data.meta.masks) {
      console.log(`skip (already has meta.masks): ${file}`);
      continue;
    }

    const size: number = data.size;
    const voxels: Voxel[] = data.voxels;
    const masks = buildMasks(voxels, size);

    const next = {
      noun: data.noun,
      size: data.size,
      voxels: data.voxels,
      meta: { masks },
    };

    let out = JSON.stringify(next, null, 2);
    if (hadTrailingNewline) out += '\n';
    writeFileSync(path, out, 'utf8');
    updated += 1;
  }

  console.log(`Updated ${updated} of ${files.length} files.`);
}

main();
