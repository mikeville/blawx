// Blind-trio prep for the improve1 challenger-vs-incumbent ranking.
// For each flagged term: incumbent grid from local KV + challenger lifts
// from runs/improve1-16char-{a,b}/<term>.json, colored via the Worker's
// colorFor(), rendered iso+front under shuffled anonymous version labels.
// The judge panel sees only trio-spec.json + PNGs; trio-key.json holds the
// mapping + per-version structural metrics for the decision step.
//
//   npx tsx scripts/render-improve1-trios.ts <outDir>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import { COLORS } from '../src/render/palette.ts';
import type { Color } from '../src/render/palette.ts';
import { analyze } from '../../api/src/analyze.ts';
import { colorFor } from '../../api/src/color.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.resolve(HERE, '../runs');
const KV = path.resolve(HERE, '../../api/.wrangler/state/v3/kv');
const BLOBS = path.join(KV, 'local-placeholder-cache/blobs');

const TERMS = [
  'apple', 'bowl', 'candy-cane', 'castle', 'cat', 'dragon', 'duck', 'frog',
  'grapes', 'helicopter', 'ice-cream-cone', 'lighthouse', 'mug', 'octopus',
  'palm-tree', 'pants', 'peanut', 'rainbow', 'robot', 'sailboat', 'snail',
  'spider', 'squid', 'star', 'submarine',
];

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: npx tsx scripts/render-improve1-trios.ts <outDir>');
fs.mkdirSync(outDir, { recursive: true });

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

type Voxel = { x: number; y: number; z: number; color: Color };

function frontOrthoSVG(voxels: Voxel[], size: number): string {
  const cell = 24;
  const nearest = new Map<string, Voxel>();
  for (const v of voxels) {
    const k = `${v.x},${v.y}`;
    const cur = nearest.get(k);
    if (!cur || v.z < cur.z) nearest.set(k, v);
  }
  const rects: string[] = [];
  for (const v of nearest.values()) {
    rects.push(
      `<rect x="${v.x * cell}" y="${(size - 1 - v.y) * cell}" width="${cell}" height="${cell}" ` +
        `fill="${COLORS[v.color] ?? '#A4ACAE'}" stroke="#000" stroke-width="1"/>`,
    );
  }
  const w = size * cell;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}">` +
    `<rect width="${w}" height="${w}" fill="#ffffff"/>${rects.join('')}</svg>`
  );
}

function renderVersion(term: string, label: string, voxels: Voxel[], size: number) {
  const iso = renderIsoSVG(
    voxels.map((v) => [v.x, v.y, v.z] as const),
    { mode: 'color', colors: voxels.map((v) => COLORS[v.color]) },
  );
  fs.writeFileSync(
    path.join(outDir, `${term}-${label}-iso.png`),
    new Resvg(iso, { fitTo: { mode: 'width', value: 512 } }).render().asPng(),
  );
  fs.writeFileSync(
    path.join(outDir, `${term}-${label}-front.png`),
    new Resvg(frontOrthoSVG(voxels, size), { fitTo: { mode: 'width', value: 384 } }).render().asPng(),
  );
}

const DB = findCacheDb();
const kvRows = new Map(
  execFileSync('sqlite3', [DB, 'select key, blob_id from _mf_entries;'])
    .toString().trim().split('\n').filter(Boolean)
    .map((l) => l.split('|') as [string, string]),
);

const PERMS: number[][] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

const spec: { term: string; versions: string[] }[] = [];
const key: Record<string, Record<string, unknown>> = {};

for (const term of TERMS) {
  type Cand = { source: string; voxels: Voxel[]; size: number };
  const cands: Cand[] = [];

  const blobId = kvRows.get(`g:${term}`);
  if (!blobId) { console.warn(`skip ${term}: not in KV`); continue; }
  const entry = JSON.parse(fs.readFileSync(path.join(BLOBS, blobId), 'utf8'));
  cands.push({ source: 'incumbent', voxels: entry.grid.voxels, size: entry.grid.size });

  for (const arm of ['a', 'b']) {
    const p = path.join(RUNS, `improve1-16char-${arm}`, `${term}.json`);
    if (!fs.existsSync(p)) { console.warn(`missing challenger ${arm}: ${term}`); continue; }
    const r = JSON.parse(fs.readFileSync(p, 'utf8'));
    const color = colorFor(term);
    const voxels: Voxel[] = (r.voxels as [number, number, number][]).map(
      ([x, y, z]) => ({ x, y, z, color }),
    );
    if (voxels.length === 0) { console.warn(`empty challenger ${arm}: ${term}`); continue; }
    cands.push({ source: `challenger-${arm}`, voxels, size: 16 });
  }

  const perm = PERMS[
    parseInt(crypto.createHash('sha1').update(term).digest('hex').slice(0, 6), 16) % PERMS.length
  ].slice(0, cands.length);
  const order = perm.every((i) => i < cands.length) ? perm : cands.map((_, i) => i);

  const versions: string[] = [];
  order.forEach((ci, vi) => {
    const label = `v${vi + 1}`;
    const cand = cands[ci];
    renderVersion(term, label, cand.voxels, cand.size);
    versions.push(label);
    const grid = { size: cand.size, voxels: cand.voxels };
    const a = analyze(grid as never);
    key[`${term}-${label}`] = {
      source: cand.source,
      vox: cand.voxels.length,
      comps: a.components,
      ground: a.touchesGround,
      floats: a.floatingCount,
    };
  });
  spec.push({ term, versions });
}

fs.writeFileSync(path.join(outDir, 'trio-spec.json'), JSON.stringify(spec, null, 1));
fs.writeFileSync(path.join(outDir, 'trio-key.json'), JSON.stringify(key, null, 1));
console.log(`${spec.length} terms rendered → ${outDir}`);
