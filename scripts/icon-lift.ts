// Offline experiment: do professionally drawn 2D silhouette icons survive
// downsampling to a 16×16 voxel front mask? No model/API calls anywhere —
// this pipeline is pure rasterize-and-threshold. Font Awesome Free solid
// SVGs (CC BY 4.0) are rasterized, their ink bounding box is fit onto a
// 16×16 grid (coverage-thresholded per cell), and a deterministic depth
// extrusion synthesizes side/top masks that are cross-view consistent by
// construction (so the strict hull lift has zero reprojection loss).
//
// This isolates "can a downsampled 2D silhouette read as a recognizable
// front mask at 16×16" from "can a model draw a good three-view silhouette"
// — a lower bound / sanity check for the model-emission sweeps elsewhere
// in runs/.
//
// This is a thin CLI over scripts/lib/silhouette.ts, which holds the
// reusable rasterize/threshold/depth-profile core shared with
// scripts/seed-library.ts.
//
// Usage: npx tsx scripts/icon-lift.ts [--depth=flat|inflate] [--out=<run-id>]
//   Reads:  runs/icon1-16char-fa/sources/*.svg   (always — --out only changes
//           where output is written, never the source dir)
//   Writes: runs/<out>/<noun>.json       (BenchResult)
//           runs/<out>/masks/<noun>.txt   (mask(s), '#'/'.' rows)
//           runs/<out>/run.json           (RunManifest)
//
// --depth=flat (default): constant depth-4 extrusion, byte-identical to the
//   original icon1 pipeline.
// --depth=inflate: per-row depth derived from the front mask's fill width,
//   d(r) = clamp(2*round(3*w(r)/16), 2, 6), centered on the z axis. Produces
//   a silhouette that bulges where the front mask is wide and thins where
//   it's narrow, instead of a uniform slab.

import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { liftHull } from '../src/bench/hull.ts';
import { maskToRows } from '../src/bench/maskOps.ts';
import type { BenchResult, RunManifest } from '../src/bench/types.ts';
import {
  applyDepthProfile,
  rasterToFrontMask,
  readSvgFile,
  type DepthProfile,
} from './lib/silhouette.ts';

const SIZE = 16;

type DepthMode = 'flat' | 'inflate';

function parseArgs(argv: string[]): { depthMode: DepthMode; outRunId: string } {
  let depthMode: DepthMode = 'flat';
  let outRunId = 'icon1-16char-fa';
  for (const arg of argv) {
    if (arg.startsWith('--depth=')) {
      const v = arg.slice('--depth='.length);
      if (v !== 'flat' && v !== 'inflate') {
        throw new Error(`--depth must be 'flat' or 'inflate', got '${v}'`);
      }
      depthMode = v;
    } else if (arg.startsWith('--out=')) {
      outRunId = arg.slice('--out='.length);
    } else {
      throw new Error(`unrecognized argument: ${arg}`);
    }
  }
  return { depthMode, outRunId };
}

const { depthMode: DEPTH_MODE, outRunId: OUT_RUN_ID } = parseArgs(process.argv.slice(2));

// Source SVGs always live under icon1's sources dir — never duplicated per
// output run.
const SOURCE_RUN_DIR = join(import.meta.dirname, '..', 'runs', 'icon1-16char-fa');
const SOURCES_DIR = join(SOURCE_RUN_DIR, 'sources');

const RUN_DIR = join(import.meta.dirname, '..', 'runs', OUT_RUN_ID);
const MASKS_DIR = join(RUN_DIR, 'masks');

function nounFromFilename(filename: string): { noun: string; sourceIcon: string } {
  const base = basename(filename, '.svg');
  const noun = base === 'mug-saucer' ? 'mug' : base;
  return { noun, sourceIcon: base };
}

