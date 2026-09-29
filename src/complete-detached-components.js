import {proposeConnectedPacking} from './connected-packing.js';
import {mapAssemblyModules} from './assembly-module-replay.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {retainUnchangedDiagrams,refreshTableRecipeReferences} from './preserve-instruction-diagrams.js';
import {refineOfflineRecipes} from './offline-recipes.js';
import {unresolvedCells} from './refine-construction.js';
import {restoreRepeatedOrder,contactCells} from './local-interface-repair.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {inspectConstruction} from './construction.js';

const key=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const sorted=ids=>[...ids].sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const cells=bs=>bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();
const count=r=>createBookletPresentation(r).numbering.diagramCount;

function proposalsFor(result){
  const plan=result.assemblyPlan,owners=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const components=new Map(plan.graph.components.flatMap(c=>c.brickIds.map(id=>[id,c]))),byKey=new Map(plan.bricks.map(b=>[key(b),b]));
  const floating=plan.modules.filter(m=>m.kind==='floating').flatMap(m=>m.brickIds),options=[];
  for(const parent of plan.modules.filter(m=>m.buildContext?.kind==='work-surface'&&!m.sharedHandledRecipe).slice(0,4)){
    const regionIds=new Set([...parent.brickIds,...floating]);
    const packingOptions={maxChecks:256,maxCandidates:8,diverseInterfaces:true,region:plan.bricks.filter(b=>regionIds.has(b.id))};
    let generated=proposeConnectedPacking(result.brickModel,packingOptions);
    if(!generated.proposals.length)generated=proposeConnectedPacking(result.brickModel,{...packingOptions,workSurfaceFloorY:parent.buildContext.floorY});
    for(const patch of generated.proposals){
      const touched=patch.before.map(b=>byKey.get(key(b)));
      const anchors=[...new Set(touched.filter(b=>components.get(b.id).grounded).map(b=>owners.get(b.id)))];
      if(anchors.length!==1||anchors[0]!==parent)continue;
      const joined=new Set(touched.filter(b=>!components.get(b.id).grounded).flatMap(b=>components.get(b.id).brickIds));
      if(!joined.size||[...joined].some(id=>owners.get(id).kind!=='floating'))continue;
      options.push({patch,parent,joined});
    }
  }
  return options;
}

