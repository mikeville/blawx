// Deterministic-layer backtest over the live cache. Every cached grid is
// replayed through the current deterministic pipeline (analyze → pack →
// steps → iso render) and reduced to a structural fingerprint. Pure local
// reads; no network, no model calls.
//
//   npx tsx scripts/backtest-cache.ts --write   # snapshot current behavior
//   npx tsx scripts/backtest-cache.ts           # diff behavior vs snapshot
//
// Baseline: scripts/backtest-baseline.json (committed). A diff means a code
// change altered pipeline behavior on real data — inspect before shipping.
// Each fingerprint carries the input grid's own hash, so entries whose KV
// blob changed since the snapshot are reported as CACHE-CHANGED (stale
// input) rather than as behavior diffs.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import { COLORS } from '../src/render/palette.ts';
import { packAllLayers } from '../src/voxel/pack.ts';
import { buildSteps } from '../src/voxel/steps.ts';
import { analyze } from '../../api/src/analyze.ts';
import type { Voxel, VoxelGrid } from '../src/voxel/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KV = path.resolve(HERE, '../../api/.wrangler/state/v3/kv');
const BLOBS = path.join(KV, 'local-placeholder-cache/blobs');
const BASELINE = path.join(HERE, 'backtest-baseline.json');
const write = process.argv.includes('--write');

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
  throw new Error('CACHE KV sqlite not found — is the local Worker seeded?');
}

const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

type Fingerprint = {
  gridHash: string;
  vox: number;
  comps: number;
  ground: boolean;
  floats: number;
  bricks: number;
  footprints: Record<string, number>;
  steps: number;
  isoHash: string;
};

function fingerprint(grid: VoxelGrid): Fingerprint {
  const voxels = grid.voxels as Voxel[];
  const canon = [...voxels]
    .sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x)
    .map((v) => `${v.x},${v.y},${v.z},${v.color}`)
    .join(';');
  const c = analyze(grid);
  const bricks = packAllLayers(voxels);
  const footprints: Record<string, number> = {};
  for (const b of bricks) {
    const k = `${Math.min(b.w, b.d)}x${Math.max(b.w, b.d)}`;
    footprints[k] = (footprints[k] ?? 0) + 1;
  }
  const steps = buildSteps(grid);
  const iso = renderIsoSVG(
    voxels.map((v) => [v.x, v.y, v.z] as const),
    { mode: 'color', colors: voxels.map((v) => COLORS[v.color]) },
  );
  return {
    gridHash: sha(canon),
    vox: voxels.length,
    comps: c.components,
    ground: c.touchesGround,
    floats: c.floatingCount,
    bricks: bricks.length,
    footprints,
    steps: steps.length,
    isoHash: sha(iso),
  };
}

const DB = findCacheDb();
const rows = execFileSync('sqlite3', [DB, 'select key, blob_id from _mf_entries;'])
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('|'))
  .filter(([key]) => key.startsWith('g:'));

const current: Record<string, Fingerprint> = {};
for (const [key, blobId] of rows) {
  const p = path.join(BLOBS, blobId);
  if (!fs.existsSync(p)) continue;
  const entry = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!entry.grid) continue;
  current[key.slice(2)] = fingerprint(entry.grid);
}

if (write) {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 1));
  console.log(`baseline written: ${Object.keys(current).length} terms → ${BASELINE}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('no baseline — run with --write first');
  process.exit(1);
}
const base: Record<string, Fingerprint> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

let diffs = 0, stale = 0;
const allTerms = new Set([...Object.keys(base), ...Object.keys(current)]);
for (const term of [...allTerms].sort()) {
  const b = base[term], c = current[term];
  if (!b) { console.log(`NEW           ${term} (in cache, not in baseline — re-run --write to adopt)`); continue; }
  if (!c) { console.log(`GONE          ${term} (in baseline, not in cache)`); continue; }
  if (b.gridHash !== c.gridHash) { console.log(`CACHE-CHANGED ${term} (input grid differs — baseline stale, not a code diff)`); stale++; continue; }
  const fields = (Object.keys(b) as (keyof Fingerprint)[]).filter(
    (k) => JSON.stringify(b[k]) !== JSON.stringify(c[k]),
  );
  if (fields.length) {
    diffs++;
    for (const k of fields) {
      console.log(`DIFF          ${term}.${k}: ${JSON.stringify(b[k])} → ${JSON.stringify(c[k])}`);
    }
  }
}
console.log(
  `\n${allTerms.size} terms | ${diffs} behavior diff${diffs === 1 ? '' : 's'} | ${stale} stale input${stale === 1 ? '' : 's'}`,
);
process.exit(diffs ? 2 : 0);
