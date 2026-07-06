// Rung-2b probe: instead of asking FLUX.1 schnell for a single flat
// silhouette per view (scripts/gen-silhouettes.ts), ask for one wide
// "orthographic model sheet" image containing FRONT / SIDE / TOP
// silhouettes side by side, split it into thirds, downsample each third to
// a 16×16 mask with the same pipeline as the icon path
// (scripts/lib/silhouette.ts), and lift the three into a voxel visual hull
// (src/bench/hull.ts strict 3-view AND-intersection). This tests whether a
// single generation call can emit cross-view-consistent silhouettes
// natively, as a more 3D-native alternative to the deterministic
// depth-profile extrusions (flat/inflate/round) used elsewhere in the repo.
// Provider is auto-selected at runtime from whichever API key is present —
// no model calls happen until a key is set and --dry-run is absent.
//
// Usage: npx tsx scripts/gen-sheets.ts [flags]
//   --out=<runId>       output run id (default gen2-16char-sheets)
//   --nouns=<list>       comma-separated filter (hyphenated stems, e.g.
//                        rocket-ship); default is all 4 nouns below
//   --candidates=N       seeds 1..N per (noun, variant) (default 4)
//   --variants=a,b       prompt variant filter (default both)
//   --dry-run            print provider, prompts, image count, cost
//                        estimate; exit 0 WITHOUT calling anything (works
//                        with no key)
//   --yes                required if planned image count > 80 (safety cap)
//   --skip-existing      candidates whose raw/<stem>.png already exists are
//                        re-processed from disk instead of regenerated
//   --date=<YYYY-MM-DD>  manifest date (default 2026-07-06)
//   --selftest           synthesize one sheet in-memory (no network, no
//                        key) and run the full processing path on it;
//                        exits nonzero if any invariant fails
//   Reads:  TOGETHER_API_KEY or REPLICATE_API_TOKEN (env or project .env)
//   Writes: runs/<runId>/raw/<stem>.png              generated sheet
//           runs/<runId>/thirds/<stem>-{front,side,top}.png  split thirds
//           runs/<runId>/masks/<stem>.txt             front/side/top masks
//           runs/<runId>/renders/<stem>-hull3.png      3-view hull render
//           runs/<runId>/renders/<stem>-hull2.png      2-view hull render
//           runs/<runId>/renders/<stem>-hull2at.png     aspect-true depth
//           runs/<runId>/renders/<stem>-hull2cap6.png   depth-capped (<=6)
//           runs/<runId>/renders/<stem>-flat4.png       flat(4) baseline
//           runs/<runId>/gen.json                       manifest

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import {
  decodePng,
  isInkDark,
  pixelsToFrontMask,
  emptyMask,
  countFilled,
  synthesizeSideTopFlat,
  SIZE,
} from './lib/silhouette.ts';
import { maskToRows, alignBboxes } from '../src/bench/maskOps.ts';
import { liftHull } from '../src/bench/hull.ts';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import type { Mask } from '../src/bench/encodings.ts';
import type { Vec3 } from '../src/bench/types.ts';

const RENDER_PX = 512;
const CONCURRENCY = 4;
const YES_THRESHOLD = 80;
const SHEET_W = 1344;
const SHEET_H = 576;