function processIcon(svgPath: string): {
  noun: string;
  sourceIcon: string;
  thresholdUsed: number;
  result: BenchResult;
  meanDepth?: number;
} {
  const { noun, sourceIcon } = nounFromFilename(svgPath);
  const svg = readSvgFile(svgPath);

  const { front: groundedFront, rawMask, thresholdUsed, note } = rasterToFrontMask(svg, sourceIcon);

  const profile: DepthProfile = DEPTH_MODE === 'inflate' ? { kind: 'inflate' } : { kind: 'flat', depth: 4 };
  const { front, side, top, meanDepth: profileMeanDepth } = applyDepthProfile(
    profile,
    groundedFront,
    rawMask,
    sourceIcon,
  );

  // applyDepthProfile already asserts zero reprojection loss; lift again
  // (same inputs, deterministic) to get the voxel payload.
  const { voxels } = liftHull(front, side, top, SIZE);

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
      ...(note ? { notes: note } : {}),
    },
  };

  return { noun, sourceIcon, thresholdUsed, result, meanDepth: profileMeanDepth };
}

function main(): void {
  if (!existsSync(SOURCES_DIR)) {
    throw new Error(`sources dir not found: ${SOURCES_DIR}`);
  }
  mkdirSync(MASKS_DIR, { recursive: true });

  const svgFiles = readdirSync(SOURCES_DIR)
    .filter((f) => f.endsWith('.svg'))
    .sort();

  if (svgFiles.length === 0) {
    throw new Error(`no .svg files found in ${SOURCES_DIR}`);
  }

  for (const file of svgFiles) {
    const svgPath = join(SOURCES_DIR, file);
    const { noun, sourceIcon, thresholdUsed, result, meanDepth } = processIcon(svgPath);

    writeFileSync(join(RUN_DIR, `${noun}.json`), JSON.stringify(result));

    const { front: frontRows, side: sideRows, top: topRows } = result.meta!.masks!;
    if (DEPTH_MODE === 'inflate') {
      const sections = [
        ['front', frontRows],
        ['side', sideRows],
        ['top', topRows],
      ] as const;
      const text = sections.map(([label, rows]) => `${label}\n${rows.join('\n')}`).join('\n\n') + '\n';
      writeFileSync(join(MASKS_DIR, `${noun}.txt`), text);
    } else {
      writeFileSync(join(MASKS_DIR, `${noun}.txt`), frontRows.join('\n') + '\n');
    }

    const filledCells = frontRows.reduce(
      (sum, row) => sum + [...row].filter((ch) => ch === '#').length,
      0,
    );
    const thresholdNote = thresholdUsed !== 0.35 ? ` (threshold=${thresholdUsed})` : '';
    const depthNote = DEPTH_MODE === 'inflate' ? `, mean depth ${meanDepth!.toFixed(2)}` : '';
    console.log(
      `${noun} (${sourceIcon}): ${filledCells} filled front cells, ${result.voxels.length} voxels${depthNote}${thresholdNote}`,
    );
  }

  const manifest: RunManifest =
    DEPTH_MODE === 'inflate'
      ? {
          id: OUT_RUN_ID,
          label: 'icon2 16³ · FA silhouette + inflation depth',
          date: '2026-07-04',
          pipeline:
            'icon downsample as icon1, but side/top synthesized by per-row inflation: ' +
            'd(r)=clamp(2·round(3·w(r)/16),2,6), side=centered run, top=union of per-row runs per column. ' +
            'No model calls.',
          conditions: {
            grid: '16',
            encoding: 'char',
            model: 'none',
            source: 'font-awesome-6-solid (CC BY 4.0)',
            depth: 'inflate',
          },
        }
      : {
          id: OUT_RUN_ID,
          label: 'icon1 16³ · FA silhouette downsample',
          date: '2026-07-04',
          pipeline:
            'icon downsample: Font Awesome solid SVG → 480px raster → ink-bbox-fit 16×16 front mask ' +
            '(coverage ≥ 0.35) → deterministic depth-4 extrusion side/top → strict lift. No model calls.',
          conditions: {
            grid: '16',
            encoding: 'char',
            model: 'none',
            source: 'font-awesome-6-solid (CC BY 4.0)',
          },
        };
  writeFileSync(join(RUN_DIR, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
}

main();
