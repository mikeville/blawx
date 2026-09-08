import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { convertToBricks } from '../src/construction.js';
import { createAssemblyPlan } from '../src/assembly.js';
import { sequenceAssembly } from '../src/assembly-sequence.js';
import { createGuideSections } from '../src/guide-sections.js';
import { deriveGuidePresentation } from '../src/guide-presentation.js';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
function verifyUnderAttachments(plan) {
  const byId = new Map(plan.bricks.map(brick=>[brick.id,brick]));
  const prior = new Map(plan.modules.map(module=>[module.id,new Set()]));
  const overlaps = (a,b) => a.x < b.x+b.w && b.x < a.x+a.w && a.z < b.z+b.d && b.z < a.z+a.d;
  for (const step of plan.steps) {
    const valid = prior.get(step.moduleId);
    if (step.insertionDirection === 'up') {
      assert.equal(step.kind,'build');
      assert.equal(plan.modules.find(module=>module.id===step.moduleId).kind,'grounded');
      for (const id of step.newBrickIds) {
        const brick = byId.get(id);
        assert.ok(brick.y >= 1);
        assert.equal(plan.bricks.some(other=>other.y < brick.y && overlaps(brick,other)),false,'Upward sweep occupied');
        const upper = [...valid].filter(id=>byId.get(id).y===brick.y+1 && overlaps(brick,byId.get(id)));
        assert.ok(upper.length>0,'No previously assembled upper engagement');
        const reached = new Set(upper);
        const queue = [...upper];
        for (const current of queue) for (const edge of plan.graph.edges) {
          const next = edge.a===current ? edge.b : edge.b===current ? edge.a : null;
          if(next && valid.has(next) && !reached.has(next)) { reached.add(next);queue.push(next); }
        }
        assert.ok([...reached].some(id=>byId.get(id).y===0),'Upper attachment is not already connected to ground');
      }
    }
    if(step.kind==='build') for(const id of step.newBrickIds) valid.add(id);
  }
}
export async function benchmarkAssemblySequence({referenceReportPath,dataRoot}={}) {
if(!referenceReportPath) throw new Error('An explicit curated referenceReportPath is required.');
const directory = path.join(resolvePrivateDataRoot({sourceRoot:root,dataRoot}),'assembly-sequence');
const index = JSON.parse(await readFile(`${root}public/examples/index.json`,'utf8'));
const previous = JSON.parse(await readFile(referenceReportPath,'utf8'));
const report = {createdAt:new Date().toISOString(),scope:'Saved Shapes42–47, both baseline and adjusted fixed placements. Local sequencing only; no generation, repacking changes, or physical certification.',files:{},results:[]};
for (const path of ['src/assembly.js','src/assembly-sequence.js','src/construction.js']) report.files[path]=hash(await readFile(root+path));
await ensurePrivateDirectory(directory);
for (let shape=42;shape<=47;shape++) {
  const entry=index.find(item=>item.shape===shape);
  if(!entry) throw new Error(`Curated Shape ${shape} is unavailable.`);
  const bytes = await readFile(`${root}public${entry.url}`);
  const rawModel = JSON.parse(bytes);
  const rawBefore = JSON.stringify(rawModel);
  for (const adjustments of [false,true]) {
    const variant = adjustments?'adjusted':'baseline';
    const conversionStarted = performance.now();
    const result = convertToBricks({rawModel,adjustments});
    const conversionMs = performance.now()-conversionStarted;
    const brickHash = hash(JSON.stringify(result.brickModel.bricks));
    assert.equal(brickHash,previous.results.find(row=>row.shape===shape).variants[variant].brickHash,`Shape${shape} ${variant} packing changed`);
    const baselinePlan = result.assemblyPlan ?? createAssemblyPlan({brickModel:result.brickModel});
    const sequence = sequenceAssembly({brickModel:result.brickModel,baselinePlan});
    verifyUnderAttachments(sequence.plan);
    const guide = createGuideSections(sequence.plan);
    const presentation = deriveGuidePresentation({plan:sequence.plan,guide,subject:shape===44?'pickup':shape===43?'cat':null});
    assert.deepEqual(sequence.plan.bricks,baselinePlan.bricks);
    assert.equal(JSON.stringify(rawModel),rawBefore);
    assert.equal(hash(JSON.stringify(result.brickModel.bricks)),brickHash);
    assert.equal(sequence.plan.stats.coverageComplete,true);
    assert.equal(guide.stats.coverageComplete,true);
    assert.equal(presentation.stats.coverageComplete,true);
    assert.equal(sequence.plan.inventory.reduce((sum,part)=>sum+part.count,0),sequence.plan.bricks.length);
    const row = {shape,variant,sourceHash:hash(bytes),brickHash,rawUnchanged:true,placementsUnchanged:true,geometryChange:0,colorChange:0,conversionMs,...sequence.comparison,selected:sequence.plan.stats,presentation:presentation.stats};
    report.results.push(row);
    console.log(JSON.stringify({shape,variant,roots:[row.baseline.rootFailureCount,row.selected.rootFailureCount],unresolved:[row.baseline.unresolvedBrickCount,row.selected.unresolvedBrickCount],upwardSteps:row.upwardStepCount,ms:row.sequencingMs,policy:row.selectedPolicy,rejected:row.rejectionReasons}));
    if(shape===44 && adjustments) await writeFile(`${directory}/shape44-plan.json`,JSON.stringify({brickModel:result.brickModel,plan:sequence.plan,guide,presentation},null,2)+'\n',{mode:PRIVATE_FILE_MODE});
  }
}
await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n',{mode:PRIVATE_FILE_MODE});
return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
 const index=process.argv.indexOf('--reference-report');
 await benchmarkAssemblySequence({referenceReportPath:index===-1?null:process.argv[index+1]});
}
