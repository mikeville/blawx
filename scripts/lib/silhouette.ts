// Shared core for the icon-silhouette pipeline: SVG rasterize → ink bbox →
// bbox-fit 16×16 thresholded front mask → grounding → depth-profile side/top
// synthesis → strict-lift zero-reprojection-loss assertion. Node-only (fs,
// @resvg/resvg-js) — never imported from src/bench, which stays browser-safe.
//
// Depth profiles (all centered, even runs on the z axis — a depth-d run
// covers z = (8 - d/2) .. (7 + d/2)):
//   flat(d)    — every non-empty front row gets the centered d-run in side;
//                top rows for z in the run copy front's column occupancy.
//   inflate    — per-row depth from front-mask row width (icon2, unchanged).
//   round(max) — revolve approximation for round-in-top-view objects: chord
//                width per column from a circle fit to the column extent.
//   prone(h)   — the icon mask IS a top view (spider-like); object sits h
//                rows tall on the ground, front/side derived by transpose.

import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { liftHull } from '../../src/bench/hull.ts';
import type { Mask } from '../../src/bench/encodings.ts';

export const SIZE = 16;
export const RASTER_WIDTH = 480;
export const DEFAULT_THRESHOLD = 0.35;
export const FALLBACK_THRESHOLD = 0.25;
export const MIN_FILLED_CELLS = 20;
// Depth-4 body, centered: z 6..9 (matches the hand-authored exemplar
// convention in scripts/exemplars.ts).
export const DEPTH_Z_MIN = 6;
export const DEPTH_Z_MAX = 9;

export type PixelBox = { minX: number; minY: number; maxX: number; maxY: number };

export function isInk(pixels: Buffer, w: number, x: number, y: number): boolean {
  const i = (y * w + x) * 4;
  return pixels[i + 3] > 127; // alpha channel
}

