import test from 'node:test';
import assert from 'node:assert/strict';
import { convertToBricks, inspectConstruction } from '../src/construction.js';
import { createAssemblyPlan } from '../src/assembly.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { proposeAttachmentCorridors } from '../src/attachment-corridors.js';
import { packingProfile } from '../src/refine-construction.js';

const brick=(x,y,z,w=1,d=1,color='blue')=>({x,y,z,w,d,color});
const input=bricks=>{
  const brickModel={version:1,kind:'bricks',bricks};
  return {brickModel,assemblyPlan:createAssemblyPlan({brickModel}),metrics:{conversionMs:0}};
};

test('thin shelf recovery retains rounded occupancy and colors without mutating the source',()=>{
  const cells=[{x:0,y:2,z:0,color:'red'},{x:0,y:3,z:0,color:'blue'},
    {x:1,y:3,z:0,color:'blue'},{x:2,y:3,z:0,color:'blue'}];
  const rawModel={version:1,kind:'voxels',cells};
  const original=structuredClone(rawModel);
  const baseline=convertToBricks({rawModel});
  const recovered=convertToBricks({rawModel,preserveThinLayers:true});
  const before=packingProfile(baseline.brickModel.bricks).cells;
  const after=packingProfile(recovered.brickModel.bricks).cells;
  for(const [key,cell] of before) assert.equal(after.get(key).color,cell.color);
  assert.equal(after.get('1,2,0').color,'blue');
  assert.equal(after.get('2,2,0').color,'blue');
  assert.equal(recovered.metrics.recoveredThinLayerCellCount,2);
  assert.equal(recovered.metrics.structuralAddedMappedCellCount,0);
  assert.deepEqual(rawModel,original);
  assert.deepEqual(convertToBricks({rawModel,preserveThinLayers:true}).brickModel,recovered.brickModel);
});

test('integrated assembly retains supported color details in their construction sequence',()=>{
  const source=input([brick(0,0,0,2,2),brick(0,1,0,1,2,'red'),brick(1,1,0,1,2,'green')]);
  const plan=createAssemblyPlan({brickModel:source.brickModel,integratedBuild:true});
  assert.equal(plan.modules.length,1);
  assert.equal(plan.stats.unresolvedBrickCount,0);
  assert.equal(plan.stats.temporaryHoldStepCount,0);
  const prepared=prepareAssemblyGuide({...source,assemblyPlan:plan});
  assert.equal(prepared.assemblyPlan.integratedBuild,true);
  assert.equal(prepared.assemblyPlan.modules.length,1);
  assert.equal(prepared.guide.stats.coverageComplete,true);
});

test('covered connector preserves every old cell and creates real stud engagement across orientations',()=>{
  const base=[brick(0,0,2,2,2),brick(0,1,1,2,2,'green'),brick(0,1,0,2,1,'red')];
  for(const mirrored of [false,true]) for(let turns=0;turns<4;turns++) {
    const bricks=base.map(b=>{
      let out={...b};
      for(let i=0;i<turns;i++) out={...out,x:-out.z-out.d,z:out.x,w:out.d,d:out.w};
      out={...out,x:out.x+8,z:out.z+8};
      return mirrored ? {...out,x:20-out.x-out.w,color:{blue:'yellow',green:'black',red:'white'}[out.color]} : out;
    });
    const result=input(bricks);
    const original=structuredClone(result);
    const proposals=proposeAttachmentCorridors(result);
    assert.ok(proposals.length);
    const before=packingProfile(bricks);
    for(const proposal of proposals) {
      const after=packingProfile(proposal.bricks);
      for(const [key,cell] of before.cells) assert.equal(after.cells.get(key)?.color,cell.color);
      const model={...result.brickModel,bricks:proposal.bricks};
      const diagnostics=inspectConstruction(model);
      assert.equal(diagnostics.stats.collisionPairCount,0);
      assert.equal(diagnostics.stats.illegalFootprintCount,0);
      assert.equal(diagnostics.stats.componentCount,1);
      assert.equal(createAssemblyPlan({brickModel:model,integratedBuild:true}).stats.unresolvedBrickCount,0);
    }
    assert.deepEqual(proposeAttachmentCorridors(result),proposals);
    assert.deepEqual(result,original);
  }
});

test('connector search leaves distant objects and unsupported open gaps alone',()=>{
  assert.deepEqual(proposeAttachmentCorridors(input([brick(0,0,0,2,2),brick(8,1,0,2,2,'red')])),[]);
  assert.deepEqual(proposeAttachmentCorridors(input([brick(0,0,2,2,2),brick(0,1,0,2,1,'red')])),[]);
  assert.deepEqual(proposeAttachmentCorridors(input([brick(0,0,2,2,2),brick(0,1,1,2,2,'green'),brick(0,1,0,2,1,'red')]),{maxAddedCells:0}),[]);
});