function replayCandidate(before,{patch,parent,joined}){
  const old=before.assemblyPlan;
  // Move the entire connected fragment, including its dependents, before
  // mapping a seam replacement. A disconnected review bin is not a recipe.
  const reassigned={...old,modules:old.modules.map(m=>({...m,brickIds:m.id===parent.id?[...m.brickIds,...joined]:m.brickIds.filter(id=>!joined.has(id))})).filter(m=>m.brickIds.length),
    steps:[...old.steps.map(s=>({...s,newBrickIds:s.newBrickIds.filter(id=>!joined.has(id))})),{moduleId:parent.id,newBrickIds:[...joined]}]};
  const mapped=mapAssemblyModules(reassigned,{before:patch.before,after:patch.after});
  const brickModel={...before.brickModel,bricks:patch.bricks},identified=createAssemblyPlan({brickModel}).bricks,byId=new Map(identified.map(b=>[b.id,b]));
  const moduleReplay=mapped.map(m=>{
    let groups=old.steps.filter(s=>s.moduleId===m.id).map(s=>s.newBrickIds.filter(id=>!joined.has(id))).filter(g=>g.length);
    if(m.id===parent.id){const bs=m.brickIds.map(id=>byId.get(id));groups=[...new Set(bs.map(b=>b.y))].sort((a,b)=>a-b).map(y=>bs.filter(b=>b.y===y).map(b=>b.id));}
    return {...m,brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(m.buildContext?{buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:{})};
  });
  let plan=createAssemblyPlan({brickModel,moduleReplay,moduleRecipes:old.moduleRecipes??null,integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  for(const m of plan.modules){
    const previous=old.modules.find(t=>t.id===m.id);
    for(const field of ['recipeFamily','sharedHandledRecipe','localInterfaceRepair'])if(previous[field])m[field]=structuredClone(previous[field]);
    if(previous.repeatContinuation){const source=old.steps.find(s=>s.id===previous.repeatContinuation.joinSourceStepId),join=plan.steps.find(s=>s.moduleId===source?.moduleId&&s.kind==='join');if(join)m.repeatContinuation={...previous.repeatContinuation,joinSourceStepId:join.id};}
  }
  plan=restoreRepeatedOrder(plan);
  const compact=compactAssemblyPlan(plan);
  let candidate={...before,brickModel,assemblyPlan:plan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan)};
  const priorAnchor=new Set(parent.brickIds),nextAnchor=plan.modules.find(m=>m.id===parent.id).brickIds;
  // Later diagrams should see the completed repaired assembly. Updating that
  // background is not permission to discard their existing task boundaries.
  const adapt=p=>({...p,steps:p.steps.map(s=>s.moduleId!==parent.id&&parent.brickIds.every(id=>s.visibleBrickIds.includes(id))
    ?{...s,visibleBrickIds:[...s.visibleBrickIds.filter(id=>!priorAnchor.has(id)&&!joined.has(id)),...nextAnchor]}:s)});
  candidate=retainUnchangedDiagrams({...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)},candidate,{omittedContextIds:joined});
  candidate=refineOfflineRecipes(candidate);
  return candidate;
}

function validate(before,after,{parent,joined}){
  const old=before.assemblyPlan,plan=after.assemblyPlan,reasons=[];
  if(!same(cells(old.bricks),cells(plan.bricks)))reasons.push('Occupied geometry changed');
  const previous=unresolvedCells(old),next=unresolvedCells(plan);
  if(next.size>=previous.size||[...next].some(c=>!previous.has(c)))reasons.push('Unresolved geometry did not improve');
  const target=plan.steps.filter(s=>s.moduleId===parent.id);
  if(target.some(s=>s.issues.length)||target.filter(s=>s.kind==='join').length!==1)reasons.push('Incomplete receiving assembly');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const repaired=plan.steps.find(s=>s.moduleId===join.moduleId&&s.kind==='join');
    if(!repaired||repaired.issues.length||!same(contactCells(old,join),contactCells(plan,repaired)))reasons.push('Prior attachment changed');
  }
  const affected=new Set([parent.id,...old.modules.filter(m=>m.brickIds.some(id=>joined.has(id))).map(m=>m.id)]);
  const affectedBricks=new Set([...old.modules,...plan.modules].filter(m=>affected.has(m.id)).flatMap(m=>m.brickIds));
  const normalize=r=>r.instructionPlan.steps.filter(s=>!affected.has(s.moduleId)).map(s=>({moduleId:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds,
    visible:sorted(s.visibleBrickIds.filter(id=>!affectedBricks.has(id))),direction:s.insertionDirection??'down',issues:s.issues.map(i=>({...i,...(i.brickIds?{brickIds:sorted(i.brickIds)}:{})}))}));
  if(!same(normalize(before),normalize(after)))reasons.push('Outside diagrams changed');
  const repeated=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
  if(!same(repeated(before),repeated(after)))reasons.push('Existing repetition changed');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id))||!same(sorted(plan.steps.flatMap(s=>s.newBrickIds)),sorted(plan.bricks.map(b=>b.id))))reasons.push('Incomplete coverage');
  const quality=p=>assessWorkSurfaceQuality(p,{moduleIds:new Set([parent.id])}).modules.map(({stepStates,...m})=>m)[0];
  const handlingBefore=quality(old),handlingAfter=quality(plan),addedPieces=Math.max(0,handlingAfter.introducedBrickCount-handlingBefore.introducedBrickCount);
  if(handlingAfter.finalComponentCount!==1||handlingAfter.peakLooseBrickCount>handlingBefore.peakLooseBrickCount+addedPieces+2
    ||handlingAfter.firstBondAtAddition>handlingBefore.firstBondAtAddition+addedPieces+2)reasons.push('Receiving layout becomes harder than the added fragment requires');
  const views=chooseInstructionSequence(after.instructionPlan);
  if(after.instructionPlan.steps.filter(s=>s.moduleId===parent.id&&s.kind==='build').some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))reasons.push('New recipe is obscured');
  if(count(after)>count(before)+3)reasons.push('Repair fragments the guide');
  const diagnostics=inspectConstruction(after.brickModel);
  if(diagnostics.stats.collisionPairCount||diagnostics.stats.illegalFootprintCount)reasons.push('Invalid geometry');
  return {reasons,handlingBefore,handlingAfter,diagnostics};
}

