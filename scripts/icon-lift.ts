// Offline experiment: do professionally drawn 2D silhouette icons survive
// downsampling to a 16×16 voxel front mask? No model/API calls anywhere —
// this pipeline is pure rasterize-and-threshold. Font Awesome Free solid
// SVGs (CC BY 4.0) are rasterized, their ink bounding box is fit onto a
// 16×16 grid (coverage-thresholded per cell), and a deterministic depth-4
// extrusion synthesizes side/top masks that are cross-view consistent by
// construction (so the strict hull lift has zero reprojection loss).
//
// This isolates "can a downsampled 2D silhouette read as a recognizable
// front mask at 16×16" from "can a model draw a good three-view silhouette"
// — a lower bound / sanity check for the model-emission sweeps elsewhere
// in runs/.
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

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { liftHull } from '../src/bench/hull.ts';
import { maskToRows } from '../src/bench/maskOps.ts';
import type { Mask } from '../src/bench/encodings.ts';
import type { BenchResult, RunManifest } from '../src/bench/types.ts';

const SIZE = 16;
const RASTER_WIDTH = 480;
const DEFAULT_THRESHOLD = 0.35;
const FALLBACK_THRESHOLD = 0.25;
const MIN_FILLED_CELLS = 20;
// Depth-4 body, centered: z 6..9 (matches the hand-authored exemplar
// convention in scripts/exemplars.ts).
const DEPTH_Z_MIN = 6;
const DEPTH_Z_MAX = 9;

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

type PixelBox = { minX: number; minY: number; maxX: number; maxY: number };

function isInk(pixels: Buffer, w: number, x: number, y: number): boolean {
  const i = (y * w + x) * 4;
  return pixels[i + 3] > 127; // alpha channel
}

/** Tight bounding box (inclusive) of all ink pixels, or null if none found. */
function inkBBox(pixels: Buffer, width: number, height: number): PixelBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk(pixels, width, x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Map the ink bbox onto a 16×16 grid, aspect-ratio preserved, centered on
 * the shorter axis. A cell is filled if the fraction of ink pixels within
 * its corresponding pixel rectangle is >= threshold.
 */
function bboxToFrontMask(
  pixels: Buffer,
  width: number,
  bbox: PixelBox,
  threshold: number,
): Mask {
  const boxW = bbox.maxX - bbox.minX + 1;
  const boxH = bbox.maxY - bbox.minY + 1;
  const side = Math.max(boxW, boxH);
  // Cell size in pixel space, uniform on both axes (aspect-ratio preserved).
  const cellPx = side / SIZE;
  // Center the shorter axis: pad so the box sits in the middle of the
  // SIZE x SIZE square measured in `side`-scaled pixel space.
  const padX = (side - boxW) / 2;
  const padY = (side - boxH) / 2;
  // Pixel-space origin of the grid (may be negative-padded outside bbox,
  // which is fine — those cells simply have no ink).
  const originX = bbox.minX - padX;
  const originY = bbox.minY - padY;

  const mask: Mask = [];
  for (let r = 0; r < SIZE; r++) {
    const row: boolean[] = [];
    const py0 = originY + r * cellPx;
    const py1 = originY + (r + 1) * cellPx;
    for (let c = 0; c < SIZE; c++) {
      const px0 = originX + c * cellPx;
      const px1 = originX + (c + 1) * cellPx;
      row.push(cellInkCoverage(pixels, width, px0, px1, py0, py1) >= threshold);
    }
    mask.push(row);
  }
  return mask;
}

/** Fraction of ink pixels within pixel rectangle [px0,px1) x [py0,py1). */
function cellInkCoverage(
  pixels: Buffer,
  width: number,
  px0: number,
  px1: number,
  py0: number,
  py1: number,
): number {
  const x0 = Math.max(0, Math.floor(px0));
  const x1 = Math.min(width - 1, Math.ceil(px1) - 1);
  const y0 = Math.max(0, Math.floor(py0));
  const y1 = Math.min(width - 1, Math.ceil(py1) - 1);
  if (x1 < x0 || y1 < y0) return 0;
  let total = 0;
  let ink = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      total += 1;
      if (isInk(pixels, width, x, y)) ink += 1;
    }
  }
  return total === 0 ? 0 : ink / total;
}

function countFilled(mask: Mask): number {
  let n = 0;
  for (const row of mask) for (const v of row) if (v) n++;
  return n;
}

/** Shift mask rows down so the lowest filled row lands on row SIZE-1. */
function groundMask(mask: Mask): Mask {
  let lowestFilled = -1;
  for (let r = 0; r < SIZE; r++) {
    if (mask[r].some((v) => v)) lowestFilled = r;
  }
  if (lowestFilled === -1) return mask; // empty mask, nothing to ground
  const shift = SIZE - 1 - lowestFilled;
  if (shift === 0) return mask;
  const empty = () => new Array<boolean>(SIZE).fill(false);
  const out: Mask = Array.from({ length: SIZE }, empty);
  for (let r = 0; r < SIZE; r++) {
    const dr = r + shift;
    if (dr >= 0 && dr < SIZE) out[dr] = mask[r];
  }
  return out;
}

/**
 * Synthesize side/top masks from the front mask via a deterministic
 * depth-4 centered extrusion (z 6..9). Cross-view consistent by
 * construction:
 *   - side[r][c]: for every row with any front fill, columns 6..9 filled.
 *   - top[r][c]: rows 6..9 (z = 15-row), each a copy of front's per-column
 *     occupancy (column c filled iff front has any fill in column c).
 */