/** Tight bounding box (inclusive) of all ink pixels, or null if none found. */
export function inkBBox(pixels: Buffer, width: number, height: number): PixelBox | null {
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
export function bboxToFrontMask(
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
export function cellInkCoverage(
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

export function emptyMask(): Mask {
  const empty = () => new Array<boolean>(SIZE).fill(false);
  return Array.from({ length: SIZE }, empty);
}

export function countFilled(mask: Mask): number {
  let n = 0;
  for (const row of mask) for (const v of row) if (v) n++;
  return n;
}

/** Shift mask rows down so the lowest filled row lands on row SIZE-1. */
export function groundMask(mask: Mask): Mask {
  let lowestFilled = -1;
  for (let r = 0; r < SIZE; r++) {
    if (mask[r].some((v) => v)) lowestFilled = r;
  }
  if (lowestFilled === -1) return mask; // empty mask, nothing to ground
  const shift = SIZE - 1 - lowestFilled;
  if (shift === 0) return mask;
  const out: Mask = emptyMask();
  for (let r = 0; r < SIZE; r++) {
    const dr = r + shift;
    if (dr >= 0 && dr < SIZE) out[dr] = mask[r];
  }
  return out;
}

/**
 * Synthesize side/top masks from the front mask via a deterministic
 * flat centered extrusion of depth `d` (even, z-run centered on 7.5):
 *   - side[r][c]: for every row with any front fill, the centered d-run
 *     of z columns is filled.
 *   - top[r][c]: rows in the centered d-run (r = 15-z), each a copy of
 *     front's per-column occupancy (column c filled iff front has any
 *     fill in column c).
 * depth-4 (d=4, z 6..9) matches the hand-authored exemplar convention and
 * is byte-identical to the original icon1 pipeline.
 */
export function synthesizeSideTopFlat(front: Mask, depth: number): { side: Mask; top: Mask } {
  if (depth % 2 !== 0 || depth < 2 || depth > SIZE) {
    throw new Error(`flat(depth): depth must be even and in [2, ${SIZE}], got ${depth}`);
  }
  const zMin = 8 - depth / 2;
  const zMax = 7 + depth / 2;
  const side: Mask = emptyMask();
  const top: Mask = emptyMask();

  for (let r = 0; r < SIZE; r++) {
    const rowHasFill = front[r].some((v) => v);
    if (!rowHasFill) continue;
    for (let z = zMin; z <= zMax; z++) {
      side[r][z] = true;
    }
  }

  const colOccupied: boolean[] = new Array(SIZE).fill(false);
  for (let c = 0; c < SIZE; c++) {
    colOccupied[c] = front.some((row) => row[c]);
  }
  for (let z = zMin; z <= zMax; z++) {
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
export function inflateDepth(w: number): number {
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
export function synthesizeSideTopInflate(front: Mask): {
  side: Mask;
  top: Mask;
  rowDepths: number[];
} {
  const side: Mask = emptyMask();
  const top: Mask = emptyMask();
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

/** Round depth `t` to nearest even integer, clamped to [2, maxDepth]. */
function clampEvenDepth(t: number, maxDepth: number): number {
  let d = 2 * Math.round(t / 2);
  d = Math.max(2, Math.min(maxDepth, d));
  return d;
}

/**
 * Revolve approximation for round-in-top-view objects (mug, rocket, tree):
 * fits a circle to the front mask's column extent and derives a per-column
 * chord depth, applied to both top (per-column z-run) and side (per-row
 * max-of-columns z-run). A repair pass re-derives side/top as projections
 * of the lifted hull so the strict lift has zero reprojection loss on all
 * three views (front survives untouched because every centered even run
 * >= 2 includes z in {7,8}).
 */
export function synthesizeSideTopRound(
  front: Mask,
  maxDepth: number,
): { side: Mask; top: Mask; colDepths: number[] } {
  if (maxDepth % 2 !== 0 || maxDepth < 2 || maxDepth > SIZE) {
    throw new Error(`round(maxDepth): maxDepth must be even and in [2, ${SIZE}], got ${maxDepth}`);
  }

  const colOccupied: boolean[] = new Array(SIZE).fill(false);
  for (let c = 0; c < SIZE; c++) {
    colOccupied[c] = front.some((row) => row[c]);
  }

  let c0 = -1;
  let c1 = -1;
  for (let c = 0; c < SIZE; c++) {
    if (colOccupied[c]) {
      if (c0 === -1) c0 = c;
      c1 = c;
    }
  }
  if (c0 === -1) {
    // Empty front mask: nothing to revolve.
    return { side: emptyMask(), top: emptyMask(), colDepths: new Array(SIZE).fill(0) };
  }

  const cx = (c0 + c1 + 1) / 2;
  const R = (c1 - c0 + 1) / 2;

  const colDepths: number[] = new Array(SIZE).fill(0);
  for (let c = 0; c < SIZE; c++) {
    if (!colOccupied[c]) continue;
    const dx = c + 0.5 - cx;
    const chord = 2 * Math.sqrt(Math.max(0, R * R - dx * dx));
    colDepths[c] = clampEvenDepth(chord, maxDepth);
  }

  // Top: for each filled column c, fill the top rows for the centered
  // z-run of t(c).
  const top: Mask = emptyMask();
  for (let c = 0; c < SIZE; c++) {
    const t = colDepths[c];
    if (t === 0) continue;
    const zMin = 8 - t / 2;
    const zMax = 7 + t / 2;
    for (let z = zMin; z <= zMax; z++) {
      top[SIZE - 1 - z][c] = true;
    }
  }

  // Side: for each non-empty front row r, d(r) = max of t(c) over columns
  // c filled in that row; fill the centered z-run.
  const side: Mask = emptyMask();
  for (let r = 0; r < SIZE; r++) {
    let d = 0;
    for (let c = 0; c < SIZE; c++) {
      if (front[r][c] && colDepths[c] > d) d = colDepths[c];
    }
    if (d === 0) continue;
    const zMin = 8 - d / 2;
    const zMax = 7 + d / 2;
    for (let z = zMin; z <= zMax; z++) {
      side[r][z] = true;
    }
  }

  // Repair pass: guarantee the strict-lift invariant by recomputing side
  // and top as projections of the lifted hull voxels.
  const { voxels } = liftHull(front, side, top, SIZE);
  const sideRepaired: Mask = emptyMask();
  const topRepaired: Mask = emptyMask();
  for (const [x, y, z] of voxels) {
    const fr = SIZE - 1 - y;
    const tr = SIZE - 1 - z;
    sideRepaired[fr][z] = true;
    topRepaired[tr][x] = true;
  }

  return { side: sideRepaired, top: topRepaired, colDepths };
}

/**
 * For objects whose icon silhouette is really a TOP view (spider): the
 * downsampled icon mask becomes the top mask directly (no grounding shift —
 * grounding is meaningless for a top view; the rasterizer's bbox centering
 * is kept as-is). Object height is h rows sitting on the ground
 * (rows 16-h .. 15):
 *   - front[r][c] for those rows = true iff the top mask has any fill in
 *     column c.
 *   - side[r][z] for those rows = true iff top mask row (15-z) has any
 *     fill.
 * Zero loss by construction — a transposed flat extrusion of the top view
 * across the h ground rows.
 */
export function synthesizeFrontSideProne(
  topMask: Mask,
  h: number,
): { front: Mask; side: Mask } {
  if (h < 1 || h > SIZE) {
    throw new Error(`prone(h): h must be in [1, ${SIZE}], got ${h}`);
  }
  const front: Mask = emptyMask();
  const side: Mask = emptyMask();

  const colOccupied: boolean[] = new Array(SIZE).fill(false);
  for (let c = 0; c < SIZE; c++) {
    colOccupied[c] = topMask.some((row) => row[c]);
  }
  // top row r = 15-z -> row-has-fill(z) = topMask[15-z] has any fill.
  const zHasFill: boolean[] = new Array(SIZE).fill(false);
  for (let z = 0; z < SIZE; z++) {
    zHasFill[z] = topMask[SIZE - 1 - z].some((v) => v);
  }

  for (let r = SIZE - h; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (colOccupied[c]) front[r][c] = true;
    }
    for (let z = 0; z < SIZE; z++) {
      if (zHasFill[z]) side[r][z] = true;
    }
  }

  return { front, side };
}

export type DepthProfile =
  | { kind: 'flat'; depth: number }
  | { kind: 'inflate' }
  | { kind: 'round'; maxDepth: number }
  | { kind: 'prone'; height: number };

export function depthProfileLabel(p: DepthProfile): string {
  switch (p.kind) {
    case 'flat':
      return `flat(${p.depth})`;
    case 'inflate':
      return 'inflate';
    case 'round':
      return `round(${p.maxDepth})`;
    case 'prone':
      return `prone(${p.height})`;
  }
}

export type RasterizedIcon = {
  pixels: Buffer;
  width: number;
  height: number;
};

/** Rasterize an SVG string at RASTER_WIDTH via @resvg/resvg-js. */
export function rasterizeSvg(svg: string): RasterizedIcon {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: RASTER_WIDTH } }).render();
  const { pixels, width, height } = rendered;
  return { pixels, width, height };
}

export function readSvgFile(path: string): string {
  return readFileSync(path, 'utf8');
}

export type FrontMaskResult = {
  front: Mask;
  thresholdUsed: number;
  filledCells: number;
  note?: string;
};

/**
 * Rasterize an SVG and produce the grounded, threshold-fit 16×16 front
 * mask, retrying at a lower threshold if coverage is too sparse. Shared by
 * both the flat/inflate icon-lift path and prone (which uses the mask
 * un-grounded as its top view — grounding is applied by the caller as
 * appropriate).
 */
export function rasterToFrontMask(svg: string, sourceLabel: string): FrontMaskResult & {
  rawMask: Mask;
} {
  const { pixels, width, height } = rasterizeSvg(svg);
  const bbox = inkBBox(pixels, width, height);
  if (!bbox) throw new Error(`${sourceLabel}: no ink pixels found in raster`);

  let threshold = DEFAULT_THRESHOLD;
  let rawMask = bboxToFrontMask(pixels, width, bbox, threshold);
  let front = groundMask(rawMask);
  let filledCells = countFilled(front);

  let note: string | undefined;
  if (filledCells < MIN_FILLED_CELLS) {
    threshold = FALLBACK_THRESHOLD;
    rawMask = bboxToFrontMask(pixels, width, bbox, threshold);
    front = groundMask(rawMask);
    filledCells = countFilled(front);
    note = `low coverage at threshold ${DEFAULT_THRESHOLD}; retried at ${FALLBACK_THRESHOLD}`;
  }

  return { front, rawMask, thresholdUsed: threshold, filledCells, note };
}

/**
 * Apply a depth profile to a front mask (flat/inflate/round), or reinterpret
 * the raw (ungrounded) mask as a top view (prone). Returns the resolved
 * front/side/top triple plus a diagnostic summary for logging, and asserts
 * the strict-lift zero-reprojection-loss invariant.
 */
export function applyDepthProfile(
  profile: DepthProfile,
  front: Mask,
  rawMask: Mask,
  sourceLabel: string,
): { front: Mask; side: Mask; top: Mask; maxDepthUsed: number; meanDepth?: number } {
  let resultFront = front;
  let side: Mask;
  let top: Mask;
  let maxDepthUsed: number;
  let meanDepth: number | undefined;

  if (profile.kind === 'flat') {
    ({ side, top } = synthesizeSideTopFlat(front, profile.depth));
    maxDepthUsed = profile.depth;
  } else if (profile.kind === 'inflate') {
    const inflated = synthesizeSideTopInflate(front);
    side = inflated.side;
    top = inflated.top;
    const nonEmptyDepths = inflated.rowDepths.filter((d) => d > 0);
    maxDepthUsed = Math.max(0, ...inflated.rowDepths);
    meanDepth =
      nonEmptyDepths.length > 0
        ? nonEmptyDepths.reduce((sum, d) => sum + d, 0) / nonEmptyDepths.length
        : 0;
  } else if (profile.kind === 'round') {
    const round = synthesizeSideTopRound(front, profile.maxDepth);
    side = round.side;
    top = round.top;
    maxDepthUsed = Math.max(0, ...round.colDepths);
  } else {
    // prone: rawMask (ungrounded, bbox-centered) becomes the top view.
    const prone = synthesizeFrontSideProne(rawMask, profile.height);
    resultFront = prone.front;
    side = prone.side;
    top = rawMask;
    maxDepthUsed = profile.height;
  }

  const { reprojectionLoss } = liftHull(resultFront, side, top, SIZE);
  if (reprojectionLoss.front !== 0 || reprojectionLoss.side !== 0 || reprojectionLoss.top !== 0) {
    throw new Error(
      `${sourceLabel}: nonzero reprojection loss (bug in extrusion) — ` +
        `front:${reprojectionLoss.front} side:${reprojectionLoss.side} top:${reprojectionLoss.top}`,
    );
  }

  return { front: resultFront, side, top, maxDepthUsed, meanDepth };
}
