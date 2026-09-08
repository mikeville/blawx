import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {convertToBricks} from '../src/construction.js';
import {sequenceAssembly} from '../src/assembly-sequence.js';
import {refineConstruction,packingProfile,packingRejectionReasons,unresolvedCells} from '../src/refine-construction.js';
import {createGuideSections} from '../src/guide-sections.js';
import {deriveGuidePresentation} from '../src/guide-presentation.js';
import {createGuideNumbering} from '../src/guide-numbering.js';
import {DEMO_EXAMPLES} from '../src/demo-client.js';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ensurePrivateDirectory,PRIVATE_FILE_MODE,resolvePrivateDataRoot} from '../server/private-data-root.js';

const root=new URL('../',import.meta.url);
const hash=value=>createHash('sha256').update(value).digest('hex');
const cellHash=bricks=>hash(JSON.stringify([...packingProfile(bricks).cells].map(([key,c])=>[key,c.color]).sort(([a],[b])=>a.localeCompare(b))));
export async function benchmarkBrickRefinement({dataRoot}={}) {
const index=JSON.parse(await readFile(new URL('public/examples/index.json',root)));
const report={createdAt:new Date().toISOString(),scope:'Saved Shapes42–47; local exact packing refinement, local assembly progression and whole-number guide. Former automatic underside sequence recorded separately; no geometry/color/generation changes.',files:{},results:[]};
for(const path of ['src/brick-refinement.js','src/refine-construction.js','src/assembly.js','src/guide-numbering.js']) report.files[path]=hash(await readFile(new URL(path,root)));
const privateRoot=resolvePrivateDataRoot({sourceRoot:new URL('.',root).pathname,dataRoot});
const outputPath=path.join(privateRoot,'brick-refinement');
await ensurePrivateDirectory(outputPath);
const directory=pathToFileURL(`${outputPath}/`);
for(let shape=42;shape<=47;shape++) {
 const entry=index.find(item=>item.shape===shape);
 if(!entry) throw new Error(`Curated Shape ${shape} is unavailable.`);
 const sourcePath='public'+entry.url;
 const bytes=await readFile(new URL(sourcePath,root));
 const rawModel=JSON.parse(bytes);
 const rawBefore=JSON.stringify(rawModel);
 for(const adjustments of [false,true]) {
  const variant=adjustments?'adjusted':'baseline';
  const original=convertToBricks({rawModel,adjustments});
  const former=sequenceAssembly({brickModel:original.brickModel,baselinePlan:original.assemblyPlan}).plan;
  const refined=refineConstruction(original);
  const plan=refined.assemblyPlan;
  const guide=createGuideSections(plan);
  const presentation=deriveGuidePresentation({plan,guide,subject:DEMO_EXAMPLES.find(item=>item.shape===shape).name});
  const numbering=createGuideNumbering(presentation.sections);
  assert.equal(JSON.stringify(rawModel),rawBefore);
  assert.deepEqual(packingRejectionReasons(packingProfile(original.brickModel.bricks),packingProfile(refined.brickModel.bricks)),[]);
  assert.equal(cellHash(original.brickModel.bricks),cellHash(refined.brickModel.bricks));
  assert.ok(refined.brickModel.bricks.length<=original.brickModel.bricks.length);
  assert.equal(plan.stats.coverageComplete,true);
  assert.equal(plan.inventory.reduce((sum,item)=>sum+item.count,0),plan.bricks.length);
  assert.equal(guide.stats.coverageComplete,true);
  assert.equal(presentation.stats.coverageComplete,true);
  assert.equal(plan.steps.some(step=>step.insertionDirection==='up'),false);
  assert.deepEqual([...numbering.byStepId.values()],Array.from({length:numbering.diagramCount},(_,i)=>i+1));
  const record={shape,variant,source:{path:sourcePath,sha256:hash(bytes)},rawUnchanged:true,occupiedCellsHash:cellHash(refined.brickModel.bricks),beforePlacementHash:hash(JSON.stringify(original.brickModel.bricks)),afterPlacementHash:hash(JSON.stringify(refined.brickModel.bricks)),formerGuide:{...former.stats,unresolvedCellCount:unresolvedCells(former).size},refinement:refined.packingRefinement,diagnostics:{before:original.diagnostics.stats,after:refined.diagnostics.stats},totalConversionMs:refined.metrics.conversionMs,presentation:presentation.stats,displayedSteps:numbering.diagramCount};
  report.results.push(record);
  console.log(JSON.stringify({shape,variant,parts:[record.refinement.before.brickCount,record.refinement.after.brickCount],singles:[record.refinement.before.partHistogram['1x1']??0,record.refinement.after.partHistogram['1x1']??0],roots:[record.refinement.before.assembly.rootFailureCount,plan.stats.rootFailureCount],unresolvedCells:[record.refinement.before.unresolvedCellCount,record.refinement.after.unresolvedCellCount],accepted:record.refinement.accepted.length,ms:Math.round(record.totalConversionMs),steps:record.displayedSteps}));
  if(shape===43 && adjustments) {
   // The cited 2x2 can merge directly, but the bounded search may find a
   // better supported tiling across the neighboring patch. Check the
   // builder-visible outcome instead of requiring one particular seam.
   const cited=plan.bricks.filter(b=>b.y===1&&b.color==='orange'&&b.x<22&&b.x+b.w>20&&b.z<15&&b.z+b.d>13);
   assert.ok(cited.some(b=>Math.min(b.w,b.d)===2&&Math.max(b.w,b.d)===4),'Cited area should use a 2x4');
   assert.ok(!cited.some(b=>b.x===20&&b.z===13&&b.w===2&&b.d===2),'Cited unsupported 2x2 should be replaced');
   for(const brick of cited) {
    const addition=plan.steps.find(step=>step.newBrickIds.includes(brick.id));
    assert.equal(addition?.kind,'build','Cited replacement must have an ordinary supported build step');
   }
   assert.ok(plan.steps[0].newBrickIds.every(id=>plan.bricks.find(b=>b.id===id).color==='white'),'First step should build a coherent white foot');
   await writeFile(new URL('cat.json',directory),JSON.stringify({refined,guide,presentation,citedReplacements:cited},null,2)+'\n',{mode:PRIVATE_FILE_MODE});
  }
 }
}
await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2)+'\n',{mode:PRIVATE_FILE_MODE});
return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) await benchmarkBrickRefinement();
