// Re-lift responses under three repair variants (fill/bbox/vote)
// and regenerate original strict-lift cells with meta.masks added.
//
// By default (no args), process sweep1-{16-char,8-char,16-rle} and write
// relift1-<slug>-<variant>/ dirs (slug = "16char", "8char", "16rle").
//
// With positional args, process those run dirs instead (e.g. probe1-16char-sonnet)
// and write <dir>-<variant>/ (e.g. probe1-16char-sonnet-bbox).
//
// --variants=<a,b> restricts which variants (fill/bbox/vote) to produce.
// Default: all three. Rejects unknown variants with non-zero exit.
//
// For each dir:
//   1. Re-parse responses/*.txt, re-run the ORIGINAL strict lift, assert
//      voxel set matches disk (adds meta.masks only).
//   2. Write variant run dirs with fill/bbox/vote applied.
//
// Usage: npx tsx scripts/relift.ts [<run-dir> ...] [--variants=<a,b>]

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extractViews, parseMaskText, VIEWS, type Encoding, type Mask } from '../src/bench/encodings.ts';
import { liftHull, type HullResult } from '../src/bench/hull.ts';
import { fillInterior, alignBboxes, liftVote, maskToRows, type AlignInfo } from '../src/bench/maskOps.ts';
import { estimateTokens } from '../src/bench/cost.ts';
import { NOUNS } from '../src/bench/nouns.ts';
import type { BenchResult, BenchMeta, RunManifest, Vec3 } from '../src/bench/types.ts';

const RUNS_DIR = join(import.meta.dirname, '..', 'runs');

const DEFAULT_CELLS: { dir: string; slug: string }[] = [
  { dir: 'sweep1-16-char', slug: '16char' },
  { dir: 'sweep1-8-char', slug: '8char' },
  { dir: 'sweep1-16-rle', slug: '16rle' },
];

const ALL_VARIANTS = ['fill', 'bbox', 'vote'] as const;
type Variant = typeof ALL_VARIANTS[number];

// Parse CLI args: positional run dirs and --variants flag.
const args = process.argv.slice(2);
let requestedDirs: string[] = [];
let requestedVariants: Variant[] = [...ALL_VARIANTS];

for (const arg of args) {
  if (arg.startsWith('--variants=')) {
    const varStr = arg.slice('--variants='.length);
    const vars = varStr.split(',').map((v) => v.trim()) as Variant[];
    for (const v of vars) {
      if (!ALL_VARIANTS.includes(v)) {
        console.error(`unknown variant: ${v} (must be one of ${ALL_VARIANTS.join(', ')})`);
        process.exit(1);
      }
    }
    requestedVariants = vars;
  } else if (!arg.startsWith('--')) {
    requestedDirs.push(arg);
  }
}

const CELLS = requestedDirs.length > 0
  ? requestedDirs.map((dir) => ({ dir, slug: '' })) // slug unused for arg-supplied dirs
  : DEFAULT_CELLS;

const VARIANTS = requestedVariants;

const voxelKey = (v: Vec3) => v.join(',');
function sameVoxelSet(a: Vec3[], b: Vec3[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a.map(voxelKey));
  for (const v of b) if (!sa.has(voxelKey(v))) return false;
  return true;
}

type ParsedNoun = {
  slug: string;
  noun: string;
  masks: [Mask, Mask, Mask]; // post-repair, pre-fill, in front/side/top order
  malformedRows: number;
  promptText: string;
  responseText: string;
};

function parseCell(dir: string, size: number, encoding: Encoding): ParsedNoun[] {
  const responsesDir = join(RUNS_DIR, dir, 'responses');
  const files = readdirSync(responsesDir).filter((f) => f.endsWith('.txt'));
  const out: ParsedNoun[] = [];
  for (const file of files) {
    const slug = basename(file, '.txt');
    const noun = NOUNS.find((n) => n.noun.replace(/\s+/g, '-') === slug)?.noun ?? slug;
    const responseText = readFileSync(join(responsesDir, file), 'utf8');
    const promptPath = join(RUNS_DIR, dir, 'prompts', `${slug}.md`);
    const promptText = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';
    const views = extractViews(responseText);
    const missing = VIEWS.filter((v) => views[v] === undefined);
    if (missing.length > 0) {
      // Same shape as convert-response.ts: empty masks, still emitted.
      const empty: Mask = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
      out.push({ slug, noun, masks: [empty, empty, empty], malformedRows: 0, promptText, responseText });
      continue;
    }
    const parsed = VIEWS.map((v) => parseMaskText(views[v]!, size, encoding));
    out.push({
      slug,
      noun,
      masks: [parsed[0].mask, parsed[1].mask, parsed[2].mask],
      malformedRows: parsed.reduce((s, p) => s + p.malformedRows, 0),
      promptText,
      responseText,
    });
  }
  return out;
}

function buildMeta(
  base: { model?: string; encoding: string; tokensIn: number; tokensOut: number },
  malformedRows: number,
  hull: HullResult,
  variant: string,
  filledCells?: { front: number; side: number; top: number },
  alignment?: AlignInfo['remapped'],
  masks?: { front: string[]; side: string[]; top: string[] },
): BenchMeta {
  return {
    model: base.model,
    encoding: base.encoding,
    tokensIn: base.tokensIn,
    tokensOut: base.tokensOut,
    hull: {
      malformedRows,
      reprojectionLoss: hull.reprojectionLoss,
      variant,
      ...(filledCells ? { filledCells } : {}),
      ...(alignment ? { alignment } : {}),
    },
    ...(masks ? { masks } : {}),
  };
}

let totalAssertOk = 0;
const cellVariantStats: {
  cell: string;
  variant: string;
  meanVoxels: number;
  meanLoss: number;
  totalFilled: number;
}[] = [];

