// Deterministic mechanical validation of one mask response, emitting the
// feedback message a production two-call runtime would send back to the
// model for its single retry. Checks are purely structural — view presence,
// row count/width, character set, cross-view consistency, declared-vs-actual
// bounds, hollow interiors. No model calls, no judgment about whether the
// shape looks like its noun.
//
// Usage: npx tsx scripts/retry-feedback.ts runs/<run>/responses-call1/<noun>.txt [--size=16]
//                                           [--trust-front=<path>] [--max-depth=N]
//
// --trust-front=<path>  Path to a sourced (given, authoritative) front mask —
//                        either a plain <size>-row #/. mask file, or the
//                        multi-view masks/*.txt format (front/side/top
//                        labeled sections; only the front section is used).
//                        The response's front mask is compared cell-for-cell
//                        against it, and the front view's enclosed-hole
//                        check is skipped (sourced fronts may have
//                        intentional holes — an eye, a handle opening).
// --max-depth=N          Flags a side mask whose depth extent (max filled
//                        column - min filled column + 1) exceeds N cells.
//
// Prints "OK" when the response is mechanically clean (no retry needed);
// otherwise prints the full feedback message to send as the retry prompt.

import { readFileSync } from 'node:fs';
import { extractViews, parseMaskText, VIEWS, type Mask, type View } from '../src/bench/encodings.ts';
import { fillInterior, maskToRows } from '../src/bench/maskOps.ts';

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx scripts/retry-feedback.ts <response.txt> [--size=16] [--trust-front=<path>] [--max-depth=N]');
  process.exit(1);
}
let size = 16;
let trustFrontPath: string | undefined;
let maxDepth: number | undefined;
for (const a of process.argv.slice(3)) {
  if (a.startsWith('--size=')) size = Number(a.slice('--size='.length));
  else if (a.startsWith('--trust-front=')) trustFrontPath = a.slice('--trust-front='.length);
  else if (a.startsWith('--max-depth=')) maxDepth = Number(a.slice('--max-depth='.length));
}

/** Compact "3-9,12" rendering of a set of numbers. */
function fmtSet(nums: Iterable<number>): string {
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.length === 0) return '(none)';
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(',');
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

const filledRows = (m: Mask) =>
  new Set(m.map((row, r) => (row.some(Boolean) ? r : -1)).filter((r) => r >= 0));
const filledCols = (m: Mask) => {
  const out = new Set<number>();
  for (const row of m) row.forEach((cell, c) => cell && out.add(c));
  return out;
};

/**
 * Load a trusted front mask from either a plain <size>-row #/. mask file, or
 * the multi-view masks/*.txt format (front/side/top labeled sections
 * separated by blank lines, each label line followed by mask rows). Only the
 * front section is used in the latter case.
 */
function loadTrustFront(trustPath: string, expectedSize: number): Mask {
  const raw = readFileSync(trustPath, 'utf8');
  const allLines = raw.split('\n').map((l) => l.trim());
  const labelIdx = allLines.findIndex((l) => /^(front|side|top)$/i.test(l));
  let rows: string[];
  if (labelIdx === -1) {
    // Plain mask file: every non-blank line is a mask row.
    rows = allLines.filter((l) => l.length > 0);
  } else {
    // Multi-view format: take rows following the "front" label line, up to
    // the next blank line or next label line.
    const frontIdx = allLines.findIndex((l) => /^front$/i.test(l));
    if (frontIdx === -1) {
      throw new Error(`--trust-front file ${trustPath} has labeled sections but no "front" section`);
    }
    rows = [];
    for (let i = frontIdx + 1; i < allLines.length; i++) {
      const l = allLines[i];
      if (l.length === 0 || /^(front|side|top)$/i.test(l)) break;
      rows.push(l);
    }
  }
  return parseMaskText(rows.join('\n'), expectedSize, 'char').mask;
}

/** Inclusive [min, max] filled-column extent across all rows, or null if empty. */
function colExtent(m: Mask): [number, number] | null {
  const cols = filledCols(m);
  if (cols.size === 0) return null;
  return [Math.min(...cols), Math.max(...cols)];
}

const text = readFileSync(path, 'utf8');
const issues: string[] = [];
const views = extractViews(text);
const masks: Partial<Record<View, Mask>> = {};

for (const v of VIEWS) {
  const raw = views[v];
  if (raw === undefined) {
    issues.push(`the ${v} mask is missing — output a fenced code block labeled ${v}`);
    continue;
  }
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== size) {
    issues.push(`the ${v} mask has ${lines.length} rows — it must have exactly ${size} rows`);
  }
  const bad: number[] = [];
  lines.forEach((l, i) => {
    if (l.length !== size || /[^#.]/.test(l)) bad.push(i + 1);
  });
  if (bad.length > 0) {
    issues.push(
      `${v} mask row${bad.length > 1 ? 's' : ''} ${fmtSet(bad)}: every row must be exactly ` +
        `${size} characters, using only "#" and "." — count the characters in each row`,
    );
  }
  masks[v] = parseMaskText(raw, size, 'char').mask;
}

const { front, side, top } = masks;

const trustFront: Mask | undefined = trustFrontPath ? loadTrustFront(trustFrontPath, size) : undefined;

if (trustFront && front) {
  const mismatches: number[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (front[r]?.[c] !== trustFront[r]?.[c]) {
        mismatches.push(r + 1);
        break;
      }
    }
  }
  if (mismatches.length > 0) {
    issues.push(
      `the front silhouette was provided and must be reproduced exactly — front mask row${mismatches.length > 1 ? 's' : ''} ` +
        `${fmtSet(mismatches)} do not match the given front mask. Copy this exact front mask into your answer:\n` +
        '```\n' + maskToRows(trustFront).join('\n') + '\n```',
    );
  }
}

