// Mask repair operations that sit between parsing (encodings.ts) and lifting
// (hull.ts): fillInterior turns outline silhouettes into solid ones, and
// bbox alignment reconciles views whose occupied extents disagree along a
// shared axis before intersection/voting runs. Axis mapping matches
// hull.ts/encodings.ts exactly:
//   front[r][c] — r = size-1-y, c = x
//   side[r][c]  — r = size-1-y, c = z
//   top[r][c]   — r = size-1-z, c = x
// Shared axes: x (front cols <-> top cols), y (front rows <-> side rows),
// z (side cols <-> top rows, top's row index runs size-1-z).

import type { Mask } from './encodings.ts';
import { liftByVote, type HullResult } from './hull.ts';

export type FillResult = { mask: Mask; filled: number };

/**
 * Flood fill from the border over empty cells; any empty cell unreachable
 * from the border is enclosed by the silhouette and gets filled. Turns a
 * hollow outline into a solid disc without touching cells already set.
 */
export function fillInterior(mask: Mask): FillResult {
  const rows = mask.length;
  const cols = rows > 0 ? mask[0].length : 0;
  const reached: boolean[][] = mask.map((r) => r.map(() => false));
  const stack: [number, number][] = [];

  const pushIfBorderEmpty = (r: number, c: number) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (mask[r][c] || reached[r][c]) return;
    reached[r][c] = true;
    stack.push([r, c]);
  };

  for (let c = 0; c < cols; c++) {
    pushIfBorderEmpty(0, c);
    pushIfBorderEmpty(rows - 1, c);
  }
  for (let r = 0; r < rows; r++) {
    pushIfBorderEmpty(r, 0);
    pushIfBorderEmpty(r, cols - 1);
  }

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    pushIfBorderEmpty(r - 1, c);
    pushIfBorderEmpty(r + 1, c);
    pushIfBorderEmpty(r, c - 1);
    pushIfBorderEmpty(r, c + 1);
  }

  let filled = 0;
  const out: Mask = mask.map((row, r) =>
    row.map((v, c) => {
      if (v) return true;
      if (reached[r][c]) return false;
      filled += 1;
      return true;
    }),
  );
  return { mask: out, filled };
}

/** Inclusive [min, max] occupied index range, or null if the mask is empty. */
function occupiedRange(count: number, isSet: (i: number) => boolean): [number, number] | null {
  let min = -1;
  let max = -1;
  for (let i = 0; i < count; i++) {
    if (isSet(i)) {
      if (min === -1) min = i;
      max = i;
    }
  }
  return min === -1 ? null : [min, max];
}

/** Nearest-neighbor resample of a 1D boolean line from srcRange onto dstRange. */
function resampleLine(
  line: boolean[],
  srcRange: [number, number],
  dstRange: [number, number],
): boolean[] {
  const size = line.length;
  const out = new Array<boolean>(size).fill(false);
  const [s0, s1] = srcRange;
  const [d0, d1] = dstRange;
  const srcSpan = s1 - s0;
  const dstSpan = d1 - d0;
  for (let d = d0; d <= d1; d++) {
    const t = dstSpan === 0 ? 0 : (d - d0) / dstSpan;
    const s = Math.round(s0 + t * srcSpan);
    out[d] = line[Math.max(0, Math.min(size - 1, s))];
  }
  return out;
}

export type AxisAlign = 'x' | 'y' | 'z';
export type ViewName = 'front' | 'side' | 'top';

export type AlignInfo = {
  /** Per view, per axis it participates in: true if that view was remapped. */
  remapped: Record<ViewName, Partial<Record<AxisAlign, boolean>>>;
};

/**
 * Compute the occupied range of `view` along `axis`, in axis-native index
 * space (x/y increase normally; z increases normally too — the flip for
 * top's row index is undone here so ranges from side and top are
 * comparable).
 */
function axisRange(mask: Mask, view: ViewName, axis: AxisAlign, size: number): [number, number] | null {
  if (view === 'front' && axis === 'x') {
    return occupiedRange(size, (x) => mask.some((row) => row[x]));
  }
  if (view === 'front' && axis === 'y') {
    // row r = size-1-y -> y = size-1-r
    return occupiedRange(size, (y) => mask[size - 1 - y].some((v) => v));
  }
  if (view === 'side' && axis === 'y') {
    return occupiedRange(size, (y) => mask[size - 1 - y].some((v) => v));
  }
  if (view === 'side' && axis === 'z') {
    return occupiedRange(size, (z) => mask.some((row) => row[z]));
  }
  if (view === 'top' && axis === 'x') {
    return occupiedRange(size, (x) => mask.some((row) => row[x]));
  }
  if (view === 'top' && axis === 'z') {
    // row r = size-1-z -> z = size-1-r
    return occupiedRange(size, (z) => mask[size - 1 - z].some((v) => v));
  }
  return null;
}