// --- CLI flags (process.argv.slice(2)) — see the usage comment above. ---
function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}
const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`);

const NOUNS_FILTER = parseFlag('nouns')?.split(',').map((s) => s.trim());
const CANDIDATES = Number(parseFlag('candidates') ?? '4');
const VARIANTS_FILTER = (parseFlag('variants')?.split(',').map((s) => s.trim()) ?? ['a', 'b']) as (
  | 'a'
  | 'b'
)[];
const DRY_RUN = hasFlag('dry-run');
const YES = hasFlag('yes');
const SKIP_EXISTING = hasFlag('skip-existing');
const MANIFEST_DATE = parseFlag('date') ?? '2026-07-06';
const SELFTEST = hasFlag('selftest');
const OUT_RUN_ID = parseFlag('out') ?? (SELFTEST ? 'sheet-selftest' : 'gen2-16char-sheets');

// --- Minimal .env loader: project-root .env, simple KEY=VALUE lines, no
// dotenv dep. Only sets vars not already present in process.env. ---
function loadDotEnv(): void {
  const envPath = join(import.meta.dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

// --- Noun table: subject text, per-view phrase, and which sheet third
// becomes the pipeline FRONT (the display silhouette). The other of
// front/side becomes the depth cross-section fed to the hull as `side`. ---
type NounSpec = { subject: string; displayThird: 'front' | 'side' };
const NOUN_TABLE: Record<string, NounSpec> = {
  duck: { subject: 'a duck standing', displayThird: 'side' },
  fox: { subject: 'a fox standing', displayThird: 'side' },
  mug: { subject: 'a coffee mug with a handle', displayThird: 'side' },
  'rocket ship': { subject: 'a rocket ship pointing straight up', displayThird: 'front' },
};

/** Filename stem: spaces become hyphens (matches make-prompts.ts's convention). */
function nounFileStem(noun: string): string {
  return noun.replace(/\s+/g, '-');
}

type Variant = 'a' | 'b';
function buildPrompt(spec: NounSpec, variant: Variant): string {
  const subject = spec.subject;
  return variant === 'a'
    ? `orthographic model sheet of ${subject}: three flat solid black silhouettes side by side on ` +
        `a pure white background, left to right: front view seen head-on, side profile view, top ` +
        `view seen from directly above, same scale, minimal flat icon style, no labels, no ` +
        `outlines, no shading, no text`
    : `three orthographic solid black silhouettes of ${subject} on pure white, arranged left to ` +
        `right: FRONT view, SIDE view, TOP-DOWN view, each silhouette centered in its third, same ` +
        `scale, no labels, no outlines, no shading, no text`;
}

// Resolve noun/variant selection for this run.
const allNouns = Object.keys(NOUN_TABLE);
const selectedNouns = NOUNS_FILTER
  ? allNouns.filter((n) => NOUNS_FILTER.includes(nounFileStem(n)))
  : allNouns;
const selectedVariants = (['a', 'b'] as const).filter((v) => VARIANTS_FILTER.includes(v));

type Candidate = { noun: string; variant: Variant; seed: number };
const candidates: Candidate[] = [];
for (const noun of selectedNouns) {
  for (const variant of selectedVariants) {
    for (let seed = 1; seed <= CANDIDATES; seed++) candidates.push({ noun, variant, seed });
  }
}

// --- Provider selection --------------------------------------------------
type Provider = 'together' | 'replicate' | 'none';

function selectProvider(): Provider {
  if (process.env.TOGETHER_API_KEY) return 'together';
  if (process.env.REPLICATE_API_TOKEN) return 'replicate';
  return 'none';
}

const PROVIDER = selectProvider();

// Together: 1344*576 px @ $0.0027/MP = 0.774144 MP * $0.0027 ≈ $0.00209/img.
// Replicate: flat $0.003/img.
const COST_PER_IMAGE: Record<Exclude<Provider, 'none'>, number> = {
  together: (SHEET_W * SHEET_H) / 1e6 * 0.0027,
  replicate: 0.003,
};

// --- Dry run --------------------------------------------------------------
if (DRY_RUN) {
  console.log(`provider: ${PROVIDER}`);
  if (PROVIDER === 'none') {
    console.log(
      'no API key found — set TOGETHER_API_KEY or REPLICATE_API_TOKEN in the environment ' +
        'or a project-root .env file to actually generate (dry-run only prints prompts/cost).',
    );
  }
  console.log(
    `nouns: ${selectedNouns.length}, variants: ${selectedVariants.join(',')}, ` +
      `candidates/(noun,variant): ${CANDIDATES}, total images: ${candidates.length}`,
  );
  console.log('');
  for (const noun of selectedNouns) {
    for (const variant of selectedVariants) {
      const stem = `${nounFileStem(noun)}-v${variant}`;
      console.log(`${stem}: "${buildPrompt(NOUN_TABLE[noun], variant)}"`);
    }
  }
  if (PROVIDER !== 'none') {
    const cost = candidates.length * COST_PER_IMAGE[PROVIDER];
    console.log(`\nestimated cost (${PROVIDER}): $${cost.toFixed(4)}`);
  } else {
    console.log(
      `\nestimated cost if together: $${(candidates.length * COST_PER_IMAGE.together).toFixed(4)}, ` +
        `if replicate: $${(candidates.length * COST_PER_IMAGE.replicate).toFixed(4)}`,
    );
  }
  process.exit(0);
}

// --- Guardrails past this point: real calls are possible (skipped entirely
// in --selftest, which never reaches main()). ---
if (!SELFTEST && PROVIDER === 'none') {
  console.error(
    'gen-sheets: no provider configured. Set TOGETHER_API_KEY or REPLICATE_API_TOKEN ' +
      '(env var or project-root .env) and re-run, or use --dry-run/--selftest to preview ' +
      'without a key.',
  );
  process.exit(1);
}
if (!SELFTEST && candidates.length > YES_THRESHOLD && !YES) {
  console.error(
    `gen-sheets: planned ${candidates.length} images exceeds the ${YES_THRESHOLD}-image ` +
      `safety cap. Re-run with --yes to confirm, or narrow --nouns/--candidates/--variants.`,
  );
  process.exit(1);
}

// --- Simple concurrency pool ----------------------------------------------
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runNext(): Promise<void> {
    const i = next++;
    if (i >= items.length) return;
    results[i] = await worker(items[i]);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Providers --------------------------------------------------------------
async function generateTogether(prompt: string, seed: number): Promise<Buffer> {
  const res = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'black-forest-labs/FLUX.1-schnell',
      prompt,
      width: SHEET_W,
      height: SHEET_H,
      steps: 4,
      n: 1,
      seed,
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) throw new Error(`together: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { b64_json: string }[] };
  const b64 = json.data[0]?.b64_json;
  if (!b64) throw new Error('together: no b64_json in response');
  return Buffer.from(b64, 'base64');
}

async function generateReplicate(prompt: string, seed: number): Promise<Buffer> {
  // Low-credit accounts are throttled to 60 predictions/min (burst 5), so a
  // concurrency-4 pool trips 429s; honor retry_after with a capped retry
  // loop (429s are rejected before prediction creation — no charge).
  let res: Response;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(
      'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({
          input: {
            prompt,
            seed,
            num_outputs: 1,
            aspect_ratio: '21:9',
            output_format: 'png',
            disable_safety_checker: false,
          },
        }),
      },
    );
    if (res.status !== 429 || attempt >= 8) break;
    const body = (await res.json()) as { retry_after?: number };
    await sleep(((body.retry_after ?? 6) + 1) * 1000);
  }
  if (!res.ok) throw new Error(`replicate: HTTP ${res.status} ${await res.text()}`);
  let prediction = (await res.json()) as {
    status: string;
    urls: { get: string };
    output: string | string[] | null;
  };

  // Prefer: wait usually resolves synchronously; poll if still processing
  // (1s intervals, capped at ~60s).
  const deadline = Date.now() + 60_000;
  while (
    (prediction.status === 'starting' || prediction.status === 'processing') &&
    Date.now() < deadline
  ) {
    await sleep(1000);
    const pollRes = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    });
    prediction = (await pollRes.json()) as typeof prediction;
  }
  if (prediction.status !== 'succeeded') {
    throw new Error(`replicate: prediction ended with status ${prediction.status}`);
  }

  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!url) throw new Error('replicate: no output URL in prediction');
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`replicate: HTTP ${imgRes.status} fetching output image`);
  return Buffer.from(await imgRes.arrayBuffer());
}

async function generate(prompt: string, seed: number): Promise<Buffer> {
  return PROVIDER === 'together' ? generateTogether(prompt, seed) : generateReplicate(prompt, seed);
}

// --- Sheet splitting -------------------------------------------------------
type DecodedImage = { pixels: Buffer; width: number; height: number };

