import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../../api/src/analyze.ts';
const dir = process.argv[2];
const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'run.json').sort();
for (const f of files) {
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const voxels = (r.voxels as [number,number,number][]).map(([x,y,z]) => ({ x, y, z }));
  const a = analyze({ size: r.size, voxels } as never);
  const flag = (a.components !== 1 || !a.touchesGround) ? '  <-- CHECK' : '';
  console.log(`${r.noun.padEnd(16)} vox=${String(r.voxels.length).padStart(4)} comps=${a.components} ground=${a.touchesGround} floats=${a.floatingCount}${flag}`);
}
