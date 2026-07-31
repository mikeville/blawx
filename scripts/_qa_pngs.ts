import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import { COLORS } from '../src/render/palette.ts';
import { colorFor } from '../../api/src/color.ts';
const out = process.argv[2], dir = process.argv[3];
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&f!=='run.json').sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const hex = COLORS[colorFor(r.noun)] ?? '#A4ACAE';
  const svg = renderIsoSVG(r.voxels.map((v:number[])=>[v[0],v[1],v[2]]), {mode:'color', colors:r.voxels.map(()=>hex)});
  fs.writeFileSync(path.join(out, `${f.replace('.json','')}.png`), new Resvg(svg,{fitTo:{mode:'width',value:300}}).render().asPng());
}
console.log('done');