/** Crop [x0, x0+w) x [0, height) out of a decoded RGBA image into its own buffer. */
function cropThird(img: DecodedImage, x0: number, w: number): DecodedImage {
  const out = Buffer.alloc(w * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    const srcStart = (y * img.width + x0) * 4;
    const dstStart = y * w * 4;
    img.pixels.copy(out, dstStart, srcStart, srcStart + w * 4);
  }
  return { pixels: out, width: w, height: img.height };
}

/** Split a decoded sheet into exact (as-equal-as-possible) vertical thirds. */
function splitThirds(img: DecodedImage): { front: DecodedImage; side: DecodedImage; top: DecodedImage } {
  const w0 = Math.floor(img.width / 3);
  const w1 = Math.floor((img.width * 2) / 3) - w0;
  const w2 = img.width - w0 - w1;
  return {
    front: cropThird(img, 0, w0),
    side: cropThird(img, w0, w1),
    top: cropThird(img, w0 + w1, w2),
  };
}

/** Encode a decoded RGBA image back to PNG bytes via pngjs. */
function encodePng(img: DecodedImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  img.pixels.copy(png.data);
  return PNG.sync.write(png);
}

// --- Compliance checks -------------------------------------------------------
/** Fraction of ink pixels in a vertical band [x0, x0+bandW) across full height. */
function bandInkFraction(img: DecodedImage, x0: number, bandW: number): number {
  let total = 0;
  let ink = 0;
  const xStart = Math.max(0, Math.floor(x0));
  const xEnd = Math.min(img.width, Math.ceil(x0 + bandW));
  for (let y = 0; y < img.height; y++) {
    for (let x = xStart; x < xEnd; x++) {
      total++;
      if (isInkDark(img.pixels, img.width, x, y)) ink++;
    }
  }
  return total === 0 ? 0 : ink / total;
}

/** Ink pixel bbox aspect ratio (w/h), or null if no ink. */
function inkAspect(img: DecodedImage): number | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (isInkDark(img.pixels, img.width, x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return h === 0 ? null : w / h;
}

/** 4-connected component count + largest-component fill fraction on a 16x16 mask. */
function connectedComponents(mask: Mask): { count: number; largestFraction: number } {
  const visited: boolean[][] = mask.map((row) => row.map(() => false));
  let filled = 0;
  let count = 0;
  let largest = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!mask[r][c]) continue;
      filled++;
      if (visited[r][c]) continue;
      count++;
      let size = 0;
      const stack: [number, number][] = [[r, c]];
      visited[r][c] = true;
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        size++;
        const neighbors: [number, number][] = [
          [cr - 1, cc],
          [cr + 1, cc],
          [cr, cc - 1],
          [cr, cc + 1],
        ];
        for (const [nr, nc] of neighbors) {
          if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
          if (!mask[nr][nc] || visited[nr][nc]) continue;
          visited[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
      if (size > largest) largest = size;
    }
  }
  return { count, largestFraction: filled === 0 ? 0 : largest / filled };
}

type ThirdCompliance = {
  empty: boolean;
  componentCount: number;
  largestComponentFraction: number;
  inkAspectRatio: number | null;
  flagFragmented: boolean;
};

type SheetCompliance = {
  gutter1InkFraction: number;
  gutter2InkFraction: number;
  flagGutter: boolean;
  front: ThirdCompliance;
  side: ThirdCompliance;
  top: ThirdCompliance;
  compliant: boolean;
};

function checkThird(mask: Mask | null): ThirdCompliance {
  if (mask === null) {
    return { empty: true, componentCount: 0, largestComponentFraction: 0, inkAspectRatio: null, flagFragmented: true };
  }
  const { count, largestFraction } = connectedComponents(mask);
  return {
    empty: false,
    componentCount: count,
    largestComponentFraction: largestFraction,
    inkAspectRatio: null, // filled in by caller with the pre-downsample ink bbox aspect
    flagFragmented: largestFraction < 0.7,
  };
}

// --- Mask flips (orientation search) ----------------------------------------
/** Mirror a mask's columns (z or x axis depending on caller's semantics). */
function mirrorCols(mask: Mask): Mask {
  return mask.map((row) => [...row].reverse());
}
/** Mirror a mask's rows. */
function mirrorRows(mask: Mask): Mask {
  return [...mask].reverse();
}

type OrientationResult = {
  front: Mask;
  side: Mask;
  top: Mask;
  voxels: Vec3[];
  loss: { front: number; side: number; top: number };
  summedLoss: number;
  flips: { sideZ: boolean; topZ: boolean; topX: boolean };
};

/**
 * Enumerate the 8 flip combinations the sheet gives no guarantee against
 * (side mirrored on z/columns, top mirrored on z/rows, top mirrored on
 * x/columns), lift each with liftHull, and return the combination with
 * minimum summed reprojection loss.
 */
function searchOrientation(front: Mask, sideBase: Mask, topBase: Mask): OrientationResult {
  let best: OrientationResult | null = null;
  for (const sideZ of [false, true]) {
    for (const topZ of [false, true]) {
      for (const topX of [false, true]) {
        const side = sideZ ? mirrorCols(sideBase) : sideBase;
        let top = topZ ? mirrorRows(topBase) : topBase;
        top = topX ? mirrorCols(top) : top;
        const { voxels, reprojectionLoss } = liftHull(front, side, top, SIZE);
        const summedLoss = reprojectionLoss.front + reprojectionLoss.side + reprojectionLoss.top;
        if (!best || summedLoss < best.summedLoss) {
          best = { front, side, top, voxels, loss: reprojectionLoss, summedLoss, flips: { sideZ, topZ, topX } };
        }
      }
    }
  }
  return best!;
}

// --- Front-protecting repair pass --------------------------------------------
type RepairResult = {
  front: Mask;
  side: Mask;
  top: Mask;
  voxels: Vec3[];
  frontCellsRestored: number;
  sideCellsAdded: number;
  topCellsAdded: number;
};

