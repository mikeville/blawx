// Offline library-seeding pipeline: for each noun in the 30-noun benchmark
// list (src/bench/nouns.ts) with a hardcoded Font Awesome 6 Free solid icon
// match, rasterize the icon and apply a per-category depth profile (see
// scripts/lib/silhouette.ts). No model/API calls anywhere. Nouns with no
// suitable icon are recorded as MISSes for the next rung of the ladder
// (text-to-2D or LLM drawing).
//
// Usage: npx tsx scripts/seed-library.ts
//   Reads:  node_modules/@fortawesome/fontawesome-free/svgs/solid/<icon>.svg
//   Writes: runs/seed1-16char-fa/<noun>.json        (BenchResult)
//           runs/seed1-16char-fa/masks/<noun>.txt    (front/side/top, icon2 format)
//           runs/seed1-16char-fa/sources/<icon>.svg  (provenance copy, CC BY 4.0)
//           runs/seed1-16char-fa/run.json            (RunManifest)
//           runs/seed1-16char-fa/misses.json         (nouns with no icon match)

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftHull } from '../src/bench/hull.ts';
import { maskToRows } from '../src/bench/maskOps.ts';
import { NOUNS } from '../src/bench/nouns.ts';
import type { BenchResult, RunManifest } from '../src/bench/types.ts';
import {
  applyDepthProfile,
  rasterToFrontMask,
  readSvgFile,
  depthProfileLabel,
  type DepthProfile,
} from './lib/silhouette.ts';

const SIZE = 16;
const OUT_RUN_ID = 'seed1-16char-fa';
const RUN_DIR = join(import.meta.dirname, '..', 'runs', OUT_RUN_ID);
const MASKS_DIR = join(RUN_DIR, 'masks');
const SOURCES_DIR = join(RUN_DIR, 'sources');
const FA_SOLID_DIR = join(
  import.meta.dirname,
  '..',
  'node_modules',
  '@fortawesome',
  'fontawesome-free',
  'svgs',
  'solid',
);

type SeedEntry = { icon: string; profile: DepthProfile };

// noun -> Font Awesome 6 Free solid icon name -> depth profile. `null`
// means no suitable FA icon exists for this noun (recorded as a miss).
const SEED_TABLE: Record<string, SeedEntry | null> = {
  mug: { icon: 'mug-saucer', profile: { kind: 'round', maxDepth: 10 } },
  chair: { icon: 'chair', profile: { kind: 'flat', depth: 4 } },
  house: { icon: 'house', profile: { kind: 'flat', depth: 8 } },
  table: null, // FA "table" is a data-grid glyph, not furniture
  sword: null,
  sailboat: { icon: 'sailboat', profile: { kind: 'flat', depth: 2 } },
  lighthouse: null,
  ladder: null,
  car: { icon: 'car-side', profile: { kind: 'flat', depth: 6 } },
  hat: { icon: 'hat-cowboy', profile: { kind: 'round', maxDepth: 10 } },
  fox: null,
  bird: { icon: 'crow', profile: { kind: 'inflate' } },
  fish: { icon: 'fish', profile: { kind: 'inflate' } },
  flower: null,
  tree: { icon: 'tree', profile: { kind: 'round', maxDepth: 10 } },
  cat: { icon: 'cat', profile: { kind: 'inflate' } },
  duck: null,
  mushroom: null,
  frog: { icon: 'frog', profile: { kind: 'inflate' } },
  snail: null,
  horse: { icon: 'horse', profile: { kind: 'inflate' } },
  penguin: null,
  octopus: null,
  dragon: { icon: 'dragon', profile: { kind: 'inflate' } },
  robot: { icon: 'robot', profile: { kind: 'flat', depth: 6 } },
  spider: { icon: 'spider', profile: { kind: 'prone', height: 3 } },
  love: { icon: 'heart', profile: { kind: 'inflate' } },
  'palm tree': null,
  'ice cream cone': { icon: 'ice-cream', profile: { kind: 'round', maxDepth: 10 } },
  'rocket ship': { icon: 'rocket', profile: { kind: 'round', maxDepth: 10 } },
};

/** Filename stem for a noun, matching scripts/make-prompts.ts's convention:
 *  spaces become hyphens (e.g. "rocket ship" -> "rocket-ship"). */
