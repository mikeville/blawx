// Offline library-seeding pipeline: for each noun in the 30-noun benchmark
// list (src/bench/nouns.ts) with a hardcoded Font Awesome 6 Free solid icon
// match, rasterize the icon and apply a per-category depth profile (see
// scripts/lib/silhouette.ts). No model/API calls anywhere. Nouns with no
// suitable icon are recorded as MISSes for the next rung of the ladder
// (text-to-2D or LLM drawing).
//
// Usage: npx tsx scripts/seed-library.ts [flags]
//   --out=<runId>       output run id (default seed3-16char-fa)
//   --round2=<lo>,<hi>  override every SEED_TABLE `round` entry with the
//                       two-level round2(lo,hi) profile (see silhouette.ts)
//   --only=round        process only nouns whose ORIGINAL profile kind is
//                       `round`; everything else is skipped silently (not
//                       recorded as a miss, and misses.json is not written)
//   --date=<YYYY-MM-DD> manifest date (default 2026-07-05)
//   Reads:  node_modules/@fortawesome/fontawesome-free/svgs/solid/<icon>.svg
//   Writes: runs/<runId>/<noun>.json        (BenchResult)
//           runs/<runId>/masks/<noun>.txt    (front/side/top, icon2 format)
//           runs/<runId>/sources/<icon>.svg  (provenance copy, CC BY 4.0)
//           runs/<runId>/run.json            (RunManifest)
//           runs/<runId>/misses.json         (nouns with no icon match;
//                                              omitted when --only is set)

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

// --- CLI flags (process.argv.slice(2)); see the usage comment above. ---
function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

const OUT_RUN_ID = parseFlag('out') ?? 'seed3-16char-fa';
const ONLY = parseFlag('only'); // e.g. 'round'
const MANIFEST_DATE = parseFlag('date') ?? '2026-07-05';
const ROUND2_RAW = parseFlag('round2'); // e.g. '2,6'
const ROUND2: { lo: number; hi: number } | undefined = ROUND2_RAW
  ? (() => {
      const [lo, hi] = ROUND2_RAW.split(',').map(Number);
      return { lo, hi };
    })()
  : undefined;

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

/**
 * Resolve a SEED_TABLE entry's effective profile for this run: when
 * --round2 is set, every entry whose ORIGINAL profile kind is `round` is
 * overridden with the two-level round2(lo,hi) profile. The literal
 * SEED_TABLE is never mutated — this is applied where entries are read.
 */
function resolveEntry(entry: SeedEntry): SeedEntry {
  if (ROUND2 && entry.profile.kind === 'round') {
    return { icon: entry.icon, profile: { kind: 'round2', lo: ROUND2.lo, hi: ROUND2.hi } };
  }
  return entry;
}

// noun -> Font Awesome 6 Free solid icon name -> depth profile. `null`
// means no suitable FA icon exists for this noun (recorded as a miss).
// The five former `round` nouns (mug, hat, tree, ice cream cone, rocket
// ship) sit at flat(4): round(10) in seed1 and both round2 level-sets in
// the seed2 A/B rendered as stepped blocks — any depth >= 6 on these
// grid-filling silhouettes kills punch-through features and reads as a
// building. flat(4) is the settled treatment.
const SEED_TABLE: Record<string, SeedEntry | null> = {
  mug: { icon: 'mug-saucer', profile: { kind: 'flat', depth: 4 } },
  chair: { icon: 'chair', profile: { kind: 'flat', depth: 4 } },
  house: { icon: 'house', profile: { kind: 'flat', depth: 8 } },
  table: null, // FA "table" is a data-grid glyph, not furniture
  sword: null,
  sailboat: { icon: 'sailboat', profile: { kind: 'flat', depth: 2 } },
  lighthouse: null,
  ladder: null,
  car: { icon: 'car-side', profile: { kind: 'flat', depth: 6 } },
  hat: { icon: 'hat-cowboy', profile: { kind: 'flat', depth: 4 } },
  fox: null,
  bird: { icon: 'crow', profile: { kind: 'inflate' } },
  fish: { icon: 'fish', profile: { kind: 'inflate' } },
  flower: null,
  tree: { icon: 'tree', profile: { kind: 'flat', depth: 4 } },
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
  'ice cream cone': { icon: 'ice-cream', profile: { kind: 'flat', depth: 4 } },
  'rocket ship': { icon: 'rocket', profile: { kind: 'flat', depth: 4 } },
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
    if (ONLY && entry?.profile.kind !== ONLY) {
      // --only filters on the ORIGINAL SEED_TABLE profile kind; skipped
      // nouns are silently omitted (not misses).
      continue;
    }
    if (entry === null) {
      misses.push(noun);
      console.log(`${noun}: MISS (no suitable Font Awesome icon)`);
      continue;
    }

    const resolved = resolveEntry(entry);
    const { result, filledCells, voxelCount, maxDepthUsed } = seedNoun(noun, resolved);
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

    const profileLabel = depthProfileLabel(resolved.profile);
    console.log(
      `${noun} (${resolved.icon}): profile ${profileLabel}, ${filledCells} filled front cells, ` +
        `${voxelCount} voxels, max depth ${maxDepthUsed}`,
    );
    seeded += 1;
  }

  // --only runs skip misses.json entirely — misses are only meaningful for
  // a full run over SEED_TABLE.
  if (!ONLY) {
    writeFileSync(join(RUN_DIR, 'misses.json'), JSON.stringify(misses, null, 2) + '\n');
  }

  const label = ROUND2
    ? `${OUT_RUN_ID} 16³ · FA silhouette, two-level round2(${ROUND2.lo},${ROUND2.hi})`
    : `${OUT_RUN_ID.split('-')[0]} 16³ · FA silhouette, per-noun depth profile`;
  const pipeline = ROUND2
    ? 'noun-keyed library seed: Font Awesome 6 solid icon (hardcoded per-noun lookup table) → ' +
      '480px raster → ink-bbox-fit 16×16 front mask → per-noun depth profile, with every `round` ' +
      `entry overridden to the two-level round2(${ROUND2.lo},${ROUND2.hi}) variant ` +
      '(see scripts/lib/silhouette.ts) → strict lift. No model calls.'
    : 'noun-keyed library seed: Font Awesome 6 solid icon (hardcoded per-noun lookup table) → ' +
      '480px raster → ink-bbox-fit 16×16 front mask → per-noun depth profile ' +
      '(flat(d) | inflate | round(maxDepth) | prone(h), see scripts/lib/silhouette.ts) → strict lift. ' +
      'Nouns with no suitable icon are recorded in misses.json. No model calls.';

  const manifest: RunManifest = {
    id: OUT_RUN_ID,
    label,
    date: MANIFEST_DATE,
    pipeline,
    conditions: {
      grid: '16',
      encoding: 'char',
      model: 'none',
      source: 'font-awesome-6-solid (CC BY 4.0)',
      depth: ROUND2 ? `round2(${ROUND2.lo},${ROUND2.hi})` : 'per-noun profile',
    },
  };
  writeFileSync(join(RUN_DIR, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\nseeded ${seeded}/${NOUNS.length} nouns, ${misses.length} misses: ${misses.join(', ')}`);
}

main();
