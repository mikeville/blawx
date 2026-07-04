// Rasterize each converted hull to an opaque-filename PNG for blind-name
// scoring. Alphabetical noun order defines itemNN numbering (matches
// App.tsx's export flow so results are interchangeable).
//
// Usage: npx tsx scripts/render-scoring-pngs.ts [runId ...]
//        (no args = all runs/sweep1-*)
//
// Writes: runs/<run>/scoring/<run>-itemNN.png

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import type { BenchResult } from '../src/bench/types.ts';

const RUNS_DIR = new URL('../runs/', import.meta.url).pathname;
const requested = process.argv.slice(2);
const runIds = requested.length
  ? requested
  : readdirSync(RUNS_DIR).filter((n) => n.startsWith('sweep1-'));

const itemId = (i: number) => `item${String(i + 1).padStart(2, '0')}`;

let total = 0;
for (const runId of runIds) {
  const runDir = join(RUNS_DIR, runId);
  const jsons = readdirSync(runDir)
    .filter((f) => f.endsWith('.json') && f !== 'run.json' && f !== 'scores.json')
    .sort();

  const items: { noun: string; voxels: BenchResult['voxels'] }[] = [];
  for (const f of jsons) {
    const data = JSON.parse(readFileSync(join(runDir, f), 'utf8')) as BenchResult;
    items.push({ noun: data.noun, voxels: data.voxels });
  }
  items.sort((a, b) => a.noun.localeCompare(b.noun));

  const outDir = join(runDir, 'scoring');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  for (let i = 0; i < items.length; i++) {
    const svg = renderIsoSVG(items[i].voxels);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
    const outPath = join(outDir, `${runId}-${itemId(i)}.png`);
    writeFileSync(outPath, png);
    total++;
  }
  console.log(`${runId}: ${items.length} pngs → ${outDir}`);
}
console.log(`total: ${total} pngs`);
