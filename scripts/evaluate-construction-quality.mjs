import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { convertToBricks } from '../src/construction.js';
import { repairPreparedConstruction } from '../src/complete-construction.js';
import { planSubassemblies } from '../src/plan-subassemblies.js';
import { measureBrickDifference } from '../src/construction-differences.js';
import { refineConstruction, packingProfile, assemblyRejectionReasons, unresolvedCells } from '../src/refine-construction.js';
import { assessAssemblyQuality, orderQualityRejections } from '../src/assembly-quality.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { deriveGuidePresentation } from '../src/guide-presentation.js';
import { createGuideNumbering } from '../src/guide-numbering.js';
import { createGuideSections } from '../src/guide-sections.js';
import { DEMO_EXAMPLES } from '../src/demo-client.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

export async function evaluateConstructionQuality({ dataRoot } = {}) {
const root = new URL('../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const cellKey = ({x,y,z}) => `${x},${y},${z}`;
const brickKey = ({x,y,z,w,d,color}) => `${x},${y},${z}:${w}x${d}:${color}`;
const comparedMetricFields = ['mappedCellCount','addedVolumeVoxelEquivalent','removedVolumeVoxelEquivalent','recoloredVolumeVoxelEquivalent','relativeVolumeChange','geometryDifferenceRatio','colorDifferenceRatio'];
const cellsOf = brick => {
  const cells=[];
  for(let x=brick.x;x<brick.x+brick.w;x++) for(let z=brick.z;z<brick.z+brick.d;z++) cells.push(`${x},${brick.y},${z}`);
  return cells;
};
const sortedCells = cells => [...cells].sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x||a.color.localeCompare(b.color));
const addedOccupiedCells = (before,after) => {
  const cells=[];
  for(const [key,cell] of after.cells) if(!before.cells.has(key)) {
    const [x,y,z]=key.split(',').map(Number);
    cells.push({x,y,z,color:cell.color});
  }
  return sortedCells(cells);
};
function assertOldOccupancyPreserved(before,after) {
  const components=new Map();
  for(const [key,cell] of before.cells) {
    const next=after.cells.get(key);
    assert.ok(next,`Old occupied cell ${key} was removed.`);
    assert.equal(next.color,cell.color,`Old occupied cell ${key} changed color.`);
    const mapped=components.get(cell.component);
    if(mapped===undefined) components.set(cell.component,next.component);
    else assert.equal(next.component,mapped,`Old component ${cell.component} was split.`);
  }
}
function assertGuideContracts(final,presentation,numbering) {
  assert.equal(final.guide.stats.coverageComplete,true);
  assert.equal(presentation.stats.coverageComplete,true);
  assert.deepEqual([...numbering.byStepId.values()],Array.from({length:numbering.diagramCount},(_,index)=>index+1));
  const covered=final.instructionPlan.steps.flatMap(step=>step.newBrickIds);
  assert.equal(covered.length,final.assemblyPlan.bricks.length);
  assert.equal(new Set(covered).size,covered.length);
  assert.deepEqual(final.instructionPlan.steps.flatMap(step=>step.sourceStepIds),final.assemblyPlan.steps.map(step=>step.id));
  assert.deepEqual(final.instructionPlan.steps.flatMap(step=>step.orderedOperations).map(operation=>operation.id),final.assemblyPlan.steps.map(step=>step.id));
  assert.equal(final.instructionPlan.inventory.reduce((sum,item)=>sum+item.count,0),covered.length);
}
function assertSubassemblyContract(result) {
  const plan=result.assemblyPlan;
  const modules=plan.modules.filter(module=>module.buildContext?.kind==='work-surface');
  if(!result.subassemblyRefinement.selected) return assert.equal(modules.length,0);
  assert.equal(modules.length,1);
  const module=modules[0];
  const byId=new Map(plan.bricks.map(brick=>[brick.id,brick]));
  const selected=new Set(module.brickIds);
  const steps=plan.steps.filter(step=>step.moduleId===module.id);
  const join=steps.at(-1);
  assert.equal(join.kind,'join');
  assert.deepEqual(join.newBrickIds,[]);
  assert.deepEqual(new Set(join.highlightBrickIds),selected);
  assert.equal(steps.slice(0,-1).every(step=>step.kind==='build'
    &&step.visibleBrickIds.every(id=>selected.has(id))),true);
  const groups=join.joinContext.supportGroups;
  assert.ok(groups.length>=1&&groups.length<=4);
  assert.equal(join.joinContext.direction,'down');
  assert.equal(join.joinContext.requiresAlignment,groups.length>1);
  for(const group of groups) {
    assert.ok(group.brickIds.some(id=>byId.get(id).y===0));
    assert.ok(group.contacts.length>0);
    for(const contact of group.contacts) {
      assert.ok(group.brickIds.includes(contact.supportBrickId));
      assert.ok(selected.has(contact.bandBrickId));
      const lower=byId.get(contact.supportBrickId),upper=byId.get(contact.bandBrickId);
      assert.equal(upper.y,lower.y+1);
      const area=Math.max(0,Math.min(lower.x+lower.w,upper.x+upper.w)-Math.max(lower.x,upper.x))
        *Math.max(0,Math.min(lower.z+lower.d,upper.z+upper.d)-Math.max(lower.z,upper.z));
      assert.ok(area>0);
      assert.equal(contact.studs,area);
    }
  }
  for(const id of module.brickIds) {
    const brick=byId.get(id);
    const internalBelow=plan.graph.edges.some(edge=>{
      const other=edge.a===id?edge.b:edge.b===id?edge.a:null;
      return other&&selected.has(other)&&byId.get(other).y===brick.y-1;
    });
    if(!internalBelow) assert.equal(brick.y,module.buildContext.floorY);
  }
}
function mappedRegressionCases(beforePlan,final,numbering) {
  const byBeforeId=new Map(beforePlan.bricks.map(brick=>[brick.id,brick]));
  const pairs=[[41,42],[43,44],[46,47],[48,49],[50,51],[52,53],[50,51,52,53,54],[55,56,57,58]];
  return pairs.map(numbers=>{
    const originalBrickIds=numbers.flatMap(number=>beforePlan.steps[number-1].newBrickIds);
    const originalCells=new Set(originalBrickIds.flatMap(id=>cellsOf(byBeforeId.get(id))));
    const finalBrickIds=final.assemblyPlan.bricks.filter(brick=>cellsOf(brick).some(key=>originalCells.has(key))).map(brick=>brick.id);
    const finalIds=new Set(finalBrickIds);
    const diagramIds=final.instructionPlan.steps.filter(step=>step.newBrickIds.some(id=>finalIds.has(id))).map(step=>step.id);
    return {originalNumbers:numbers,originalBrickIds,originalCellCount:originalCells.size,finalBrickIds,diagramIds,
      displayedNumbers:diagramIds.map(id=>numbering.byStepId.get(id)).filter(number=>number!==undefined)};
  });
}
async function previousReceipt(privateRoot) {
  try {
    const latest=JSON.parse(await readFile(join(privateRoot,'construction-evaluation','latest.json')));
    const previous=JSON.parse(await readFile(join(privateRoot,'construction-evaluation',latest.report)));
    return {path:latest.report,results:new Map(previous.results.map(entry=>[`${entry.shape}:${entry.variant}`,entry]))};
  } catch {
    return {path:null,results:new Map()};
  }
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const sourceRoot = new URL('.',root).pathname;
const privateRoot = resolvePrivateDataRoot({sourceRoot,dataRoot});
const outputPath=join(privateRoot,'construction-evaluation',stamp);
await ensurePrivateDirectory(outputPath);
const directory=pathToFileURL(`${outputPath}/`);
const index = JSON.parse(await readFile(new URL('public/examples/index.json', root)));
const prior=await previousReceipt(privateRoot);
const report = { createdAt:new Date().toISOString(), scope:'All saved Shapes42–47 baseline/adjusted. Local packing/root repair followed by guarded work-surface subassembly planning. Reports rigid-join checks separately from physical strength and balance. No live generation.', priorReceipt:prior.path, files:{}, results:[] };
for (const path of ['src/assembly.js', 'src/assembly-quality.js', 'src/assembly-diagrams.js', 'src/instruction-visibility.js', 'src/prepare-assembly-guide.js', 'src/refine-construction.js', 'src/brick-refinement.js', 'src/root-refinement.js', 'src/construction-differences.js', 'src/complete-construction.js', 'src/plan-subassemblies.js', 'src/guide-presentation.js', 'src/assembly-booklet.js', 'src/product-viewer.js', 'src/assembly-join-preview.js', 'scripts/evaluate-construction-quality.mjs']) {
  report.files[path] = hash(await readFile(new URL(path, root)));
}

for (let shape = 42; shape <= 47; shape++) {
  const entry=index.find(item=>item.shape===shape);
  if(!entry) throw new Error(`Curated Shape ${shape} is unavailable.`);
  const bytes = await readFile(new URL('public'+entry.url, root));
  const rawModel = JSON.parse(bytes);
  const originalRaw = JSON.stringify(rawModel);
  for (const adjustments of [false,true]) {
    const variant = adjustments ? 'adjusted' : 'baseline';
    const refined = refineConstruction(convertToBricks({rawModel, adjustments}));
    const unchanged = JSON.stringify(refined);
    const subject = DEMO_EXAMPLES.find(example=>example.shape===shape).name;
    const prepared = prepareAssemblyGuide(refined);
    const preparedUnchanged=JSON.stringify(prepared);
    const sourcePresentation=deriveGuidePresentation({plan:refined.assemblyPlan,guide:createGuideSections(refined.assemblyPlan),subject});
    const priorCompactionInputDiagrams=createGuideNumbering(sourcePresentation.sections).diagramCount;
    const beforeRootQuality=assessAssemblyQuality(prepared.assemblyPlan);
    const repaired=repairPreparedConstruction(prepared,{rawModel,allowExtensions:adjustments});
    const afterRootQuality=assessAssemblyQuality(repaired.assemblyPlan);
    const beforePresentation=deriveGuidePresentation({plan:repaired.instructionPlan,guide:repaired.guide,subject});
    const beforeDisplayedDiagrams=createGuideNumbering(beforePresentation.sections).diagramCount;
    const repairedUnchanged=JSON.stringify(repaired);
    const final=planSubassemblies(repaired);
    const afterSubassemblyQuality=assessAssemblyQuality(final.assemblyPlan);
    const presentation = deriveGuidePresentation({plan:final.instructionPlan, guide:final.guide, subject});
    const numbering = createGuideNumbering(presentation.sections);
    assert.equal(JSON.stringify(rawModel), originalRaw);
    assert.equal(JSON.stringify(refined), unchanged);
    assert.equal(JSON.stringify(prepared),preparedUnchanged);
    assert.equal(JSON.stringify(repaired),repairedUnchanged);
    assert.deepEqual(final.brickModel,repaired.brickModel);
    assert.deepEqual(final.diagnostics,repaired.diagnostics);
    assert.deepEqual(assemblyRejectionReasons(repaired.assemblyPlan,final.assemblyPlan),[]);
    assert.deepEqual(orderQualityRejections(afterRootQuality,afterSubassemblyQuality),[]);
    assert.deepEqual(assemblyRejectionReasons(prepared.assemblyPlan,final.assemblyPlan),[]);
    const rootOrderRejectionReasons=orderQualityRejections(beforeRootQuality,afterRootQuality);
    assert.deepEqual(rootOrderRejectionReasons,[]);
    const beforeProfile=packingProfile(prepared.brickModel.bricks);
    const afterProfile=packingProfile(final.brickModel.bricks);
    assertOldOccupancyPreserved(beforeProfile,afterProfile);
    assert.equal(final.diagnostics.checks.schema,true);
    assert.equal(final.diagnostics.checks.legalFootprints,true);
    assert.equal(final.diagnostics.checks.noCollisions,true);
    const actualAddedCells=addedOccupiedCells(beforeProfile,afterProfile);
    const reportedAddedCells=sortedCells(final.rootRefinement.addedCells);
    assert.deepEqual(actualAddedCells,reportedAddedCells);
    const unresolved=unresolvedCells(final.assemblyPlan);
    assert.equal(actualAddedCells.some(cell=>unresolved.has(cellKey(cell))),false);
    if(!adjustments) {
      assert.deepEqual(actualAddedCells,[]);
      assert.equal(final.rootRefinement.addedCellCount,0);
    }
    const measured=measureBrickDifference(rawModel,final.brickModel);
    for(const field of comparedMetricFields) assert.equal(final.metrics[field],measured[field],field);
    assertGuideContracts(final,presentation,numbering);
    assertSubassemblyContract(final);
    const beforePlacements=new Set(prepared.brickModel.bricks.map(brickKey));
    const afterPlacements=new Set(final.brickModel.bricks.map(brickKey));
    const removedPlacementCount=[...beforePlacements].filter(key=>!afterPlacements.has(key)).length;
    const addedPlacementCount=[...afterPlacements].filter(key=>!beforePlacements.has(key)).length;
    const previous=prior.results.get(`${shape}:${variant}`);
    const record = {shape,variant,rawHash:hash(bytes),beforePlacementsHash:hash(JSON.stringify(prepared.brickModel.bricks)),placementsHash:hash(JSON.stringify(final.brickModel.bricks)),rawUnchanged:true,
      postRootPlacementsHash:hash(JSON.stringify(repaired.brickModel.bricks)),subassemblyPlacementsUnchanged:true,
      placementChanges:removedPlacementCount+addedPlacementCount,removedPlacementCount,addedPlacementCount,
      before:repaired.assemblyPlan.stats,after:final.assemblyPlan.stats,evaluation:final.assemblyEvaluation,rootRefinement:final.rootRefinement,
      subassemblyRefinement:final.subassemblyRefinement,
      subassemblyOrderQuality:{before:afterRootQuality,after:afterSubassemblyQuality},
      rootOrderQuality:{before:beforeRootQuality,after:afterRootQuality,rejectionReasons:rootOrderRejectionReasons},
      geometryColorMetrics:Object.fromEntries([...comparedMetricFields.map(field=>[field,measured[field]]),['colorVolumeDeltas',measured.colorVolumeDeltas]]),
      diagnostics:final.diagnostics,presentation:presentation.stats,priorReceiptDisplayedDiagrams:previous?.displayedDiagrams??null,
      priorCompactionInputDiagrams,beforeDisplayedDiagrams,displayedDiagrams:numbering.diagramCount,totalConversionMs:final.metrics.conversionMs,stageTiming:final.metrics.stageTiming};
    report.results.push(record);
    if (shape===43 && adjustments) {
      record.userRegressionCases=mappedRegressionCases(refined.assemblyPlan,final,numbering);
      await writeFile(new URL('cat.json',directory),JSON.stringify({final,presentation,userRegressionCases:record.userRegressionCases},null,2)+'\n',{mode:PRIVATE_FILE_MODE});
    }
    if(shape===47&&adjustments) await writeFile(new URL('nostalgia.json',directory),JSON.stringify({final,presentation},null,2)+'\n',{mode:PRIVATE_FILE_MODE});
    console.log(JSON.stringify({shape,variant,diagrams:[beforeDisplayedDiagrams,numbering.diagramCount],lateFoundations:[afterRootQuality.lateFoundationCount,afterSubassemblyQuality.lateFoundationCount],downwardReturns:[afterRootQuality.downwardReturnCount,afterSubassemblyQuality.downwardReturnCount],roots:[record.before.rootFailureCount,record.after.rootFailureCount],unresolved:[record.before.unresolvedBrickCount,record.after.unresolvedBrickCount],subassembly:{selected:record.subassemblyRefinement.selected,evaluated:record.subassemblyRefinement.evaluatedCount,stageMs:Math.round(record.subassemblyRefinement.stageMs)}}));
  }
}
await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2)+'\n',{mode:PRIVATE_FILE_MODE});
await ensurePrivateDirectory(join(privateRoot,'construction-evaluation'));
await writeFile(join(privateRoot,'construction-evaluation','latest.json'),JSON.stringify({report:`${stamp}/report.json`},null,2)+'\n',{mode:PRIVATE_FILE_MODE});
console.log(`Report: ${directory.pathname}report.json`);
return report;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  evaluateConstructionQuality().catch(error=>{console.error(error.message);process.exitCode=1;});
}