/**
 * The pipeline invariant is that the PIPELINE front mask is ground truth and
 * must survive with zero reprojection loss. For every front cell (fr, x)
 * filled but hit by no voxel after the orientation search's best lift,
 * choose z = the filled cell of side[fr][*] nearest to 7.5 (if that side row
 * is empty, use z=7 and set side[fr][7]=true), then set top[15-z][x]=true.
 * Re-lift, then recompute side/top as pure projections of the final voxel
 * set (mirrors synthesizeSideTopRound's repair idiom) so all three views
 * have zero loss, and assert the front invariant.
 */
function repairFrontProtecting(front: Mask, side0: Mask, top0: Mask): RepairResult {
  const side = side0.map((row) => [...row]);
  const top = top0.map((row) => [...row]);

  const { voxels: voxels0 } = liftHull(front, side, top, SIZE);
  const hitFront: boolean[][] = front.map((row) => row.map(() => false));
  for (const [x, y] of voxels0) {
    const fr = SIZE - 1 - y;
    hitFront[fr][x] = true;
  }

  let frontCellsRestored = 0;
  let sideCellsAdded = 0;
  let topCellsAdded = 0;
  for (let fr = 0; fr < SIZE; fr++) {
    for (let x = 0; x < SIZE; x++) {
      if (!front[fr][x] || hitFront[fr][x]) continue;
      // Find the filled z in side[fr][*] nearest to 7.5.
      let bestZ = -1;
      let bestDist = Infinity;
      for (let z = 0; z < SIZE; z++) {
        if (!side[fr][z]) continue;
        const dist = Math.abs(z - 7.5);
        if (dist < bestDist) {
          bestDist = dist;
          bestZ = z;
        }
      }
      if (bestZ === -1) {
        bestZ = 7;
        side[fr][7] = true;
        sideCellsAdded++;
      }
      const tr = SIZE - 1 - bestZ;
      if (!top[tr][x]) {
        top[tr][x] = true;
        topCellsAdded++;
      }
      frontCellsRestored++;
    }
  }

  // Re-lift, then recompute side/top as pure projections of the final
  // voxel set so all three views have zero loss by construction.
  const { voxels: voxels1 } = liftHull(front, side, top, SIZE);
  const sideFinal: Mask = emptyMask();
  const topFinal: Mask = emptyMask();
  for (const [x, y, z] of voxels1) {
    const fr = SIZE - 1 - y;
    const tr = SIZE - 1 - z;
    sideFinal[fr][z] = true;
    topFinal[tr][x] = true;
  }

  const { voxels: voxelsFinal, reprojectionLoss } = liftHull(front, sideFinal, topFinal, SIZE);
  if (reprojectionLoss.front !== 0) {
    throw new Error(
      `repairFrontProtecting: front still loses cells after repair (loss=${reprojectionLoss.front})`,
    );
  }

  return {
    front,
    side: sideFinal,
    top: topFinal,
    voxels: voxelsFinal,
    frontCellsRestored,
    sideCellsAdded,
    topCellsAdded,
  };
}

// --- 2-view hull (no repair; loss-free for front by construction as long as
// every front row's paired side row has some fill — if a front row's side
// row is empty, fill side[fr][7..8] first). ---
function liftHull2View(front: Mask, side0: Mask): Vec3[] {
  const side = side0.map((row) => [...row]);
  for (let fr = 0; fr < SIZE; fr++) {
    if (front[fr].some((v) => v) && !side[fr].some((v) => v)) {
      side[fr][7] = true;
      side[fr][8] = true;
    }
  }
  const voxels: Vec3[] = [];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const fr = SIZE - 1 - y;
      if (!front[fr][x]) continue;
      for (let z = 0; z < SIZE; z++) {
        if (side[fr][z]) voxels.push([x, y, z]);
      }
    }
  }
  return voxels;
}

// --- Aspect-true depth rescale ------------------------------------------------
// Max total depth for the capped 2-view hull — the seed2 lesson threshold.
const DEPTH_CAP = 6;

/** Number of rows spanned by any ink (occupied row extent), or 0 if empty. */
function occupiedRowSpan(mask: Mask): number {
  let lo = -1;
  let hi = -1;
  for (let r = 0; r < SIZE; r++) {
    if (mask[r].some((v) => v)) {
      if (lo === -1) lo = r;
      hi = r;
    }
  }
  return lo === -1 ? 0 : hi - lo + 1;
}

/**
 * Rescale a side mask's z axis (columns) by factor f about the center of its
 * occupied z range, nearest-neighbor inverse sampling. f=1 is identity; f<1
 * shrinks the depth extent. Rows left empty by extreme shrink are handled by
 * liftHull2View's centered-run fallback.
 */
/** Number of z columns spanned by any ink in a side mask, or 0 if empty. */
function occupiedZSpan(side: Mask): number {
  let z0 = -1;
  let z1 = -1;
  for (let z = 0; z < SIZE; z++) {
    if (side.some((row) => row[z])) {
      if (z0 === -1) z0 = z;
      z1 = z;
    }
  }
  return z0 === -1 ? 0 : z1 - z0 + 1;
}

function rescaleZ(side: Mask, f: number): Mask {
  let z0 = -1;
  let z1 = -1;
  for (let z = 0; z < SIZE; z++) {
    if (side.some((row) => row[z])) {
      if (z0 === -1) z0 = z;
      z1 = z;
    }
  }
  if (z0 === -1 || f === 1) return side;
  const zc = (z0 + z1) / 2;
  const out: Mask = emptyMask();
  for (let r = 0; r < SIZE; r++) {
    for (let z = 0; z < SIZE; z++) {
      const zs = Math.round(zc + (z - zc) / f);
      if (zs >= 0 && zs < SIZE && side[r][zs]) out[r][z] = true;
    }
  }
  return out;
}

// --- Render helpers ----------------------------------------------------------
function renderVoxelsPng(voxels: Vec3[]): Buffer {
  const svg = renderIsoSVG(voxels);
  return new Resvg(svg, { fitTo: { mode: 'width', value: RENDER_PX } }).render().asPng();
}

