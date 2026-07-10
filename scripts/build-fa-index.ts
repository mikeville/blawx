// Offline precompute pipeline: for every Font Awesome 6 Free solid icon,
// rasterize its SVG to the same grounded 16x16 front-silhouette mask the
// icon-seeding pipeline uses (scripts/lib/silhouette.ts's rasterToFrontMask),
// build a term -> icon lookup table from the icon's own name plus its FA
// metadata aliases and search terms, and write both as a single JSON blob
// consumed by the Cloudflare Worker at the edge (no filesystem, no runtime
// rasterization there). Pure local file processing — no network calls.
//
// Usage: npx tsx scripts/build-fa-index.ts
//
// Reads:
//   node_modules/@fortawesome/fontawesome-free/svgs/solid/*.svg
//     ~2000 solid-style icon SVGs; icon name = file stem.
//   node_modules/@fortawesome/fontawesome-free/metadata/icon-families.json
//     Per-icon metadata keyed by canonical icon name, each entry carrying
//     `aliases.names` (string alias names — FA6's icon-families.json never
//     puts numeric/unicode data in this array; those live under the
//     sibling `aliases.unicodes` object, which this script never reads)
//     and `search.terms` (free-text search terms). This JSON file has
//     everything the task needs, so icons.yml/categories.yml/shims.yml
//     (YAML, and no YAML dependency is added) are not consulted.
//     Note: ~579 of the ~2001 solid SVG files are legacy v4/v5 name shims
//     (e.g. "automobile.svg", byte-identical in content to "car.svg") whose
//     file stem does NOT appear as a top-level key in icon-families.json —
//     that key lives under the *canonical* icon's `aliases.names` instead
//     (e.g. "automobile" is an alias of "car"). Per the spec, every SVG
//     file is still indexed as its own icon (own mask, own name as a
//     lookup term); such a shim icon simply has no additional alias/search
//     terms of its own, since none of the metadata is attached to its file
//     stem as a key.
//
// Writes:
//   ../api/src/fa-index.json  { size, icons: { name -> 256-char mask }, lookup: { term -> name } }
//
// Also runs a built-in drift self-check against the shipped v1 masks in
// runs/seed4-16char-mixed/masks/*.txt for the FA-sourced nouns in that
// library (see FA_DRIFT_PAIRS below) and reports MATCH/DRIFT per noun.

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskToRows } from '../src/bench/maskOps.ts';
import { MIN_FILLED_CELLS, countFilled, rasterToFrontMask } from './lib/silhouette.ts';

const REPO_ROOT = join(import.meta.dirname, '..');
const FA_PKG_ROOT = join(REPO_ROOT, 'node_modules', '@fortawesome', 'fontawesome-free');
const SOLID_SVG_DIR = join(FA_PKG_ROOT, 'svgs', 'solid');
const ICON_FAMILIES_PATH = join(FA_PKG_ROOT, 'metadata', 'icon-families.json');
const OUT_PATH = join(REPO_ROOT, '..', 'api', 'src', 'fa-index.json');
const SIZE = 16;

// --- FA metadata shape (only the fields this script reads). ---
type IconFamilyEntry = {
  aliases?: { names?: string[] };
  search?: { terms?: string[] };
};
type IconFamilies = Record<string, IconFamilyEntry>;

/**
 * Normalize a raw candidate term: lowercase, trim, collapse internal
 * whitespace runs to a single hyphen, then strip any character outside
 * [a-z0-9-]. Returns null if the result is empty or purely numeric.
 */
function normalizeTerm(raw: string): string | null {
  let t = raw.toLowerCase().trim();
  t = t.replace(/\s+/g, '-');
  t = t.replace(/[^a-z0-9-]/g, '');
  if (t === '') return null;
  if (/^[0-9]+$/.test(t)) return null;
  return t;
}

type SkipReason = 'no-ink' | 'below-min-filled';

