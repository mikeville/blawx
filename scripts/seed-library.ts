// Offline library-seeding pipeline: for each noun in the 30-noun benchmark
// list (src/bench/nouns.ts), seed from either a hardcoded Font Awesome 6
// Free solid icon match or a Fable-picked FLUX.1 schnell silhouette PNG
// (runs/gen1-16char-flux/raw/*.png), then apply a per-category depth
// profile (see scripts/lib/silhouette.ts). No model/API calls anywhere —
// the PNGs were generated once by scripts/gen-silhouettes.ts and are read
// from disk. Nouns with no suitable source are recorded as MISSes for the
// next rung of the ladder (text-to-2D retry or LLM drawing).
//
// Usage: npx tsx scripts/seed-library.ts [flags]
//   --out=<runId>       output run id (default seed4-16char-mixed)
//   --round2=<lo>,<hi>  override every SEED_TABLE `round` entry with the
//                       two-level round2(lo,hi) profile (see silhouette.ts)
//   --only=round        process only nouns whose ORIGINAL profile kind is
//                       `round`; everything else is skipped silently (not
//                       recorded as a miss, and misses.json is not written)
//   --date=<YYYY-MM-DD> manifest date (default 2026-07-05)
//   Reads:  node_modules/@fortawesome/fontawesome-free/svgs/solid/<icon>.svg
//           <repo>/<png source path>, e.g. runs/gen1-16char-flux/raw/*.png
//   Writes: runs/<runId>/<noun>.json        (BenchResult)
//           runs/<runId>/masks/<noun>.txt    (front/side/top, icon2 format)
//           runs/<runId>/sources/<icon>.svg  (fa provenance copy, CC BY 4.0)
//           runs/<runId>/sources/<basename>.png (png provenance copy)
//           runs/<runId>/run.json            (RunManifest)
//           runs/<runId>/misses.json         (nouns with no source match;
//                                              omitted when --only is set)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { liftHull } from '../src/bench/hull.ts';
import { maskToRows } from '../src/bench/maskOps.ts';
import { NOUNS } from '../src/bench/nouns.ts';
import type { BenchResult, RunManifest } from '../src/bench/types.ts';
import {
  applyDepthProfile,
  decodePng,
  isInkDark,
  pixelsToFrontMask,
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

const OUT_RUN_ID = parseFlag('out') ?? 'seed4-16char-mixed';
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

// A seed source is either a Font Awesome 6 Free solid icon (rasterized
// from the vendored SVG) or a pre-generated FLUX.1 schnell silhouette PNG
// (path repo-relative, e.g. "runs/gen1-16char-flux/raw/table-c1.png").
type SeedSource = { kind: 'fa'; icon: string } | { kind: 'png'; path: string };
type SeedEntry = { source: SeedSource; profile: DepthProfile };

/**
 * Resolve a SEED_TABLE entry's effective profile for this run: when
 * --round2 is set, every entry whose ORIGINAL profile kind is `round` is
 * overridden with the two-level round2(lo,hi) profile. The literal
 * SEED_TABLE is never mutated — this is applied where entries are read.
 */
function resolveEntry(entry: SeedEntry): SeedEntry {
  if (ROUND2 && entry.profile.kind === 'round') {
    return { source: entry.source, profile: { kind: 'round2', lo: ROUND2.lo, hi: ROUND2.hi } };
  }
  return entry;
}

/** Shorthand for a Font Awesome solid-icon source. */
function fa(icon: string): SeedSource {
  return { kind: 'fa', icon };
}

/** Shorthand for a gen1 FLUX silhouette PNG source (path repo-relative). */
function png(path: string): SeedSource {
  return { kind: 'png', path: `runs/gen1-16char-flux/raw/${path}` };
}

// noun -> seed source (Font Awesome solid icon or gen1 FLUX PNG) -> depth
// profile. `null` means no suitable source exists for this noun (recorded
// as a miss). The five former `round` nouns (mug, hat, tree, ice cream
// cone, rocket ship) sit at flat(4): round(10) in seed1 and both round2
// level-sets in the seed2 A/B rendered as stepped blocks — any depth >= 6
// on these grid-filling silhouettes kills punch-through features and reads
// as a building. flat(4) is the settled treatment.
//
// seed4: 10 gen1 misses filled from Fable-eyeballed FLUX candidates
// (runs/gen1-16char-flux), plus 3 weak-FA nouns (hat, tree, rocket ship)
// upgraded to their gen1 winners at the same flat(4). Still misses:
// ladder (gen1 candidates' rungs are sub-cell-width — masks broke into
// disconnected pieces) and flower (petal head survives downsampling but
// the thin stem fragments; retry with a thicker-stem prompt).
const SEED_TABLE: Record<string, SeedEntry | null> = {
  mug: { source: fa('mug-saucer'), profile: { kind: 'flat', depth: 4 } },
  chair: { source: fa('chair'), profile: { kind: 'flat', depth: 4 } },
  house: { source: fa('house'), profile: { kind: 'flat', depth: 8 } },
  table: { source: png('table-c1.png'), profile: { kind: 'flat', depth: 6 } },
  sword: { source: png('sword-c4.png'), profile: { kind: 'flat', depth: 2 } },
  sailboat: { source: fa('sailboat'), profile: { kind: 'flat', depth: 2 } },
  lighthouse: { source: png('lighthouse-c4.png'), profile: { kind: 'flat', depth: 4 } },
  ladder: null, // gen1 candidates: rungs are sub-cell-width, masks broke into disconnected pieces
  car: { source: fa('car-side'), profile: { kind: 'flat', depth: 6 } },
  hat: { source: png('hat-c1.png'), profile: { kind: 'flat', depth: 4 } },
  fox: { source: png('fox-c2.png'), profile: { kind: 'inflate' } },
  bird: { source: fa('crow'), profile: { kind: 'inflate' } },
  fish: { source: fa('fish'), profile: { kind: 'inflate' } },
  flower: null, // petal head survives but the thin stem fragments — retry with a thicker-stem prompt
  tree: { source: png('tree-c2.png'), profile: { kind: 'flat', depth: 4 } },
  cat: { source: fa('cat'), profile: { kind: 'inflate' } },
  duck: { source: png('duck-c2.png'), profile: { kind: 'inflate' } },
  // mushroom-c2's tiered cap extrudes to stairs under any profile; c4's
  // rounder cap survives extrusion better (seed4 eyeball).
  mushroom: { source: png('mushroom-c4.png'), profile: { kind: 'flat', depth: 4 } },
  frog: { source: fa('frog'), profile: { kind: 'inflate' } },
  snail: { source: png('snail-c1.png'), profile: { kind: 'flat', depth: 4 } },
  horse: { source: fa('horse'), profile: { kind: 'inflate' } },
  penguin: { source: png('penguin-c4.png'), profile: { kind: 'inflate' } },
  octopus: { source: png('octopus-c1.png'), profile: { kind: 'inflate' } },
  dragon: { source: fa('dragon'), profile: { kind: 'inflate' } },
  robot: { source: fa('robot'), profile: { kind: 'flat', depth: 6 } },
  spider: { source: fa('spider'), profile: { kind: 'prone', height: 3 } },
  love: { source: fa('heart'), profile: { kind: 'inflate' } },
  'palm tree': { source: png('palm-tree-c1.png'), profile: { kind: 'flat', depth: 4 } },
  // gen1 candidates all read as popsicles (no cone taper); fa remains the placeholder.
  'ice cream cone': { source: fa('ice-cream'), profile: { kind: 'flat', depth: 4 } },
  'rocket ship': { source: png('rocket-ship-c1.png'), profile: { kind: 'flat', depth: 4 } },
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
  sourceLabel: string;
} {
  const { source } = entry;
  let groundedFront;
  let rawMask;
  let note: string | undefined;
  let sourceLabel: string;
  let sourceDescription: string;
  let model: string;

  if (source.kind === 'fa') {
    const svgPath = join(FA_SOLID_DIR, `${source.icon}.svg`);
    if (!existsSync(svgPath)) {
      throw new Error(`${noun}: icon file not found: ${svgPath}`);
    }
    const svg = readSvgFile(svgPath);
    ({ front: groundedFront, rawMask, note } = rasterToFrontMask(svg, `${noun} (${source.icon})`));
    sourceLabel = source.icon;
    sourceDescription = `Font Awesome 6 solid "${source.icon}"`;
    model = 'none-icon-downsample';

    // Copy the source SVG into this run's sources/ for provenance.
    mkdirSync(SOURCES_DIR, { recursive: true });
    copyFileSync(svgPath, join(SOURCES_DIR, `${source.icon}.svg`));
  } else {
    const pngPath = join(import.meta.dirname, '..', source.path);
    if (!existsSync(pngPath)) {
      throw new Error(`${noun}: png file not found: ${pngPath}`);
    }
    const pngBasename = basename(source.path);
    const { pixels, width, height } = decodePng(readFileSync(pngPath));
    ({ front: groundedFront, rawMask, note } = pixelsToFrontMask(
      pixels,
      width,
      height,
      `${noun} (${pngBasename})`,
      isInkDark,
    ));
    sourceLabel = pngBasename;
    sourceDescription = `FLUX.1 schnell generation "${pngBasename}" (runs/gen1-16char-flux)`;
    model = 'flux-schnell-downsample';

    // Copy the source PNG into this run's sources/ for provenance.
    mkdirSync(SOURCES_DIR, { recursive: true });
    copyFileSync(pngPath, join(SOURCES_DIR, pngBasename));
  }

  const { front, side, top, maxDepthUsed } = applyDepthProfile(
    entry.profile,
    groundedFront,
    rawMask,
    `${noun} (${sourceLabel})`,
  );

  const { voxels } = liftHull(front, side, top, SIZE);

  const profileLabel = depthProfileLabel(entry.profile);
  const result: BenchResult = {
    noun,
    size: SIZE,
    voxels,
    meta: {
      model,
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
        `seeded from ${sourceDescription}, depth profile ${profileLabel}` +
        (note ? `; ${note}` : ''),
    },
  };

  const filledCells = maskToRows(front).reduce(
    (sum, row) => sum + [...row].filter((ch) => ch === '#').length,
    0,
  );

  return { result, filledCells, voxelCount: voxels.length, maxDepthUsed, sourceLabel };
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
      console.log(`${noun}: MISS (no suitable source)`);
      continue;
    }

    const resolved = resolveEntry(entry);
    const { result, filledCells, voxelCount, maxDepthUsed, sourceLabel } = seedNoun(noun, resolved);
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
      `${noun} (${sourceLabel}): profile ${profileLabel}, ${filledCells} filled front cells, ` +
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
    ? `${OUT_RUN_ID} 16³ · FA + FLUX silhouette, two-level round2(${ROUND2.lo},${ROUND2.hi})`
    : `${OUT_RUN_ID.split('-')[0]} 16³ · FA + FLUX silhouette, per-noun depth profile`;
  const pipeline = ROUND2
    ? 'noun-keyed library seed: Font Awesome 6 solid icon or gen1 FLUX.1 schnell silhouette PNG ' +
      '(hardcoded per-noun lookup table, mixed sourcing) → 480px raster or decoded PNG → ' +
      'ink-bbox-fit 16×16 front mask → per-noun depth profile, with every `round` entry overridden ' +
      `to the two-level round2(${ROUND2.lo},${ROUND2.hi}) variant (see scripts/lib/silhouette.ts) → ` +
      'strict lift. No model calls (FLUX PNGs were generated once by scripts/gen-silhouettes.ts).'
    : 'noun-keyed library seed: Font Awesome 6 solid icon or gen1 FLUX.1 schnell silhouette PNG ' +
      '(hardcoded per-noun lookup table, mixed sourcing) → 480px raster or decoded PNG → ' +
      'ink-bbox-fit 16×16 front mask → per-noun depth profile ' +
      '(flat(d) | inflate | round(maxDepth) | prone(h), see scripts/lib/silhouette.ts) → strict lift. ' +
      'Nouns with no suitable source are recorded in misses.json. No model calls (FLUX PNGs were ' +
      'generated once by scripts/gen-silhouettes.ts).';

  const manifest: RunManifest = {
    id: OUT_RUN_ID,
    label,
    date: MANIFEST_DATE,
    pipeline,
    conditions: {
      grid: '16',
      encoding: 'char',
      model: 'none',
      source: 'font-awesome-6-solid (CC BY 4.0) + gen1 FLUX.1 schnell silhouettes (runs/gen1-16char-flux)',
      depth: ROUND2 ? `round2(${ROUND2.lo},${ROUND2.hi})` : 'per-noun profile',
    },
  };
  writeFileSync(join(RUN_DIR, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\nseeded ${seeded}/${NOUNS.length} nouns, ${misses.length} misses: ${misses.join(', ')}`);
}

main();
