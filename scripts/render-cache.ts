// Render every cached VoxelGrid in the local Worker KV to judge-ready PNGs:
// a color 30° iso view and a color front-ortho (the mask-exact view). Pure
// local reads — no Anthropic, no Replicate, no network.
//
//   npx tsx scripts/render-cache.ts <outDir>
//
// Writes <outDir>/<term>-iso.png and <outDir>/<term>-front.png, plus
// <outDir>/terms.json (term list + per-term structural metrics measured
// fresh, same definitions as api/scripts/audit-cache.ts).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import { COLORS } from '../src/render/palette.ts';
import type { Color } from '../src/render/palette.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KV = path.resolve(HERE, '../../api/.wrangler/state/v3/kv');
const BLOBS = path.join(KV, 'local-placeholder-cache/blobs');

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: npx tsx scripts/render-cache.ts <outDir>');
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
  throw new Error('CACHE KV sqlite not found — is the local Worker seeded?');
}

type Voxel = { x: number; y: number; z: number; color: Color };

function frontOrthoSVG(voxels: Voxel[], size: number): string {
  // Straight-on front view: for each (x, y) column take the voxel nearest
  // the camera (min z). y up on screen, so screen row = size-1-y.
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

const DB = findCacheDb();
const rows = execFileSync('sqlite3', [DB, 'select key, blob_id from _mf_entries;'])
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('|'))
  .filter(([key]) => key.startsWith('g:'));

const manifest: { term: string; vox: number; size: number }[] = [];
for (const [key, blobId] of rows) {
  const term = key.slice(2);
  const p = path.join(BLOBS, blobId);
  if (!fs.existsSync(p)) continue;
  const entry = JSON.parse(fs.readFileSync(p, 'utf8'));
  const voxels: Voxel[] = entry.grid?.voxels ?? [];
  const size: number = entry.grid?.size ?? 16;

  const iso = renderIsoSVG(
    voxels.map((v) => [v.x, v.y, v.z] as const),
    { mode: 'color', colors: voxels.map((v) => COLORS[v.color]) },
  );
  fs.writeFileSync(
    path.join(outDir, `${term}-iso.png`),
    new Resvg(iso, { fitTo: { mode: 'width', value: 512 } }).render().asPng(),
  );
  fs.writeFileSync(
    path.join(outDir, `${term}-front.png`),
    new Resvg(frontOrthoSVG(voxels, size), { fitTo: { mode: 'width', value: 384 } }).render().asPng(),
  );
  manifest.push({ term, vox: voxels.length, size });
}

fs.writeFileSync(path.join(outDir, 'terms.json'), JSON.stringify(manifest, null, 2));
console.log(`${manifest.length} terms rendered → ${outDir}`);