function synthesizeSideTop(front: Mask): { side: Mask; top: Mask } {
  const empty = () => new Array<boolean>(SIZE).fill(false);
  const side: Mask = Array.from({ length: SIZE }, empty);
  const top: Mask = Array.from({ length: SIZE }, empty);

  for (let r = 0; r < SIZE; r++) {
    const rowHasFill = front[r].some((v) => v);
    if (!rowHasFill) continue;
    for (let z = DEPTH_Z_MIN; z <= DEPTH_Z_MAX; z++) {
      side[r][z] = true;
    }
  }

  const colOccupied: boolean[] = new Array(SIZE).fill(false);
  for (let c = 0; c < SIZE; c++) {
    colOccupied[c] = front.some((row) => row[c]);
  }
  for (let z = DEPTH_Z_MIN; z <= DEPTH_Z_MAX; z++) {
    const topRow = SIZE - 1 - z;
    for (let c = 0; c < SIZE; c++) {
      top[topRow][c] = colOccupied[c];
    }
  }

  return { side, top };
}

/**
 * Per-row depth for inflation mode: d(r) = clamp(2*round(3*w(r)/16), 2, 6),
 * where w(r) is the number of filled cells in front mask row r. Always even,
 * in [2, 6]. Rows with w(r) = 0 get no depth (handled by the caller — an
 * empty front row stays empty in side/top).
 */
function inflateDepth(w: number): number {
  const d = 2 * Math.round((3 * w) / SIZE);
  return Math.max(2, Math.min(6, d));
}

/**
 * Synthesize side/top masks from the front mask via per-row inflation: each
 * filled front row r gets depth d(r) = clamp(2*round(3*w(r)/16), 2, 6) (w(r)
 * = row's filled cell count), realized as a centered run of d(r) cells on
 * the z axis: columns 8 - d(r)/2 .. 7 + d(r)/2 inclusive. Cross-view
 * consistent by construction:
 *   - side[r][z]: filled iff z falls in row r's centered depth run.
 *   - top[r][c] (r = 15-z): filled iff some front row has front[r][c] set
 *     and z within that row's depth run.
 */
function synthesizeSideTopInflate(front: Mask): {
  side: Mask;
  top: Mask;
  rowDepths: number[];
} {
  const empty = () => new Array<boolean>(SIZE).fill(false);
  const side: Mask = Array.from({ length: SIZE }, empty);
  const top: Mask = Array.from({ length: SIZE }, empty);
  const rowDepths: number[] = new Array(SIZE).fill(0);

  for (let r = 0; r < SIZE; r++) {
    const w = front[r].filter((v) => v).length;
    if (w === 0) continue; // empty row stays empty in side/top
    const d = inflateDepth(w);
    rowDepths[r] = d;
    const zMin = 8 - d / 2;
    const zMax = 7 + d / 2;
    for (let z = zMin; z <= zMax; z++) {
      side[r][z] = true;
      const topRow = SIZE - 1 - z;
      for (let c = 0; c < SIZE; c++) {
        if (front[r][c]) top[topRow][c] = true;
      }
    }
  }

  return { side, top, rowDepths };
}

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
  const svg = readFileSync(svgPath, 'utf8');

  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: RASTER_WIDTH } }).render();
  const { pixels, width, height } = rendered;

  const bbox = inkBBox(pixels, width, height);
  if (!bbox) throw new Error(`${sourceIcon}: no ink pixels found in raster`);

  let threshold = DEFAULT_THRESHOLD;
  let front = groundMask(bboxToFrontMask(pixels, width, bbox, threshold));
  let filledCells = countFilled(front);

  let note: string | undefined;
  if (filledCells < MIN_FILLED_CELLS) {
    threshold = FALLBACK_THRESHOLD;
    front = groundMask(bboxToFrontMask(pixels, width, bbox, threshold));
    filledCells = countFilled(front);
    note = `low coverage at threshold ${DEFAULT_THRESHOLD}; retried at ${FALLBACK_THRESHOLD}`;
  }

  let side: Mask;
  let top: Mask;
  let meanDepth: number | undefined;
  if (DEPTH_MODE === 'inflate') {
    const inflated = synthesizeSideTopInflate(front);
    side = inflated.side;
    top = inflated.top;
    const nonEmptyDepths = inflated.rowDepths.filter((d) => d > 0);
    meanDepth =
      nonEmptyDepths.length > 0
        ? nonEmptyDepths.reduce((sum, d) => sum + d, 0) / nonEmptyDepths.length
        : 0;
  } else {
    ({ side, top } = synthesizeSideTop(front));
  }

  const { voxels, reprojectionLoss } = liftHull(front, side, top, SIZE);
  if (reprojectionLoss.front !== 0 || reprojectionLoss.side !== 0 || reprojectionLoss.top !== 0) {
    throw new Error(
      `${sourceIcon}: nonzero reprojection loss (bug in extrusion) — ` +
        `front:${reprojectionLoss.front} side:${reprojectionLoss.side} top:${reprojectionLoss.top}`,
    );
  }

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

  return { noun, sourceIcon, thresholdUsed: threshold, result, meanDepth };
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
    const thresholdNote = thresholdUsed !== DEFAULT_THRESHOLD ? ` (threshold=${thresholdUsed})` : '';
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