if (front && side && !sameSet(filledRows(front), filledRows(side))) {
  issues.push(
    `front and side masks disagree on which rows are filled (they share the object's height): ` +
      `front has rows ${fmtSet(filledRows(front))}, side has rows ${fmtSet(filledRows(side))} — make them identical`,
  );
}
if (front && top && !sameSet(filledCols(front), filledCols(top))) {
  issues.push(
    `front and top masks disagree on which columns are filled (they share the object's width): ` +
      `front has columns ${fmtSet(filledCols(front))}, top has columns ${fmtSet(filledCols(top))} — make them identical`,
  );
}
if (side && top) {
  const sideZ = filledCols(side);
  const topZ = new Set([...filledRows(top)].map((r) => size - 1 - r));
  if (!sameSet(sideZ, topZ)) {
    issues.push(
      `side mask columns and top mask rows disagree on the object's depth: side has depth cells ` +
        `${fmtSet(sideZ)}, top implies depth cells ${fmtSet(topZ)} — make them agree`,
    );
  }
}

const boundsMatch = text.match(/bounds\s+x:(\d+)-(\d+)\s+y:(\d+)-(\d+)\s+z:(\d+)-(\d+)/i);
if (!boundsMatch) {
  issues.push('the bounds line is missing or malformed — output "bounds x:<min>-<max> y:<min>-<max> z:<min>-<max>" before the masks');
} else if (front && side) {
  const [x0, x1, y0, y1, z0, z1] = boundsMatch.slice(1).map(Number);
  const fCols = filledCols(front);
  const fRows = filledRows(front);
  const sCols = filledCols(side);
  if (fCols.size > 0 && fRows.size > 0 && sCols.size > 0) {
    const ax0 = Math.min(...fCols);
    const ax1 = Math.max(...fCols);
    const ay0 = size - 1 - Math.max(...fRows);
    const ay1 = size - 1 - Math.min(...fRows);
    const az0 = Math.min(...sCols);
    const az1 = Math.max(...sCols);
    if (ax0 !== x0 || ax1 !== x1)
      issues.push(`declared bounds say x:${x0}-${x1} but the front mask occupies columns ${ax0}-${ax1} — make them agree`);
    if (ay0 !== y0 || ay1 !== y1)
      issues.push(`declared bounds say y:${y0}-${y1} but the front mask occupies y ${ay0}-${ay1} (y=0 is the bottom row) — make them agree`);
    if (az0 !== z0 || az1 !== z1)
      issues.push(`declared bounds say z:${z0}-${z1} but the side mask occupies depth ${az0}-${az1} — make them agree`);
  }
}

for (const v of VIEWS) {
  if (v === 'front' && trustFront) continue; // sourced fronts may have intentional holes
  const m = masks[v];
  if (!m) continue;
  const holes = fillInterior(m).filled;
  if (holes > 0) {
    issues.push(
      `the ${v} mask has ${holes} empty cell${holes > 1 ? 's' : ''} enclosed inside the silhouette — ` +
        `masks must be SOLID: fill every cell inside the outline with "#"`,
    );
  }
}

if (side && maxDepth !== undefined) {
  const extent = colExtent(side);
  if (extent) {
    const depth = extent[1] - extent[0] + 1;
    if (depth > maxDepth) {
      issues.push(
        `the object should be at most ${maxDepth} cells deep front-to-back, but the side mask currently ` +
          `spans ${depth} depth cells — redraw the side view as a depth cross-section, not a second profile of the object`,
      );
    }
  }
}

if (top) {
  const tRows = filledRows(top);
  const tCols = filledCols(top);
  if (tRows.size > 0 && tCols.size > 0) {
    const r0 = Math.min(...tRows);
    const r1 = Math.max(...tRows);
    const c0 = Math.min(...tCols);
    const c1 = Math.max(...tCols);
    const bboxHeight = r1 - r0 + 1;
    const bboxWidth = c1 - c0 + 1;
    let filled = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (top[r]?.[c]) filled += 1;
      }
    }
    const fillRatio = filled / (bboxWidth * bboxHeight);
    if (fillRatio >= 0.9 && bboxWidth >= 12 && bboxHeight >= 5) {
      issues.push(
        `the top view is a near-solid full-width rectangle — unless the object is genuinely box-shaped, ` +
          `its footprint should taper and round: carve the corners so the top view matches the object's true footprint`,
      );
    }
  }
}

if (issues.length === 0) {
  console.log('OK');
} else {
  console.log(`Your masks have mechanical errors:

${issues.map((i) => `- ${i}`).join('\n')}

Fix every error and re-emit your COMPLETE corrected answer in exactly the
original format: the bounds line, then exactly three fenced code blocks
labeled front, side, top. No other text.`);
}
