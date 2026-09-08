import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { convertToBricks } from '../src/construction.js';
import { createAssemblyPlan } from '../src/assembly.js';
import { createGuideSections } from '../src/guide-sections.js';
import { deriveGuidePresentation } from '../src/guide-presentation.js';
import { DEMO_EXAMPLES } from '../src/demo-client.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

const root = new URL('../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
export async function benchmarkGuidePresentation({referenceReportPath,dataRoot}={}) {
if(!referenceReportPath) throw new Error('An explicit curated referenceReportPath is required.');
const prior = JSON.parse(await readFile(referenceReportPath));
const report = { createdAt:new Date().toISOString(), scope:'Saved Shapes42–47 adjusted construction plus guide presentation. No generation; elapsed presentation time excludes conversion and rendering.', results:[] };
for (const old of prior.results) {
  const bytes = await readFile(new URL(old.source.path,root));
  const rawModel = JSON.parse(bytes);
  const result = convertToBricks({rawModel,adjustments:true});
  const plan = result.assemblyPlan ?? createAssemblyPlan({brickModel:result.brickModel,rawModel});
  const guide = createGuideSections(plan);
  const started = performance.now();
  const presentation = deriveGuidePresentation({plan,guide,subject:DEMO_EXAMPLES.find(example=>example.shape===old.shape).name});
  const presentationMs = performance.now()-started;
  const sourceUnchanged = hash(bytes)===old.source.sha256;
  const placementsUnchanged = hash(JSON.stringify(result.brickModel.bricks))===old.variants.adjusted.brickHash;
  const inventoryComplete = presentation.sections.flatMap(section=>section.totalInventory).reduce((n,part)=>n+part.count,0)===plan.bricks.length;
  if (!sourceUnchanged || !placementsUnchanged || !inventoryComplete || !presentation.stats.coverageComplete) throw Error(`Shape${old.shape} preservation failure`);
  const displayedAssemblyDiagrams = presentation.sections.reduce((n,section)=>n+section.stepIds.length,0);
  const record = { shape:old.shape,presentationMs,sourceUnchanged,placementsUnchanged,inventoryComplete,stats:presentation.stats,displayedAssemblyDiagrams,placementDiagrams:presentation.sections.filter(section=>section.repeatCount>1).length,sections:presentation.sections.map(({label,repeatCount,sectionIds,stepIds,instances,status})=>({label,repeatCount,sectionIds,stepCount:stepIds.length,status,instances:instances.map(({sectionId,transform})=>({sectionId,transform}))})) };
  report.results.push(record);
  console.log(JSON.stringify(record));
}
const privateRoot=resolvePrivateDataRoot({sourceRoot:new URL('.',root).pathname,dataRoot});
const directory=path.join(privateRoot,'guide-presentation');
await ensurePrivateDirectory(directory);
await writeFile(path.join(directory,'comparison.json'),JSON.stringify(report,null,2)+'\n',{mode:PRIVATE_FILE_MODE});
return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
 const index=process.argv.indexOf('--reference-report');
 await benchmarkGuidePresentation({referenceReportPath:index===-1?null:process.argv[index+1]});
}