test('complete pickup guide has executable placements and one connected final model', async()=>{
  const {readFile}=await import('node:fs/promises');
  const {completeConstruction}=await import('../src/complete-construction.js');
  const {createBookletPresentation,createChapterDiagramData}=await import('../src/assembly-booklet-presentation.js');
  const rawModel=JSON.parse(await readFile(new URL('./fixtures/compact-pickup.json',import.meta.url)));
  const original=structuredClone(rawModel);
  const result=completeConstruction({rawModel,adjustments:true});
  assert.deepEqual(rawModel,original);
  assert.equal(result.assemblyError,undefined);
  assert.equal(result.continuityRefinement.selected,true);
  assert.equal(result.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(result.assemblyPlan.stats.temporaryHoldStepCount,0);
  assert.equal(result.diagnostics.stats.collisionPairCount,0);
  assert.equal(result.diagnostics.stats.illegalFootprintCount,0);
  assert.equal(result.workSurfaceOrdering.selected,true);
  assert.ok(result.workSurfaceOrdering.after.canonical.peakLooseBrickCount <= 3);
  assert.equal(result.workSurfaceOrdering.after.canonical.firstBondAtAddition,2);
  const plan=result.assemblyPlan;
  const byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
  // Independently replay geometric contacts and insertion paths. Do not rely on
  // planner status flags to prove that its chosen sequence can be followed.
  const placed=new Set();
  for(const step of plan.steps){
    const module=plan.modules.find(m=>m.id===step.moduleId);
    const offline=module.buildContext?.kind==='work-surface'&&step.kind!=='join';
    const scene=[...placed].map(id=>byId.get(id)).filter(b=>!offline||module.brickIds.includes(b.id));
    for(const id of step.newBrickIds){
      assert.ok(!placed.has(id),'no duplicated placement');
      const b=byId.get(id),direction=step.insertionDirection==='up'?-1:1;
      const onTable=b.y===0||(offline&&b.y===module.buildContext.floorY);
      assert.ok(onTable||scene.some(s=>s.y+direction===b.y&&overlap(s,b)),`${id}: existing stud support`);
      assert.ok(!scene.some(s=>direction*(s.y-b.y)>0&&overlap(s,b)),`${id}: clear insertion path`);
      scene.push(b);placed.add(id);
    }
    if(step.kind==='join'){
      const moving=new Set(step.highlightBrickIds);
      for(const id of moving){const b=byId.get(id);
        assert.ok(!scene.some(s=>!moving.has(s.id)&&s.y>b.y&&overlap(s,b)),'clear downward join');
      }
    }
  }
  assert.equal(placed.size,plan.bricks.length);
  const connected=new Set([plan.bricks[0]]),pending=[plan.bricks[0]];
  while(pending.length){const b=pending.pop();for(const next of plan.bricks){
    if(!connected.has(next)&&Math.abs(b.y-next.y)===1&&overlap(b,next)){connected.add(next);pending.push(next);}
  }}
  assert.equal(connected.size,plan.bricks.length);
  const displayed=result.instructionPlan.steps.flatMap(s=>s.newBrickIds);
  assert.equal(displayed.length,placed.size);
  assert.equal(new Set(displayed).size,placed.size);
  const view=createBookletPresentation(result);
  assert.equal(result.sequenceRefinement.selected,true);
  assert.equal(result.sequenceRefinement.completedBaseBricks,44);
  const baseUnits=plan.modules.filter(m=>/^Base assembly /.test(m.label));
  assert.equal(baseUnits.length,4);
  for(const unit of baseUnits){
    const bricks=unit.brickIds.map(id=>byId.get(id));
    assert.equal(Math.max(...bricks.map(b=>b.y)),4,'each base unit is completed to its top before the platform');
    const indexes=plan.steps.flatMap((step,index)=>step.moduleId===unit.id?[index]:[]);
    assert.equal(indexes.at(-1)-indexes[0]+1,indexes.length,'one uninterrupted assembly sequence');
  }
  const specs=view.presentation.sections.flatMap(s=>createChapterDiagramData(s,view.plan,view.numbering).specs);
  const join=specs.find(s=>s.joinContext?.direction==='down');
  assert.equal(join.guidance.map.contacts.length,16);
  assert.match(join.guidance.instruction,/4 assemblies/);
  assert.ok(specs.some(s=>s.guidance.instruction.includes(`Attach it in step ${join.number}`)));
  assert.ok(specs.every(s=>!s.unresolved));
  assert.equal(view.presentation.sections[0].repeatCount,4);
  assert.equal(view.presentation.sections[0].stepIds.length,5);
  assert.ok(view.numbering.diagramCount<88);
  const repeated=view.presentation.sections[0];
  assert.equal(repeated.totalInventory.reduce((n,p)=>n+p.count,0),baseUnits.reduce((n,m)=>n+m.brickIds.length,0));
  const {mapRecipe}=await import('../src/assembly-recipes.js');
  const first=baseUnits[0].brickIds.map(id=>byId.get(id));
  for(const unit of baseUnits.slice(1)) {
    const target=unit.brickIds.map(id=>byId.get(id));
    assert.ok([0,1,2,3].some(turn=>mapRecipe(first,target,turn).map(b=>b.id).sort().join('|')===unit.brickIds.toSorted().join('|')));
  }
  assert.equal(result.sequenceRefinement.geometryChanges,2);
  assert.equal(result.sequenceRefinement.colorChanges,1);
  for(const step of result.instructionPlan.steps){
    const layers=new Set(step.newBrickIds.map(id=>byId.get(id).y));
    assert.ok(layers.size<=1,'one intentional course per diagram');
  }
  const {evaluateInstructionVisibility}=await import('../src/instruction-visibility.js');
  const displayedById=new Map(view.plan.bricks.map(b=>[b.id,b]));
  for(const spec of specs.filter(s=>!s.joinContext && s.insertionDirection!=='up')){
    const options={visibleBricks:spec.visible.map(id=>displayedById.get(id)),
      highlightGroups:spec.highlight.map(id=>({id,bricks:[displayedById.get(id)]}))};
    const primary=evaluateInstructionVisibility({...options,azimuth:spec.azimuth});
    const alternate=spec.alternateAzimuth===null?null:evaluateInstructionVisibility({...options,azimuth:spec.alternateAzimuth});
    assert.equal(primary.truncated,false);
    assert.ok(primary.groups.every(g=>g.visibleBrickCount || alternate?.groups.some(a=>a.id===g.id && a.visibleBrickCount)),`${spec.stepId}: every addition visible in the offered views`);
  }
});