for (const cellEntry of CELLS) {
  const dir = cellEntry.dir;
  const slug = cellEntry.slug || dir; // use dir as fallback if slug is empty (arg-supplied mode)
  const runDir = join(RUNS_DIR, dir);
  const manifest = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as RunManifest;
  const size = Number(manifest.conditions?.grid);
  const encoding = manifest.conditions?.encoding as Encoding;
  const model = manifest.conditions?.model;
  if (!Number.isInteger(size) || (encoding !== 'char' && encoding !== 'rle')) {
    console.error(`bad run.json conditions in ${dir}`);
    process.exit(1);
  }

  const parsedNouns = parseCell(dir, size, encoding);

  // --- Step 1: regenerate the original cell in place, assert unchanged voxels.
  for (const p of parsedNouns) {
    const existingPath = join(runDir, `${p.slug}.json`);
    if (!existsSync(existingPath)) continue; // shouldn't happen for these cells
    const existing = JSON.parse(readFileSync(existingPath, 'utf8')) as BenchResult;

    const [front, side, top] = p.masks;
    const hull = liftHull(front, side, top, size);
    if (!sameVoxelSet(hull.voxels, existing.voxels)) {
      console.error(
        `ASSERTION FAILED: ${dir}/${p.slug} — regenerated voxel set differs from disk ` +
          `(disk=${existing.voxels.length}, regenerated=${hull.voxels.length}). Stopping without overwriting.`,
      );
      process.exit(1);
    }
    totalAssertOk += 1;

    const masks = {
      front: maskToRows(front),
      side: maskToRows(side),
      top: maskToRows(top),
    };
    const meta = buildMeta(
      { model, encoding, tokensIn: estimateTokens(p.promptText), tokensOut: estimateTokens(p.responseText) },
      p.malformedRows,
      hull,
      'strict',
      undefined,
      undefined,
      masks,
    );
    const result: BenchResult = {
      noun: p.noun,
      size,
      voxels: hull.voxels,
      meta: { ...meta, ...(existing.meta?.notes ? { notes: existing.meta.notes } : {}) },
    };
    writeFileSync(existingPath, JSON.stringify(result));
  }

  // --- Step 2: write the variant run dirs.
  for (const variant of VARIANTS) {
    const isArgSupplied = requestedDirs.length > 0;
    const outId = isArgSupplied ? `${dir}-${variant}` : `relift1-${slug}-${variant}`;
    const outDir = join(RUNS_DIR, outId);
    mkdirSync(outDir, { recursive: true });

    let sumVoxels = 0;
    let sumLoss = 0;
    let lossCount = 0;
    let totalFilled = 0;

    for (const p of parsedNouns) {
      const [rawFront, rawSide, rawTop] = p.masks;
      const fFront = fillInterior(rawFront);
      const fSide = fillInterior(rawSide);
      const fTop = fillInterior(rawTop);
      const filledCells = { front: fFront.filled, side: fSide.filled, top: fTop.filled };
      totalFilled += fFront.filled + fSide.filled + fTop.filled;

      let front = fFront.mask;
      let side = fSide.mask;
      let top = fTop.mask;
      let alignment: AlignInfo['remapped'] | undefined;

      if (variant === 'bbox' || variant === 'vote') {
        const aligned = alignBboxes(front, side, top, size);
        front = aligned.front;
        side = aligned.side;
        top = aligned.top;
        alignment = aligned.info.remapped;
      }

      const hull: HullResult = variant === 'vote' ? liftVote(front, side, top, size) : liftHull(front, side, top, size);

      const masks = {
        front: maskToRows(rawFront),
        side: maskToRows(rawSide),
        top: maskToRows(rawTop),
      };
      const meta = buildMeta(
        { model, encoding, tokensIn: estimateTokens(p.promptText), tokensOut: estimateTokens(p.responseText) },
        p.malformedRows,
        hull,
        variant,
        filledCells,
        alignment,
        masks,
      );
      const result: BenchResult = { noun: p.noun, size, voxels: hull.voxels, meta };
      writeFileSync(join(outDir, `${p.slug}.json`), JSON.stringify(result));

      sumVoxels += hull.voxels.length;
      sumLoss += Math.max(hull.reprojectionLoss.front, hull.reprojectionLoss.side, hull.reprojectionLoss.top);
      lossCount += 1;
    }

    const outManifest: RunManifest = {
      id: outId,
      label: `relift1 ${slug} · ${variant}`,
      date: '2026-07-04',
      pipeline: `relift: ${variant} repair + ${variant === 'vote' ? '2-of-3 vote' : 'strict intersection'} lift`,
      conditions: { ...manifest.conditions, sourceCell: dir, variant },
    };
    writeFileSync(join(outDir, 'run.json'), JSON.stringify(outManifest, null, 2));

    cellVariantStats.push({
      cell: dir,
      variant,
      meanVoxels: sumVoxels / parsedNouns.length,
      meanLoss: sumLoss / lossCount,
      totalFilled,
    });
  }

  console.log(`${dir}: ${parsedNouns.length} nouns regenerated + 3 variants written`);
}

console.log(`\nin-place regeneration: ${totalAssertOk} nouns matched disk exactly, 0 mismatches`);
console.log('\ncell / variant / mean voxels / mean max-loss / total filled cells');
for (const s of cellVariantStats) {
  console.log(
    `${s.cell.padEnd(16)} ${s.variant.padEnd(6)} ${s.meanVoxels.toFixed(1).padStart(8)} ${s.meanLoss.toFixed(3).padStart(8)} ${String(s.totalFilled).padStart(8)}`,
  );
}
