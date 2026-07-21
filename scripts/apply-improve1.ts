// Stage the improve1 challenger→incumbent swap. Reads the panel decisions,
// backs up every flagged incumbent KV entry, and writes replacement entry
// JSONs (Worker cache schema + provenance tag) for the winners. The actual
// KV writes happen via `wrangler kv key put --local` (see RESULTS.md) so
// miniflare stays the only writer of its own store format.
//
//   npx tsx scripts/apply-improve1.ts <decisions.json> <outDir>
//
// <outDir>/incumbents/<term>.json — verbatim backup of the current entry
// <outDir>/entries/<term>.json    — replacement entry for winners only

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze } from '../../api/src/analyze.ts';
import { colorFor } from '../../api/src/color.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.resolve(HERE, '../runs');
const KV = path.resolve(HERE, '../../api/.wrangler/state/v3/kv');
const BLOBS = path.join(KV, 'local-placeholder-cache/blobs');

const [decisionsPath, outDir] = process.argv.slice(2);
if (!decisionsPath || !outDir) {
  throw new Error('usage: npx tsx scripts/apply-improve1.ts <decisions.json> <outDir>');
}
fs.mkdirSync(path.join(outDir, 'incumbents'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'entries'), { recursive: true });

function findCacheDb(): string {
  const dir = path.join(KV, 'miniflare-KVNamespaceObject');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.sqlite') || f === 'metadata.sqlite') continue;
    const sample = execFileSync('sqlite3', [
      path.join(dir, f),
      "select key from _mf_entries limit 1;",
    ]).toString();
    if (sample.startsWith('g:')) return path.join(dir, f);
  }
  throw new Error('CACHE KV sqlite not found');
}

type Decision = {
  replace: boolean;
  winner: string;
  winner_source: string;
};
const decisions: Record<string, Decision> = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));

const DB = findCacheDb();
const kvRows = new Map(
  execFileSync('sqlite3', [DB, 'select key, blob_id from _mf_entries;'])
    .toString().trim().split('\n').filter(Boolean)
    .map((l) => l.split('|') as [string, string]),
);

let staged = 0;
for (const [term, d] of Object.entries(decisions)) {
  const blobId = kvRows.get(`g:${term}`);
  if (blobId && fs.existsSync(path.join(BLOBS, blobId))) {
    fs.copyFileSync(path.join(BLOBS, blobId), path.join(outDir, 'incumbents', `${term}.json`));
  }
  if (!d.replace) continue;

  const arm = d.winner_source.replace('challenger-', '');
  const r = JSON.parse(
    fs.readFileSync(path.join(RUNS, `improve1-16char-${arm}`, `${term}.json`), 'utf8'),
  );
  const color = colorFor(term);
  const voxels = (r.voxels as [number, number, number][]).map(([x, y, z]) => ({ x, y, z, color }));
  const grid = { size: 16, voxels };
  const c = analyze(grid as never);
  if (c.components !== 1 || !c.touchesGround) {
    throw new Error(`refusing to stage ${term}: winner fails structure (comps=${c.components}, ground=${c.touchesGround})`);
  }
  const entry = {
    grid,
    metrics: {
      voxels: voxels.length,
      components: c.components,
      touchesGround: c.touchesGround,
      floatingCount: c.floatingCount,
    },
    provenance: `improve1-2026-07-20:${d.winner_source}`,
  };
  fs.writeFileSync(path.join(outDir, 'entries', `${term}.json`), JSON.stringify(entry));
  staged++;
}
console.log(`backed up ${kvRows.size >= staged ? Object.keys(decisions).length : '?'} incumbents; staged ${staged} replacement entries → ${outDir}`);