/** Complete existing table assemblies with their detached connected fragments. */
export function completeDetachedComponents(before){
  if(before.instructionPlan){
    const steps=refreshTableRecipeReferences(before.instructionPlan.steps);
    if(steps.some((s,i)=>s!==before.instructionPlan.steps[i])){
      const instructionPlan={...before.instructionPlan,steps};
      before={...before,instructionPlan,guide:createGuideSections(instructionPlan)};
    }
  }
  if(!before.assemblyPlan?.stats.unresolvedBrickCount||!before.instructionPlan||before.assemblyError||before.brickModel.bricks.length>800
    ||before.detachedComponentCompletion?.selected||before.assemblyPlan.steps.some(s=>s.nestedRecipe))return before;
  let current=before,checks=0;const attempts=[],accepted=[];
  const originalHandling=new Map(assessWorkSurfaceQuality(before.assemblyPlan).modules.map(m=>[m.moduleId,m]));
  for(let round=0;round<12&&checks<32;round++){
    let selected;
    for(const proposal of proposalsFor(current)){
      if(++checks>32)break;
      try{
        const candidate=replayCandidate(current,proposal),validation=validate(current,candidate,proposal);
        const receipt={round,parentId:proposal.parent.id,joinedBrickIds:[...proposal.joined],beforeUnresolved:current.assemblyPlan.stats.unresolvedBrickCount,
          afterUnresolved:candidate.assemblyPlan.stats.unresolvedBrickCount,beforeDiagrams:count(current),afterDiagrams:count(candidate),
          handlingBefore:validation.handlingBefore,handlingAfter:validation.handlingAfter,reasons:validation.reasons};
        if(count(candidate)>count(before)+3)receipt.reasons.push('Whole-guide fragmentation accumulated');
        const baseline=originalHandling.get(proposal.parent.id),handling=validation.handlingAfter;
        const added=Math.max(0,handling.introducedBrickCount-baseline.introducedBrickCount);
        if(handling.peakLooseBrickCount>baseline.peakLooseBrickCount+added+2||handling.firstBondAtAddition>baseline.firstBondAtAddition+added+2)receipt.reasons.push('Handling cost accumulated beyond the completed fragments');
        attempts.push(receipt);if(receipt.reasons.length)continue;
        selected={...candidate,diagnostics:validation.diagnostics};accepted.push(receipt);break;
      }catch(error){attempts.push({round,parentId:proposal.parent.id,reasons:[error.message]});}
    }
    if(!selected)break;current=selected;
  }
  if(!accepted.length)return attempts.length?{...before,detachedComponentCompletion:{selected:false,attempts}}:before;
  const partHistogram={};for(const b of current.brickModel.bricks){const k=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;partHistogram[k]=(partHistogram[k]??0)+1;}
  return {...current,metrics:{...current.metrics,brickCount:current.brickModel.bricks.length,partHistogram},
    assemblyEvaluation:{...current.assemblyEvaluation,after:assessAssemblyQuality(current.assemblyPlan),compaction:{...current.assemblyEvaluation?.compaction,brickCoverageComplete:true}},
    detachedComponentCompletion:{selected:true,attempts,accepted}};
}