function nounFileStem(noun: string): string {
  return noun.replace(/\s+/g, '-');
}

function seedNoun(noun: string, entry: SeedEntry): {
  result: BenchResult;
  filledCells: number;
  voxelCount: number;
  maxDepthUsed: number;
} {
  const svgPath = join(FA_SOLID_DIR, `${entry.icon}.svg`);
  if (!existsSync(svgPath)) {
    throw new Error(`${noun}: icon file not found: ${svgPath}`);
  }
  const svg = readSvgFile(svgPath);

  const { front: groundedFront, rawMask, note } = rasterToFrontMask(svg, `${noun} (${entry.icon})`);

  const { front, side, top, maxDepthUsed } = applyDepthProfile(
    entry.profile,
    groundedFront,
    rawMask,
    `${noun} (${entry.icon})`,
  );

  const { voxels } = liftHull(front, side, top, SIZE);

  const profileLabel = depthProfileLabel(entry.profile);
  const result: BenchResult = {
    noun,
    size: SIZE,
    voxels,
    meta: {
      model: 'none-icon-downsample',
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
      notes:
        `seeded from Font Awesome 6 solid "${entry.icon}", depth profile ${profileLabel}` +
        (note ? `; ${note}` : ''),
    },
  };

  const filledCells = maskToRows(front).reduce(
    (sum, row) => sum + [...row].filter((ch) => ch === '#').length,
    0,
  );

  // Copy the source SVG into this run's sources/ for provenance.
  mkdirSync(SOURCES_DIR, { recursive: true });
  copyFileSync(svgPath, join(SOURCES_DIR, `${entry.icon}.svg`));

  return { result, filledCells, voxelCount: voxels.length, maxDepthUsed };
}

function main(): void {
  mkdirSync(RUN_DIR, { recursive: true });
  mkdirSync(MASKS_DIR, { recursive: true });

  const misses: string[] = [];
  let seeded = 0;

  for (const { noun } of NOUNS) {
    const entry = SEED_TABLE[noun];
    if (entry === undefined) {
      throw new Error(`seed-library: noun "${noun}" is missing from SEED_TABLE`);
    }
    if (entry === null) {
      misses.push(noun);
      console.log(`${noun}: MISS (no suitable Font Awesome icon)`);
      continue;
    }

    const { result, filledCells, voxelCount, maxDepthUsed } = seedNoun(noun, entry);
    const stem = nounFileStem(noun);

    writeFileSync(join(RUN_DIR, `${stem}.json`), JSON.stringify(result));

    const { front: frontRows, side: sideRows, top: topRows } = result.meta!.masks!;
    const sections = [
      ['front', frontRows],
      ['side', sideRows],
      ['top', topRows],
    ] as const;
    const text = sections.map(([label, rows]) => `${label}\n${rows.join('\n')}`).join('\n\n') + '\n';
    writeFileSync(join(MASKS_DIR, `${stem}.txt`), text);

    const profileLabel = depthProfileLabel(entry.profile);
    console.log(
      `${noun} (${entry.icon}): profile ${profileLabel}, ${filledCells} filled front cells, ` +
        `${voxelCount} voxels, max depth ${maxDepthUsed}`,
    );
    seeded += 1;
  }

  writeFileSync(join(RUN_DIR, 'misses.json'), JSON.stringify(misses, null, 2) + '\n');

  const manifest: RunManifest = {
    id: OUT_RUN_ID,
    label: 'seed1 16³ · FA silhouette, per-noun depth profile',
    date: '2026-07-04',
    pipeline:
      'noun-keyed library seed: Font Awesome 6 solid icon (hardcoded per-noun lookup table) → ' +
      '480px raster → ink-bbox-fit 16×16 front mask → per-noun depth profile ' +
      '(flat(d) | inflate | round(maxDepth) | prone(h), see scripts/lib/silhouette.ts) → strict lift. ' +
      'Nouns with no suitable icon are recorded in misses.json. No model calls.',
    conditions: {
      grid: '16',
      encoding: 'char',
      model: 'none',
      source: 'font-awesome-6-solid (CC BY 4.0)',
      depth: 'per-noun profile',
    },
  };
  writeFileSync(join(RUN_DIR, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\nseeded ${seeded}/${NOUNS.length} nouns, ${misses.length} misses: ${misses.join(', ')}`);
}

main();