// --- Selftest synthetic sheet ------------------------------------------------
/**
 * Build a 1344x576 synthetic sheet in-memory: white background, three black
 * shapes across the thirds, constructed to be ADVERSARIALLY inconsistent by
 * design — not just "slightly offset" (alignBboxes reconciles simple extent
 * offsets away for free by stretching occupied ranges to their union, so a
 * placement offset alone never exercises repair or the orientation search).
 * The inconsistency here is SHAPE-level, so it survives alignment:
 *
 *   - side third (cross-section, fed as the hull's "side" input since
 *     displayThird='side' puts the pipeline FRONT on the sheet's SIDE
 *     third): a short, thin oval — its z-run only spans the middle band of
 *     rows after downsample. This targets the REPAIR invariant: only top
 *     rows in that middle z-band get consulted when voting on front cells.
 *   - front third (profile silhouette / pipeline "front"): a body blob plus
 *     a tail protrusion sticking out to the RIGHT (+x), confined to the
 *     same middle row band as the cross-section's z-run. This is the shape
 *     that must survive the strict lift with zero final loss.
 *   - top third: an annulus (outer ellipse with a concentric HOLE at least
 *     half the outer radii, sized to survive the 0.35 coverage threshold at
 *     16x16) matching the cross-section's short vertical extent, so its
 *     z-range lines up with the cross-section's without alignBboxes needing
 *     to stretch either — the hole is what breaks consistency, not a range
 *     mismatch. The hole blanks the top mask's middle columns at exactly
 *     the z-rows the tail needs, forcing `repairFrontProtecting` to restore
 *     those front cells (hole -> repair). A rectangular flange is welded
 *     onto the SAME (right, +x) edge as the tail, in the same row band.
 *     Note this is the opposite of the naive intuition (put the bump on
 *     the side OPPOSITE the tail so a mirror is needed to line them up) —
 *     empirically (verified by direct search over the 8 flip combinations)
 *     a flange on the tail's own side is what makes the UNFLIPPED
 *     orientation lose reprojection accuracy on the tail's front cells,
 *     while mirroring the top's columns (topX) swings the flange under the
 *     hole where it stops interfering, which is what minimizes summed
 *     reprojection loss. So the orientation search prefers topX: true (the
 *     flange-vs-hole interaction -> topX flip).
 */
function synthesizeSelftestSheet(): Buffer {
  const w = SHEET_W;
  const h = SHEET_H;
  const png = new PNG({ width: w, height: h });
  // Fill white opaque.
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255;
    png.data[i + 1] = 255;
    png.data[i + 2] = 255;
    png.data[i + 3] = 255;
  }
  const thirdW = w / 3;
  const setPixel = (x: number, y: number, value: 0 | 255 = 0) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = (y * w + x) * 4;
    png.data[idx] = value;
    png.data[idx + 1] = value;
    png.data[idx + 2] = value;
    png.data[idx + 3] = 255;
  };
  const fillEllipse = (cx: number, cy: number, rx: number, ry: number, value: 0 | 255 = 0) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) setPixel(x, y, value);
      }
    }
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number, value: 0 | 255 = 0) => {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) setPixel(x, y, value);
    }
  };

  // Row band (as a fraction of h) shared by the cross-section's z-run, the
  // tail, and the top annulus's hole/flange — this is what makes the
  // inconsistency line up on the axis that actually gets voted on.
  const bandRyFrac = 0.22;

  // Sheet FRONT third: cross-section fed as the hull's "side" input. A
  // short, thin oval (narrow rx, short ry) so its occupied z-range after
  // downsample is confined to the middle band of rows — only those top
  // rows get consulted for front-cell votes.
  const fCx = thirdW * 0.5;
  fillEllipse(fCx, h * 0.5, thirdW * 0.09, h * bandRyFrac);

  // Sheet SIDE third: profile silhouette (pipeline "front" mask, since
  // displayThird='side'). Body blob plus a tail protrusion sticking out to
  // the RIGHT (+x), confined to the same middle row band as the
  // cross-section above.
  const sCx = thirdW * 1.5;
  fillEllipse(sCx, h * 0.5, thirdW * 0.26, h * 0.26);
  fillEllipse(sCx + thirdW * 0.3, h * 0.5, thirdW * 0.12, h * 0.06); // tail, +x

  // Sheet TOP third: annulus (outer ellipse minus a concentric hole >=50%
  // of the outer radii) whose ry matches the cross-section's bandRyFrac so
  // its z-range lines up without alignBboxes stretching anything — the
  // hole is a SHAPE-level gap, not a placement offset. A flange is welded
  // onto the same (right, +x) edge as the tail, in the same row band.
  const tCx = thirdW * 2.5;
  const topRx = thirdW * 0.3;
  const topRy = h * bandRyFrac;
  const holeFrac = 0.65;
  fillEllipse(tCx, h * 0.5, topRx, topRy); // outer ellipse
  fillEllipse(tCx, h * 0.5, topRx * holeFrac, topRy * holeFrac, 255); // hole
  fillRect(tCx + topRx - 2, h * 0.5 - topRy * 0.35, tCx + topRx + 100, h * 0.5 + topRy * 0.35); // flange, +x

  return PNG.sync.write(png);
}

// --- Manifest types -----------------------------------------------------------
type ManifestEntry = {
  noun: string;
  variant: Variant;
  seed: number;
  prompt: string;
  ok: boolean;
  compliance?: SheetCompliance;
  orientation?: { flips: OrientationResult['flips']; lossBeforeRepair: OrientationResult['loss'] };
  repair?: { frontCellsRestored: number; sideCellsAdded: number; topCellsAdded: number };
  voxelCounts?: { hull3: number; hull2: number; hull2at: number; hull2cap6: number; flat4: number };
  hull2ZScale?: number;
  error?: string;
  note?: string;
};

// --- Per-sheet processing (shared by generation and --skip-existing reuse,
// and by --selftest). ---
type ProcessResult = {
  compliance: SheetCompliance;
  orientation: OrientationResult;
  repaired: RepairResult;
  hull2Voxels: Vec3[];
  hull2atVoxels: Vec3[];
  hull2cap6Voxels: Vec3[];
  hull2ZScale: number;
  flat4Voxels: Vec3[];
  frontMask: Mask;
};

