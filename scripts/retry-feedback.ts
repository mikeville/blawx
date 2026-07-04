// Deterministic mechanical validation of one mask response, emitting the
// feedback message a production two-call runtime would send back to the
// model for its single retry. Checks are purely structural — view presence,
// row count/width, character set, cross-view consistency, declared-vs-actual
// bounds, hollow interiors. No model calls, no judgment about whether the
// shape looks like its noun.
//
// Usage: npx tsx scripts/retry-feedback.ts runs/<run>/responses-call1/<noun>.txt [--size=16]
//
// Prints "OK" when the response is mechanically clean (no retry needed);
// otherwise prints the full feedback message to send as the retry prompt.

import { readFileSync } from 'node:fs';
import { extractViews, parseMaskText, VIEWS, type Mask, type View } from '../src/bench/encodings.ts';
import { fillInterior } from '../src/bench/maskOps.ts';

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx scripts/retry-feedback.ts <response.txt> [--size=16]');
  process.exit(1);
}
let size = 16;
for (const a of process.argv.slice(3)) {
  if (a.startsWith('--size=')) size = Number(a.slice('--size='.length));
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

if (issues.length === 0) {
  console.log('OK');
} else {
  console.log(`Your masks have mechanical errors:

${issues.map((i) => `- ${i}`).join('\n')}

Fix every error and re-emit your COMPLETE corrected answer in exactly the
original format: the bounds line, then exactly three fenced code blocks
labeled front, side, top. No other text.`);
}
