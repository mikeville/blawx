// Render a shuffled, opaque-id blind set from arbitrary bench-result JSONs
// for the free-naming panel. Used by the tier1-regen1 round for the
// incumbent-vs-challenger panel and the winners re-score pass.
//
// Usage: npx tsx scripts/_tier1_regen_blind.ts <outDir> <seed> <result.json...>

import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderIsoSVG } from '../src/bench/isoRender.ts';

const [OUT, seedArg, ...jsonPaths] = process.argv.slice(2);
if (!OUT || !seedArg || jsonPaths.length === 0) {
  console.error('usage: npx tsx scripts/_tier1_regen_blind.ts <outDir> <seed> <result.json...>');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const items: { noun: string; src: string; voxels: number[][] }[] = [];
for (const p of jsonPaths) {
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!r.voxels?.length) {
    console.warn(`skip (zero voxels): ${p}`);
    continue;
  }
  items.push({ noun: r.noun, src: path.relative('runs', p).replace(/\.json$/, ''), voxels: r.voxels });
}

// deterministic shuffle (LCG, caller-chosen seed)
let s = Number(seedArg);
const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
for (let i = items.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [items[i], items[j]] = [items[j], items[i]];
}

const key: Record<string, { noun: string; src: string; vox: number }> = {};
items.forEach((it, i) => {
  const id = `item${String(i + 1).padStart(2, '0')}`;
  key[id] = { noun: it.noun, src: it.src, vox: it.voxels.length };
  const svg = renderIsoSVG(it.voxels.map((v) => [v[0], v[1], v[2]]));
  fs.writeFileSync(path.join(OUT, `${id}.png`), new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng());
});
fs.writeFileSync(path.join(OUT, 'KEY.json'), JSON.stringify(key, null, 2));
console.log(`rendered ${items.length} → ${OUT}`);