function processSheet(png: Buffer, spec: NounSpec, label: string, dirs: { thirdsDir: string; stem: string }): ProcessResult {
  const decoded = decodePng(png);
  const full: DecodedImage = { pixels: decoded.pixels, width: decoded.width, height: decoded.height };
  const { front: frontImg, side: sideImg, top: topImg } = splitThirds(full);

  writeFileSync(join(dirs.thirdsDir, `${dirs.stem}-front.png`), encodePng(frontImg));
  writeFileSync(join(dirs.thirdsDir, `${dirs.stem}-side.png`), encodePng(sideImg));
  writeFileSync(join(dirs.thirdsDir, `${dirs.stem}-top.png`), encodePng(topImg));

  // Gutter check: ink fraction in two 2%-of-W-wide vertical bands centered
  // on the third boundaries x=W/3 and x=2W/3.
  const bandW = full.width * 0.02;
  const gutter1 = bandInkFraction(full, full.width / 3 - bandW / 2, bandW);
  const gutter2 = bandInkFraction(full, (full.width * 2) / 3 - bandW / 2, bandW);

  // Extract each third's mask (all via pixelsToFrontMask + isInkDark).
  // displayThird decides which of {frontImg, sideImg} maps to pipeline
  // front vs. the cross-section view fed as hull "side".
  const displayImg = spec.displayThird === 'side' ? sideImg : frontImg;
  const crossImg = spec.displayThird === 'side' ? frontImg : sideImg;

  const thirds: { key: 'front' | 'side' | 'top'; img: DecodedImage }[] = [
    { key: 'front', img: displayImg },
    { key: 'side', img: crossImg },
    { key: 'top', img: topImg },
  ];

  let pipelineFront: Mask | null = null;
  let crossMask: Mask | null = null;
  let topRawMask: Mask | null = null;
  const thirdCompliance: Record<'front' | 'side' | 'top', ThirdCompliance> = {
    front: checkThird(null),
    side: checkThird(null),
    top: checkThird(null),
  };

  for (const { key, img } of thirds) {
    const aspect = inkAspect(img);
    try {
      const { front: grounded, rawMask } = pixelsToFrontMask(
        img.pixels,
        img.width,
        img.height,
        `${label} ${key}`,
        isInkDark,
      );
      if (key === 'front') pipelineFront = grounded;
      else if (key === 'side') crossMask = grounded;
      else topRawMask = rawMask; // top uses the UNGROUNDED rawMask
      const useMaskForComponents = key === 'top' ? rawMask : grounded;
      const c = checkThird(useMaskForComponents);
      c.inkAspectRatio = aspect;
      thirdCompliance[key] = c;
    } catch {
      thirdCompliance[key] = checkThird(null);
    }
  }

  if (!pipelineFront || !crossMask || !topRawMask) {
    throw new Error(`${label}: one or more thirds had no extractable ink (front/side/top)`);
  }

  const compliance: SheetCompliance = {
    gutter1InkFraction: gutter1,
    gutter2InkFraction: gutter2,
    flagGutter: gutter1 > 0.02 || gutter2 > 0.02,
    front: thirdCompliance.front,
    side: thirdCompliance.side,
    top: thirdCompliance.top,
    compliant:
      gutter1 <= 0.02 &&
      gutter2 <= 0.02 &&
      !thirdCompliance.front.flagFragmented &&
      !thirdCompliance.side.flagFragmented &&
      !thirdCompliance.top.flagFragmented &&
      !thirdCompliance.front.empty &&
      !thirdCompliance.side.empty &&
      !thirdCompliance.top.empty,
  };

  // Cross-view extent reconciliation: alignBboxes fits directly — its three
  // axis pairs (x: front/top, y: front/side, z: side/top) are exactly the
  // reconciliation the spec asks for when "side" role = the cross-section
  // view: (a) cross-section's row range <-> front's row range (y), (b)
  // top's column range <-> front's column range (x), (c) top's row range
  // (z) <-> cross-section's column range (z).
  const aligned = alignBboxes(pipelineFront, crossMask, topRawMask, SIZE);

  // Orientation search over the 8 flip combinations.
  const orientation = searchOrientation(aligned.front, aligned.side, aligned.top);

  // Front-protecting repair pass.
  const repaired = repairFrontProtecting(orientation.front, orientation.side, orientation.top);

  // 2-view hull variant: front + cross-section only, top unconstrained —
  // and deliberately decoupled from the top third's alignment: gen2 eyeball
  // showed the third slot is rarely a real top view, and alignBboxes's z
  // pair stretches the cross-section's depth extent to match that garbage
  // view (duck body inflated to ~13 of 16 deep → pancake). An empty top
  // mask makes alignBboxes skip the x and z axis pairs, so only front/cross
  // rows are reconciled and the cross-section keeps its natural z extent.
  const aligned2 = alignBboxes(pipelineFront, crossMask, emptyMask(), SIZE);
  const hull2Voxels = liftHull2View(aligned2.front, aligned2.side);

  // Aspect-true depth variant: bbox-fit normalizes each third to fill its
  // own 16-cell square, erasing the sheet's RELATIVE scale between views —
  // a cross-section drawn at the same sheet scale as a longer display
  // silhouette comes out proportionally too deep. Rescale the
  // cross-section's z extent by the same factor its rows were mapped onto
  // the front's rows (front occupied row span / cross occupied row span),
  // restoring the sheet's own proportions. No rescue for sheets whose
  // "front" slot is really a second profile (factor ≈ 1 there).
  const frontRowSpan = occupiedRowSpan(pipelineFront);
  const crossRowSpan = occupiedRowSpan(crossMask);
  const hull2ZScale = crossRowSpan > 0 ? frontRowSpan / crossRowSpan : 1;
  const hull2atVoxels = liftHull2View(aligned2.front, rescaleZ(aligned2.side, hull2ZScale));

  // Depth-capped variant: the seed2 round-depth lesson (AGENTS.md) — total
  // depth >= 6 turns a 16-wide silhouette into a building and kills
  // punch-through features — applies to sheet-sourced cross-sections too
  // (gen2 eyeball: schnell draws fat head-on views, and wrong-view sheets
  // give a second profile whose depth = full length). Rescale the
  // cross-section so its total z extent is at most DEPTH_CAP, preserving
  // its per-row SHAPE (thin head / fat body / offset legs) at sane depth.
  const zExt = occupiedZSpan(aligned2.side);
  const capScale = zExt > DEPTH_CAP ? DEPTH_CAP / zExt : 1;
  const hull2cap6Voxels = liftHull2View(aligned2.front, rescaleZ(aligned2.side, capScale));

  // flat(4) baseline for eyeball A/B.
  const { side: flatSide, top: flatTop } = synthesizeSideTopFlat(pipelineFront, 4);
  const { voxels: flat4Voxels } = liftHull(pipelineFront, flatSide, flatTop, SIZE);

  return {
    compliance,
    orientation,
    repaired,
    hull2Voxels,
    hull2atVoxels,
    hull2cap6Voxels,
    hull2ZScale,
    flat4Voxels,
    frontMask: pipelineFront,
  };
}

