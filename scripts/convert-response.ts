// Convert one pasted model response into a scoreable run result.
//
// Usage: npx tsx scripts/convert-response.ts runs/<run-id>/responses/<noun>.txt
//
// Reads the run's conditions from run.json, parses the three masks (repairing
// and counting malformed rows), lifts the strict visual hull, estimates
// hypothetical tokens from the prompt + response text, and writes
// runs/<run-id>/<noun>.json. Failures still produce a result file (possibly
// with zero voxels) so they stay visible on the contact sheet.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { extractViews, parseMaskText, VIEWS, type Encoding } from '../src/bench/encodings.ts';
import { liftHull } from '../src/bench/hull.ts';
import { maskToRows } from '../src/bench/maskOps.ts';
import { estimateTokens } from '../src/bench/cost.ts';
import { NOUNS } from '../src/bench/nouns.ts';
import type { BenchMeta, BenchResult, RunManifest } from '../src/bench/types.ts';

const responsePath = process.argv[2];
if (!responsePath) {
  console.error('usage: npx tsx scripts/convert-response.ts runs/<run>/responses/<noun>.txt');
  process.exit(1);
}

const runDir = dirname(dirname(responsePath));
const manifest = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as RunManifest;
const size = Number(manifest.conditions?.grid);
const encoding = manifest.conditions?.encoding as Encoding;
if (!Number.isInteger(size) || (encoding !== 'char' && encoding !== 'rle')) {
  console.error(`run.json conditions missing/invalid grid or encoding in ${runDir}`);
  process.exit(1);
}

const slug = basename(responsePath).replace(/\.txt$/, '');
const noun = NOUNS.find((n) => n.noun.replace(/\s+/g, '-') === slug)?.noun ?? slug;

const response = readFileSync(responsePath, 'utf8');
const promptPath = join(runDir, 'prompts', `${slug}.md`);
const promptText = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';

const views = extractViews(response);
const missing = VIEWS.filter((v) => views[v] === undefined);

const notes: string[] = [];
let voxels: BenchResult['voxels'] = [];
let malformedRows = 0;
let reprojectionLoss = { front: 0, side: 0, top: 0 };
let masks: BenchMeta['masks'];

if (missing.length > 0) {
  notes.push(`missing views: ${missing.join(', ')} — lift skipped`);
} else {
  const parsed = VIEWS.map((v) => parseMaskText(views[v]!, size, encoding));
  malformedRows = parsed.reduce((s, p) => s + p.malformedRows, 0);
  const hull = liftHull(parsed[0].mask, parsed[1].mask, parsed[2].mask, size);
  voxels = hull.voxels;
  reprojectionLoss = hull.reprojectionLoss;
  masks = {
    front: maskToRows(parsed[0].mask),
    side: maskToRows(parsed[1].mask),
    top: maskToRows(parsed[2].mask),
  };
  if (voxels.length === 0) notes.push('hull collapsed to zero voxels');
}

const result: BenchResult = {
  noun,
  size,
  voxels,
  meta: {
    model: manifest.conditions?.model,
    encoding,
    tokensIn: estimateTokens(promptText),
    tokensOut: estimateTokens(response),
    hull: { malformedRows, reprojectionLoss },
    ...(masks ? { masks } : {}),
    ...(notes.length > 0 ? { notes: notes.join('; ') } : {}),
  },
};

writeFileSync(join(runDir, `${slug}.json`), JSON.stringify(result));
const fmt = (n: number) => n.toFixed(2);
console.log(
  `${manifest.id}/${noun}: ${voxels.length} voxels, ${malformedRows} malformed rows, ` +
    `loss f=${fmt(reprojectionLoss.front)} s=${fmt(reprojectionLoss.side)} t=${fmt(reprojectionLoss.top)}` +
    (notes.length > 0 ? ` — ${notes.join('; ')}` : ''),
);