/** Resample `mask` along `axis` so its occupied range maps onto `target`. */
function resampleAxis(
  mask: Mask,
  view: ViewName,
  axis: AxisAlign,
  size: number,
  src: [number, number],
  target: [number, number],
): Mask {
  if (src[0] === target[0] && src[1] === target[1]) return mask;

  if (view === 'front' && axis === 'x') {
    // columns hold x directly
    return mask.map((row) => resampleLine(row, src, target));
  }
  if ((view === 'front' || view === 'side') && axis === 'y') {
    // rows hold y as r = size-1-y: flip range into row space, resample columns of rows
    const toRow = (yr: [number, number]): [number, number] => [size - 1 - yr[1], size - 1 - yr[0]];
    const rowSrc = toRow(src);
    const rowDst = toRow(target);
    const cols = mask[0]?.length ?? 0;
    const out: Mask = Array.from({ length: size }, () => new Array<boolean>(cols).fill(false));
    for (let c = 0; c < cols; c++) {
      const col = mask.map((row) => row[c]);
      const resampled = resampleLine(col, rowSrc, rowDst);
      for (let r = 0; r < size; r++) out[r][c] = resampled[r];
    }
    return out;
  }
  if (view === 'side' && axis === 'z') {
    return mask.map((row) => resampleLine(row, src, target));
  }
  if (view === 'top' && axis === 'x') {
    return mask.map((row) => resampleLine(row, src, target));
  }
  if (view === 'top' && axis === 'z') {
    const toRow = (zr: [number, number]): [number, number] => [size - 1 - zr[1], size - 1 - zr[0]];
    const rowSrc = toRow(src);
    const rowDst = toRow(target);
    const cols = mask[0]?.length ?? 0;
    const out: Mask = Array.from({ length: size }, () => new Array<boolean>(cols).fill(false));
    for (let c = 0; c < cols; c++) {
      const col = mask.map((row) => row[c]);
      const resampled = resampleLine(col, rowSrc, rowDst);
      for (let r = 0; r < size; r++) out[r][c] = resampled[r];
    }
    return out;
  }
  return mask;
}

export type AlignedMasks = { front: Mask; side: Mask; top: Mask; info: AlignInfo };

/**
 * Align occupied bounding boxes across the three views along each shared
 * axis. A view whose mask is empty along an axis is left untouched (no
 * range to remap onto or from).
 */
export function alignBboxes(front: Mask, side: Mask, top: Mask, size: number): AlignedMasks {
  let f = front;
  let s = side;
  let t = top;
  const remapped: AlignInfo['remapped'] = { front: {}, side: {}, top: {} };

  const axes: { axis: AxisAlign; views: [ViewName, ViewName] }[] = [
    { axis: 'x', views: ['front', 'top'] },
    { axis: 'y', views: ['front', 'side'] },
    { axis: 'z', views: ['side', 'top'] },
  ];

  for (const { axis, views } of axes) {
    const [vA, vB] = views;
    // Re-fetch current mask state (may have been remapped by a prior axis).
    const currentA = vA === 'front' ? f : vA === 'side' ? s : t;
    const currentB = vB === 'front' ? f : vB === 'side' ? s : t;
    const rangeA = axisRange(currentA, vA, axis, size);
    const rangeB = axisRange(currentB, vB, axis, size);
    if (!rangeA || !rangeB) continue; // one view empty on this axis: leave both
    const target: [number, number] = [Math.min(rangeA[0], rangeB[0]), Math.max(rangeA[1], rangeB[1])];

    const applyTo = (view: ViewName, mask: Mask, range: [number, number]) => {
      if (range[0] === target[0] && range[1] === target[1]) return mask;
      remapped[view][axis] = true;
      return resampleAxis(mask, view, axis, size, range, target);
    };

    const newA = applyTo(vA, currentA, rangeA);
    const newB = applyTo(vB, currentB, rangeB);
    if (vA === 'front') f = newA; else if (vA === 'side') s = newA; else t = newA;
    if (vB === 'front') f = newB; else if (vB === 'side') s = newB; else t = newB;
  }

  return { front: f, side: s, top: t, info: { remapped } };
}

/**
 * 2-of-3 voxel vote: a voxel is on if at least two of the three views'
 * silhouettes cover its projection (vs. all 3 for strict liftHull).
 * Delegates to liftByVote (hull.ts) so projection/axis conventions can't
 * drift between the strict and voting paths.
 */
export function liftVote(front: Mask, side: Mask, top: Mask, size: number): HullResult {
  return liftByVote(front, side, top, size, 2);
}

export function maskToRows(mask: Mask): string[] {
  return mask.map((row) => row.map((v) => (v ? '#' : '.')).join(''));
}