// --- Selftest ---------------------------------------------------------------
function runSelftest(): void {
  const RUN_DIR = join(import.meta.dirname, '..', 'runs', OUT_RUN_ID);
  const RAW_DIR = join(RUN_DIR, 'raw');
  const THIRDS_DIR = join(RUN_DIR, 'thirds');
  const MASKS_DIR = join(RUN_DIR, 'masks');
  const RENDERS_DIR = join(RUN_DIR, 'renders');
  for (const dir of [RUN_DIR, RAW_DIR, THIRDS_DIR, MASKS_DIR, RENDERS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }

  const stem = 'selftest-c1';
  const png = synthesizeSelftestSheet();
  writeFileSync(join(RAW_DIR, `${stem}.png`), png);

  const spec: NounSpec = { subject: 'selftest shape', displayThird: 'side' };
  let result: ProcessResult;
  try {
    result = processSheet(png, spec, 'selftest', { thirdsDir: THIRDS_DIR, stem });
  } catch (err) {
    console.error(`selftest FAILED during processing: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const { compliance, orientation, repaired, hull2Voxels, hull2atVoxels, flat4Voxels, frontMask } = result;

  writeFileSync(
    join(MASKS_DIR, `${stem}.txt`),
    [
      ['front', maskToRows(repaired.front)],
      ['side', maskToRows(repaired.side)],
      ['top', maskToRows(repaired.top)],
    ]
      .map(([label, rows]) => `${label}\n${(rows as string[]).join('\n')}`)
      .join('\n\n') + '\n',
  );

  writeFileSync(join(RENDERS_DIR, `${stem}-hull3.png`), renderVoxelsPng(repaired.voxels));
  writeFileSync(join(RENDERS_DIR, `${stem}-hull2.png`), renderVoxelsPng(hull2Voxels));
  writeFileSync(join(RENDERS_DIR, `${stem}-flat4.png`), renderVoxelsPng(flat4Voxels));

  console.log('--- selftest summary ---');
  console.log(
    `compliance: gutter1=${compliance.gutter1InkFraction.toFixed(4)} gutter2=${compliance.gutter2InkFraction.toFixed(4)} ` +
      `flagGutter=${compliance.flagGutter} compliant=${compliance.compliant}`,
  );
  console.log(
    `  front: empty=${compliance.front.empty} components=${compliance.front.componentCount} ` +
      `largestFrac=${compliance.front.largestComponentFraction.toFixed(3)} aspect=${compliance.front.inkAspectRatio?.toFixed(3)}`,
  );
  console.log(
    `  side:  empty=${compliance.side.empty} components=${compliance.side.componentCount} ` +
      `largestFrac=${compliance.side.largestComponentFraction.toFixed(3)} aspect=${compliance.side.inkAspectRatio?.toFixed(3)}`,
  );
  console.log(
    `  top:   empty=${compliance.top.empty} components=${compliance.top.componentCount} ` +
      `largestFrac=${compliance.top.largestComponentFraction.toFixed(3)} aspect=${compliance.top.inkAspectRatio?.toFixed(3)}`,
  );
  console.log(`chosen flips: ${JSON.stringify(orientation.flips)}`);
  console.log(
    `pre-repair loss: front=${orientation.loss.front.toFixed(3)} side=${orientation.loss.side.toFixed(3)} ` +
      `top=${orientation.loss.top.toFixed(3)} (summed=${orientation.summedLoss.toFixed(3)})`,
  );
  console.log(
    `repair: frontCellsRestored=${repaired.frontCellsRestored} sideCellsAdded=${repaired.sideCellsAdded} ` +
      `topCellsAdded=${repaired.topCellsAdded}`,
  );
  console.log(
    `voxel counts: hull3=${repaired.voxels.length} hull2=${hull2Voxels.length} ` +
      `hull2at=${hull2atVoxels.length} flat4=${flat4Voxels.length}`,
  );

  // Invariant checks: front loss must be zero after repair, hull must be
  // non-empty, pipeline front mask itself must be non-empty. The sheet is
  // adversarially inconsistent by construction (see synthesizeSelftestSheet),
  // so this also asserts that the repair pass and the orientation search
  // were both actually exercised — a synthetic sheet that never triggers
  // either would let a bug in those paths slip through undetected until the
  // first paid FLUX run.
  const { reprojectionLoss: finalLoss } = liftHull(repaired.front, repaired.side, repaired.top, SIZE);
  let failed = false;
  if (finalLoss.front !== 0) {
    console.error(`INVARIANT FAILED: front reprojection loss nonzero after repair (${finalLoss.front})`);
    failed = true;
  }
  if (repaired.voxels.length === 0) {
    console.error('INVARIANT FAILED: repaired hull is empty');
    failed = true;
  }
  if (countFilled(frontMask) === 0) {
    console.error('INVARIANT FAILED: pipeline front mask is empty');
    failed = true;
  }
  if (hull2Voxels.length === 0) {
    console.error('INVARIANT FAILED: 2-view hull is empty');
    failed = true;
  }
  if (flat4Voxels.length === 0) {
    console.error('INVARIANT FAILED: flat4 baseline hull is empty');
    failed = true;
  }
  if (orientation.summedLoss <= 0) {
    console.error(
      `INVARIANT FAILED: pre-repair summed loss is not positive (${orientation.summedLoss}) — ` +
        'the synthetic sheet is not genuinely inconsistent, so the repair path is not exercised',
    );
    failed = true;
  }
  if (repaired.frontCellsRestored <= 0) {
    console.error(
      'INVARIANT FAILED: frontCellsRestored is not positive — repairFrontProtecting was not exercised',
    );
    failed = true;
  }
  if (orientation.flips.topX !== true) {
    console.error(
      `INVARIANT FAILED: expected orientation search to choose topX=true, got flips=${JSON.stringify(orientation.flips)} ` +
        '— the orientation search was not exercised',
    );
    failed = true;
  }

  if (failed) {
    console.error(`\nselftest FAILED → ${RUN_DIR}`);
    process.exit(1);
  }
  console.log(`\nselftest OK → ${RUN_DIR}`);
}

if (SELFTEST) {
  runSelftest();
} else {
  await main();
}

async function main(): Promise<void> {
  const RUN_DIR = join(import.meta.dirname, '..', 'runs', OUT_RUN_ID);
  const RAW_DIR = join(RUN_DIR, 'raw');
  const THIRDS_DIR = join(RUN_DIR, 'thirds');
  const MASKS_DIR = join(RUN_DIR, 'masks');
  const RENDERS_DIR = join(RUN_DIR, 'renders');
  for (const dir of [RUN_DIR, RAW_DIR, THIRDS_DIR, MASKS_DIR, RENDERS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }

  console.log(`provider: ${PROVIDER}, ${candidates.length} images to generate`);

  const entries = await runPool(candidates, CONCURRENCY, async ({ noun, variant, seed }) => {
    const stem = `${nounFileStem(noun)}-v${variant}-c${seed}`;
    const spec = NOUN_TABLE[noun];
    const prompt = buildPrompt(spec, variant);
    const entry: ManifestEntry = { noun, variant, seed, prompt, ok: false };
    try {
      const rawPath = join(RAW_DIR, `${stem}.png`);
      const reuse = SKIP_EXISTING && existsSync(rawPath);
      const png = reuse ? readFileSync(rawPath) : await generate(prompt, seed);
      if (reuse) entry.note = 'reused existing raw (skip-existing)';
      else writeFileSync(rawPath, png);

      const {
        compliance,
        orientation,
        repaired,
        hull2Voxels,
        hull2atVoxels,
        hull2cap6Voxels,
        hull2ZScale,
        flat4Voxels,
      } = processSheet(
        png,
        spec,
        stem,
        { thirdsDir: THIRDS_DIR, stem },
      );

      const maskText =
        [
          ['front', maskToRows(repaired.front)],
          ['side', maskToRows(repaired.side)],
          ['top', maskToRows(repaired.top)],
        ]
          .map(([label, rows]) => `${label}\n${(rows as string[]).join('\n')}`)
          .join('\n\n') + '\n';
      writeFileSync(join(MASKS_DIR, `${stem}.txt`), maskText);

      writeFileSync(join(RENDERS_DIR, `${stem}-hull3.png`), renderVoxelsPng(repaired.voxels));
      writeFileSync(join(RENDERS_DIR, `${stem}-hull2.png`), renderVoxelsPng(hull2Voxels));
      writeFileSync(join(RENDERS_DIR, `${stem}-hull2at.png`), renderVoxelsPng(hull2atVoxels));
      writeFileSync(join(RENDERS_DIR, `${stem}-hull2cap6.png`), renderVoxelsPng(hull2cap6Voxels));

      // Viewer-format results (src/App.tsx globs runs/*/*.json): one
      // BenchResult per treatment worth eyeballing in the contact sheet —
      // the depth-capped 2-view hull (the probe's product) and its flat(4)
      // baseline — named so each candidate's A/B pair sorts adjacently.
      const viewerItem = (label: string, voxels: Vec3[]) =>
        JSON.stringify({ noun: `${stem} ${label}`, size: SIZE, voxels }, null, 2) + '\n';
      writeFileSync(join(RUN_DIR, `${stem}-cap6.json`), viewerItem('cap6', hull2cap6Voxels));
      writeFileSync(join(RUN_DIR, `${stem}-flat4.json`), viewerItem('flat4', flat4Voxels));
      writeFileSync(join(RENDERS_DIR, `${stem}-flat4.png`), renderVoxelsPng(flat4Voxels));

      entry.ok = true;
      entry.compliance = compliance;
      entry.orientation = { flips: orientation.flips, lossBeforeRepair: orientation.loss };
      entry.repair = {
        frontCellsRestored: repaired.frontCellsRestored,
        sideCellsAdded: repaired.sideCellsAdded,
        topCellsAdded: repaired.topCellsAdded,
      };
      entry.voxelCounts = {
        hull3: repaired.voxels.length,
        hull2: hull2Voxels.length,
        hull2at: hull2atVoxels.length,
        hull2cap6: hull2cap6Voxels.length,
        flat4: flat4Voxels.length,
      };
      entry.hull2ZScale = Number(hull2ZScale.toFixed(3));
      console.log(
        `${stem}: ok, compliant=${compliance.compliant}, hull3=${repaired.voxels.length} voxels` +
          `${entry.note ? ` (${entry.note})` : ''}`,
      );
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      console.error(`${stem}: FAILED — ${entry.error}`);
    }
    return entry;
  });

  const okCount = entries.filter((e) => e.ok).length;
  const manifest = {
    id: OUT_RUN_ID,
    date: MANIFEST_DATE,
    provider: PROVIDER,
    model: 'black-forest-labs/FLUX.1-schnell',
    candidates: entries,
  };
  writeFileSync(join(RUN_DIR, 'gen.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\ngenerated ${okCount}/${entries.length} sheets ok → ${RUN_DIR}`);
}