function buildIndex(): {
  icons: Record<string, string>;
  lookup: Record<string, string>;
  kept: number;
  skipped: number;
  skipsByReason: Record<SkipReason, number>;
} {
  const iconFamilies: IconFamilies = JSON.parse(readFileSync(ICON_FAMILIES_PATH, 'utf8'));
  const stems = readdirSync(SOLID_SVG_DIR)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4))
    .sort();

  const icons: Record<string, string> = {};
  const skipsByReason: Record<SkipReason, number> = { 'no-ink': 0, 'below-min-filled': 0 };

  for (const stem of stems) {
    const svgPath = join(SOLID_SVG_DIR, `${stem}.svg`);
    const svg = readFileSync(svgPath, 'utf8');
    let front;
    let filledCells;
    try {
      ({ front, filledCells } = rasterToFrontMask(svg, stem));
    } catch {
      skipsByReason['no-ink'] += 1;
      continue;
    }
    if (filledCells < MIN_FILLED_CELLS) {
      skipsByReason['below-min-filled'] += 1;
      continue;
    }
    // Sanity: countFilled(front) must agree with the result's own tally.
    if (countFilled(front) !== filledCells) {
      throw new Error(`${stem}: filledCells mismatch (bug in silhouette.ts contract)`);
    }
    icons[stem] = maskToRows(front).join('');
  }

  // term -> set of icon names that claim it (own name / alias / search term).
  const termClaims = new Map<string, Set<string>>();
  const claim = (term: string, iconName: string) => {
    const norm = normalizeTerm(term);
    if (norm === null) return;
    let set = termClaims.get(norm);
    if (!set) {
      set = new Set();
      termClaims.set(norm, set);
    }
    set.add(iconName);
  };

  for (const iconName of Object.keys(icons)) {
    claim(iconName, iconName);
    const entry = iconFamilies[iconName];
    if (!entry) continue; // legacy-name shim SVG; no metadata attached to this key
    for (const alias of entry.aliases?.names ?? []) claim(alias, iconName);
    for (const term of entry.search?.terms ?? []) claim(term, iconName);
  }

  const lookup: Record<string, string> = {};
  for (const [term, claimants] of termClaims) {
    const ownNameMatches = [...claimants].filter((name) => normalizeTerm(name) === term).sort();
    lookup[term] = ownNameMatches.length > 0 ? ownNameMatches[0] : [...claimants].sort()[0];
  }

  const kept = Object.keys(icons).length;
  const skipped = stems.length - kept;
  return { icons, lookup, kept, skipped, skipsByReason };
}

// --- Drift self-check against the shipped v1 library's front masks. ---
// icon name -> stem of runs/seed4-16char-mixed/masks/<stem>.txt. Spider is
// intentionally excluded: its stored front is a synthesized prone-profile
// view, not the icon mask (see scripts/seed-library.ts's spider entry).
const FA_DRIFT_PAIRS: [icon: string, maskStem: string][] = [
  ['mug-saucer', 'mug'],
  ['chair', 'chair'],
  ['house', 'house'],
  ['sailboat', 'sailboat'],
  ['car-side', 'car'],
  ['crow', 'bird'],
  ['fish', 'fish'],
  ['cat', 'cat'],
  ['frog', 'frog'],
  ['horse', 'horse'],
  ['dragon', 'dragon'],
  ['robot', 'robot'],
  ['heart', 'love'],
  ['ice-cream', 'ice-cream-cone'],
];

function readCanonicalFrontMask(maskStem: string): string {
  const path = join(REPO_ROOT, 'runs', 'seed4-16char-mixed', 'masks', `${maskStem}.txt`);
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const frontIdx = lines.indexOf('front');
  if (frontIdx === -1) throw new Error(`${maskStem}.txt: no "front" section found`);
  return lines.slice(frontIdx + 1, frontIdx + 1 + SIZE).join('');
}

function runDriftCheck(icons: Record<string, string>): void {
  console.log('\n--- Drift self-check vs runs/seed4-16char-mixed/masks/*.txt (front only) ---');
  for (const [icon, maskStem] of FA_DRIFT_PAIRS) {
    const generated = icons[icon];
    if (generated === undefined) {
      console.log(`${icon.padEnd(14)} -> ${maskStem.padEnd(16)} DRIFT (icon was skipped, no mask generated)`);
      continue;
    }
    const canonical = readCanonicalFrontMask(maskStem);
    const verdict = generated === canonical ? 'MATCH' : 'DRIFT';
    console.log(`${icon.padEnd(14)} -> ${maskStem.padEnd(16)} ${verdict}`);
  }
}

function printMask(icons: Record<string, string>, name: string): void {
  const encoded = icons[name];
  if (!encoded) {
    console.log(`(no mask for "${name}")`);
    return;
  }
  console.log(`\n--- ${name} ---`);
  for (let r = 0; r < SIZE; r++) {
    console.log(encoded.slice(r * SIZE, (r + 1) * SIZE));
  }
}

function main(): void {
  const { icons, lookup, kept, skipped, skipsByReason } = buildIndex();

  const output = {
    size: SIZE,
    icons: Object.fromEntries(Object.keys(icons).sort().map((k) => [k, icons[k]])),
    lookup: Object.fromEntries(Object.keys(lookup).sort().map((k) => [k, lookup[k]])),
  };
  const json = JSON.stringify(output);
  const jsonWithNewline = json + '\n';
  writeFileSync(OUT_PATH, jsonWithNewline);

  const rawBytes = Buffer.byteLength(jsonWithNewline, 'utf8');
  const gzipBytes = gzipSync(Buffer.from(jsonWithNewline, 'utf8')).length;

  console.log('--- fa-index build stats ---');
  console.log(`icons kept:      ${kept}`);
  console.log(`icons skipped:   ${skipped} (no-ink: ${skipsByReason['no-ink']}, below-min-filled: ${skipsByReason['below-min-filled']})`);
  console.log(`lookup entries:  ${Object.keys(lookup).length}`);
  console.log(`raw JSON bytes:  ${rawBytes}`);
  console.log(`gzipped bytes:   ${gzipBytes}`);
  console.log(`written to:      ${OUT_PATH}`);

  printMask(icons, 'cat');
  printMask(icons, 'house');

  runDriftCheck(icons);
}

main();
