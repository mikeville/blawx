import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderIsoSVG } from '../src/bench/isoRender.ts';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const items: { noun: string; run: string; voxels: number[][] }[] = [];
for (let b = 1; b <= 5; b++) {
  const dir = `runs/tier1-16char-b${b}`;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'run.json').sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    items.push({ noun: r.noun, run: `b${b}`, voxels: r.voxels });
  }
}
// deterministic shuffle (LCG, fixed seed)
let s = 12345;
const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
for (let i = items.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [items[i], items[j]] = [items[j], items[i]];
}
const key: Record<string, { noun: string; run: string; vox: number }> = {};
items.forEach((it, i) => {
  const id = `item${String(i + 1).padStart(2, '0')}`;
  key[id] = { noun: it.noun, run: it.run, vox: it.voxels.length };
  const svg = renderIsoSVG(it.voxels.map(v => [v[0], v[1], v[2]]));
  fs.writeFileSync(path.join(OUT, `${id}.png`), new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng());
});
fs.writeFileSync(path.join(OUT, 'KEY.json'), JSON.stringify(key, null, 2));
console.log(`rendered ${items.length} → ${OUT}`);
