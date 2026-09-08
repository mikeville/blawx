import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertToBricks } from '../src/construction.js';
import { createAssemblyPlan } from '../src/assembly.js';
import { createGuideSections } from '../src/guide-sections.js';
import { join } from 'node:path';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
export async function benchmarkAssembly({dataRoot}={}) {
const stamp = new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const privateRoot=resolvePrivateDataRoot({sourceRoot:root,dataRoot});
const directory = join(privateRoot,'assembly-benchmark',stamp);
const index = JSON.parse(await readFile(`${root}public/examples/index.json`,'utf8'));
const report = { createdAt: new Date().toISOString(), scope:'Saved Shapes42–47, local conversion plus assembly planning; no generation or browser rendering', files:{}, results:[] };
for (const path of ['src/construction.js','src/assembly.js','src/assembly-booklet.js','src/guide-sections.js']) report.files[path]=hash(await readFile(root+path));
await ensurePrivateDirectory(directory);
for (let shape=42;shape<=47;shape++) {
  const entry=index.find(item=>item.shape===shape);
  if(!entry) throw new Error(`Curated Shape ${shape} is unavailable.`);
  const path = `public${entry.url}`;
  const bytes = await readFile(root+path);
  const rawModel = JSON.parse(bytes);
  const variants = {};
  for (const adjustments of [false,true]) {
    const result = convertToBricks({rawModel,adjustments});
    const plan = result.assemblyPlan ?? createAssemblyPlan({brickModel:result.brickModel,rawModel});
    const guide = createGuideSections(plan);
    if (!guide.stats.coverageComplete) throw new Error(`Shape${shape}: guide hierarchy coverage failure`);
    const newIds = plan.steps.flatMap(s=>s.newBrickIds);
    if (newIds.length!==plan.bricks.length||new Set(newIds).size!==plan.bricks.length||!plan.stats.coverageComplete) throw new Error(`Shape${shape}: step coverage failure`);
    if (plan.inventory.reduce((n,p)=>n+p.count,0)!==plan.bricks.length) throw new Error(`Shape${shape}: inventory mismatch`);
    const variant = adjustments?'adjusted':'baseline';
    variants[variant]={metrics:result.metrics,diagnostics:result.diagnostics.stats,assembly:plan.stats,guide:guide.stats,sections:guide.sections.map(({inventory,brickIds,groups,...section})=>({...section,groups:groups.map(({inventory,brickIds,...group})=>group)})),modules:plan.modules.map(({brickIds,...m})=>({...m,brickCount:brickIds.length})),adjustments:result.adjustments,brickHash:hash(JSON.stringify(result.brickModel.bricks))};
    if (adjustments && [43,45].includes(shape)) await writeFile(`${directory}/shape${shape}-plan.json`,JSON.stringify({source:{shape,sha256:hash(bytes)},brickModel:result.brickModel,plan,guide},null,2)+'\n',{mode:PRIVATE_FILE_MODE});
  }
  report.results.push({shape,source:{path,sha256:hash(bytes)},variants});
  console.log(JSON.stringify({shape,baseline:variants.baseline.assembly,adjusted:variants.adjusted.assembly}));
}
await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n',{mode:PRIVATE_FILE_MODE});
await ensurePrivateDirectory(join(privateRoot,'assembly-benchmark'));
await writeFile(join(privateRoot,'assembly-benchmark','latest.json'),JSON.stringify({report:`${stamp}/report.json`},null,2)+'\n',{mode:PRIVATE_FILE_MODE});
console.log(`Saved ${directory}/report.json`);
return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await benchmarkAssembly();
