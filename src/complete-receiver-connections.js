import {proposeAttachmentCorridors} from './attachment-corridors.js';
import {discoverCompleteTableRecipe} from './complete-held-assemblies.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {replanRecipeTasks,replanRecipeFloors} from './recipe-tasks.js';
import {replanWorkAreaTasks} from './work-area-tasks.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {inspectConstruction} from './construction.js';
import {measureBrickDifference} from './construction-differences.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {chooseInstructionSequence} from './instruction-visibility.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=x=>[...x].sort();
const key=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`,cell=c=>`${c.x},${c.y},${c.z}`;
const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.z+a.d,b.z+b.d)>Math.max(a.z,b.z);
const supports=(a,b)=>a.y===b.y-1&&overlap(a,b);
const adjacent=(a,b)=>{const x=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),z=Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z);return x>=0&&z>=0&&(x>0||z>0);};
const cells=bs=>new Map(bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>[`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}`,b.color])));
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';
const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,steps:s.stepIds.length,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));

/** Cover every lower root of a detached component, not just its first piece. */
export function discoverReceiverConnections(result,budget) {
  const plan=result.assemblyPlan,by=new Map(plan.bricks.map(b=>[b.id,b])),owners=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const protectedIds=new Set(repeats(result).flatMap(r=>r.ids));
  const mirrored=new Set(plan.modules.flatMap(m=>m.mirroredAssembly?[m.id,m.mirroredAssembly.sourceModuleId]:[]));
  const components=plan.graph.components.filter(c=>!c.grounded&&c.brickIds.length<=8&&c.brickIds.every(id=>owners.get(id).kind==='floating'))
    .map(c=>({...c,roots:c.brickIds.filter(id=>!c.brickIds.some(other=>supports(by.get(other),by.get(id))))}));
  if(!components.length)return [];
  const parentOptions=new Map();
  for(const patch of proposeAttachmentCorridors(result,{maxAddedCells:Math.min(4,budget),maxProposals:64})) {
    const parent=owners.get(patch.anchorIds[0]);
    if(parent.brickIds.length<4||parent.brickIds.length>160||parent.kind==='floating'||parent.recipeFamily||parent.sharedHandledRecipe||parent.repeatContinuation||parent.componentRecipe||mirrored.has(parent.id)
      ||parent.brickIds.some(id=>protectedIds.has(id))||plan.steps.some(s=>s.moduleId===parent.id&&s.issues.some(i=>i.severity==='error')))continue;
    if(!parentOptions.has(parent.id))parentOptions.set(parent.id,{parent,patches:[]});
    parentOptions.get(parent.id).patches.push(patch);
  }
  const proposals=[];
  for(const {parent,patches} of [...parentOptions.values()].sort((a,b)=>plan.modules.indexOf(a.parent)-plan.modules.indexOf(b.parent))) {
    const possible=components.filter(c=>c.roots.every(id=>patches.some(p=>p.after.some(b=>supports(b,by.get(id))))));
    if(!possible.length)continue;
    // Prefer completing all fragments belonging to this receiver. Individual
    // components remain alternatives when patch interactions prevent that.
    const groups=[possible,...(possible.length>1?possible.map(c=>[c]):[])];
    const signatures=new Set();let visits=0,accepted=0;
    for(const group of groups) {
      const roots=group.flatMap(c=>c.roots),joined=group.flatMap(c=>c.brickIds);
      if(roots.length>8||joined.length>16)continue;
      const search=selected=>{
        if(++visits>128||accepted>=8)return;
        const missing=roots.find(id=>!selected.some(p=>p.after.some(b=>supports(b,by.get(id)))));
        if(!missing){const signature=selected.map(p=>p.signature).sort().join(';');if(!signatures.has(signature)){signatures.add(signature);proposals.push({parent,joined,patches:selected});accepted++;}return;}
        for(const patch of patches.filter(p=>p.after.some(b=>supports(b,by.get(missing))))) {
          if(selected.reduce((n,p)=>n+p.addedCells.length,patch.addedCells.length)>budget)continue;
          if(selected.some(p=>p.anchorIds.some(id=>patch.anchorIds.includes(id))||p.after.some(a=>patch.after.some(b=>a.y===b.y&&overlap(a,b)))))continue;
          search([...selected,patch]);
        }
      };
      search([]);
    }
  }
  return proposals;
}

function receivingCourses(plan,parent,joined,identified,remap) {
  if(parent.buildContext?.kind!=='work-surface'||plan.moduleRecipes?.[parent.id]
    ||plan.steps.some(s=>s.moduleId===parent.id&&s.nestedRecipe))return null;
  const sources=plan.steps.filter(s=>s.moduleId===parent.id&&s.newBrickIds.length),by=new Map(identified.map(b=>[b.id,b]));
  const groups=sources.map(s=>remap(s.newBrickIds)),assignments=new Map();
  for(const id of [...joined].sort((a,b)=>by.get(a).y-by.get(b).y)) {
    const brick=by.get(id),supportIds=identified.filter(b=>supports(b,brick)).map(b=>b.id);
    const last=groups.findLastIndex(g=>g.some(id=>supportIds.includes(id)));
    const destination=groups.findIndex((g,i)=>i>last&&g.every(id=>by.get(id).y===brick.y)&&g.some(id=>adjacent(by.get(id),brick)));
    if(last<0||destination<0)return null;
    groups[destination].push(id);assignments.set(id,sources[destination].id);
  }
  return {groups,assignments};
}

function reconstruct(before,{parent,joined,patches}) {
  const old=before.assemblyPlan,moved=new Set(joined),removed=new Set(patches.flatMap(p=>p.anchorIds));
  const brickModel={...before.brickModel,bricks:[...old.bricks.filter(b=>!removed.has(b.id)).map(({id,...b})=>b),...patches.flatMap(p=>p.after)]};
  const identified=createAssemblyPlan({brickModel}).bricks,byKey=new Map(identified.map(b=>[key(b),b.id]));
  const replacements=new Map(patches.flatMap(p=>p.anchorIds.map(id=>[id,p.after.map(b=>byKey.get(key(b)))]))),remap=ids=>[...new Set(ids.flatMap(id=>replacements.get(id)??[id]))];
  const membership=remap([...parent.brickIds,...joined]),bs=identified.filter(b=>membership.includes(b.id)),courses=receivingCourses(old,parent,joined,identified,remap);
  const discovered=courses?null:discoverCompleteTableRecipe(bs);
  const moduleReplay=recipeReplay(old,{preservePlacements:true}).map(m=>m.id===parent.id?{...m,brickIds:membership,brickOrder:membership,
    ...(courses?{brickOrder:courses.groups.flat(),actionOrder:true,placementGroups:courses.groups,buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:
    {actionOrder:false,placementGroups:undefined,kind:'detail',groupType:'work-surface',buildContext:{kind:'work-surface',floorY:discovered.floor,joinDirection:'down'}})}:
    restrictRecipe(m,m.brickIds.filter(id=>!moved.has(id)))).filter(m=>m.brickIds.length);
  const moduleRecipes={...replayNestedRecipes(old),...(discovered?{[parent.id]:discovered.recipe}:{})};
  const plan=createAssemblyPlan({brickModel,moduleReplay,moduleRecipes,integratedBuild:old.integratedBuild??false,allowUnderAttachments:true,
    allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  const changed=new Set([parent.id,...old.modules.filter(m=>m.brickIds.some(id=>moved.has(id))).map(m=>m.id)]),parentIds=new Set(parent.brickIds);
  const indices=new Map(old.steps.map((s,i)=>[s.id,i]));
  const adapt=p=>({...p,steps:p.steps.map(s=>{
    const sources=s.sourceStepIds??[s.id],end=Math.max(...sources.map(id=>indices.get(id)));
    const introduced=courses?[...courses.assignments].filter(([,source])=>sources.includes(source)).map(([id])=>id):[];
    const visible=s.moduleId===parent.id&&courses?[...courses.assignments].filter(([,source])=>end>=indices.get(source)).map(([id])=>id):s.moduleId!==parent.id&&s.visibleBrickIds.some(id=>parentIds.has(id))?joined:[];
    return {...s,newBrickIds:remap([...s.newBrickIds.filter(id=>!moved.has(id)),...introduced]),
      highlightBrickIds:remap([...s.highlightBrickIds.filter(id=>!moved.has(id)),...introduced,...(courses&&s.moduleId===parent.id&&s.kind==='join'?joined:[])]),
      visibleBrickIds:remap([...s.visibleBrickIds.filter(id=>!moved.has(id)),...visible])};
  })});
  const expected={...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)};
  let candidate=retainUnchangedDiagrams(expected,restoreUnchangedRecipeMetadata(before,prepareAssemblyGuide({...before,brickModel,assemblyPlan:plan},{moduleReplay})));
  const regroup=new Set([...changed].filter(id=>!courses||id!==parent.id));
  candidate=replanWorkAreaTasks(replanRecipeFloors(replanRecipeTasks(candidate,{moduleIds:regroup}),{moduleIds:regroup}),{consolidateCourses:true,moduleIds:regroup});
  candidate=retainUnchangedDiagrams(expected,candidate);
  return {candidate,expected,changed};
}

function validate(before,after,expected,changed,proposal) {
  const old=before.assemblyPlan,next=after.assemblyPlan,priorCells=cells(old.bricks),nextCells=cells(next.bricks),added=new Map(proposal.patches.flatMap(p=>p.addedCells.map(c=>[cell(c),c.color])));
  if([...priorCells].some(([k,c])=>nextCells.get(k)!==c)||[...nextCells].some(([k,c])=>!priorCells.has(k)&&added.get(k)!==c)
    ||[...added].some(([k,c])=>priorCells.has(k)||nextCells.get(k)!==c))throw Error('Geometry differs from declared covered additions');
  const oldBad=unresolvedCells(old),bad=unresolvedCells(next);
  if(bad.size>=oldBad.size||[...bad].some(c=>!oldBad.has(c)))throw Error('Failed geometry did not improve');
  const steps=next.steps.filter(s=>s.moduleId===proposal.parent.id);
  if(steps.some(s=>s.issues.length)||!steps.some(s=>s.kind==='join'&&!s.nestedRecipe&&s.joinContext))throw Error('Receiver or insertion incomplete');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id))||!same(sorted(next.steps.flatMap(s=>s.newBrickIds)),sorted(next.bricks.map(b=>b.id))))throw Error('Incomplete source coverage');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)) {
    const current=next.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&s.nestedRecipe?.id===join.nestedRecipe?.id);
    if(!current||current.issues.length||direction(current)!==direction(join)||!same(contactCells(old,join),contactCells(next,current)))throw Error('Established attachment changed');
  }
  const tasks=p=>p.steps.filter(s=>!changed.has(s.moduleId)).map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds,visible:sorted(s.visibleBrickIds),issues:s.issues,direction:direction(s)}));
  if(!same(tasks(expected.instructionPlan),tasks(after.instructionPlan)))throw Error('Unrelated tasks changed');
  if(!same(repeats(before),repeats(after)))throw Error('Established repetition changed');
  const handling=assessWorkSurfaceQuality(next).modules,prior=assessWorkSurfaceQuality(old).modules;
  if(handling.some(m=>m.finalComponentCount!==1))throw Error('Assembly cannot be lifted together');
  for(const previous of prior){const current=handling.find(m=>m.moduleId===previous.moduleId),allowance=changed.has(previous.moduleId)?proposal.joined.length+added.size:0;
    if(!current||['peakLooseBrickCount','peakComponentCount','firstBondAtAddition'].some(k=>current[k]>previous[k]+allowance)
      ||current.detachedBrickExposure>previous.detachedBrickExposure+allowance*current.introducedBrickCount)throw Error('Established handling worsened beyond repair');}
  const views=chooseInstructionSequence(after.instructionPlan);
  if(after.instructionPlan.steps.filter(s=>s.moduleId===proposal.parent.id&&s.kind==='build'&&direction(s)!=='up').some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))throw Error('Receiver additions obscured');
  const extra=steps.filter(s=>s.kind==='join').length-old.steps.filter(s=>s.moduleId===proposal.parent.id&&s.kind==='join').length;
  if(count(after)>count(before)+Math.max(0,extra))throw Error('Repair fragments the guide');
  if(after.instructionPlan.steps.some(s=>s.tableRecipe&&!after.instructionPlan.steps.some(t=>t.id===s.tableRecipe.completionStepId)))throw Error('Stale recipe reference');
  const diagnostics=inspectConstruction(after.brickModel);if(diagnostics.stats.collisionPairCount||diagnostics.stats.illegalFootprintCount)throw Error('Invalid bricks');
  return {diagnostics,handling:handling.filter(m=>m.moduleId===proposal.parent.id).map(({stepStates,...s})=>s)};
}

export function completeReceiverConnections(before,{allowExtensions=false,rawModel=null}={}) {
  if(!allowExtensions||!before.assemblyPlan?.stats.unresolvedBrickCount||!before.instructionPlan||before.assemblyError
    ||before.brickModel.bricks.length>1000||before.receiverConnectionCompletion?.selected||!rawModel&&before.metrics?.geometryDifferenceRatio!==undefined)return before;
  const priorAdded=before.metrics?.structuralAddedMappedCellCount??0,originalCells=cells(before.brickModel.bricks).size-priorAdded;
  const budget=Math.max(0,Math.min(24,Math.max(4,Math.floor(originalCells*.01)))-priorAdded);
  let current=before,checks=0;const attempts=[],added=[];
  for(let round=0;round<4&&added.length<budget&&checks<16;round++) {
    let selected=false;
    for(const proposal of discoverReceiverConnections(current,budget-added.length).slice(0,16))try {
      if(++checks>16)break;
      const {candidate,expected,changed}=reconstruct(current,proposal),evidence=validate(current,candidate,expected,changed,proposal);
      attempts.push({parentId:proposal.parent.id,joined:proposal.joined,selected:true,addedCells:proposal.patches.flatMap(p=>p.addedCells),before:count(current),after:count(candidate),handling:evidence.handling});
      current={...candidate,diagnostics:evidence.diagnostics};added.push(...proposal.patches.flatMap(p=>p.addedCells));selected=true;break;
    }catch(error){attempts.push({parentId:proposal.parent.id,selected:false,reasons:[error.message]});}
    if(!selected)break;
  }
  if(current===before)return attempts.length?{...before,receiverConnectionCompletion:{selected:false,attempts}}:before;
  const partHistogram={};for(const b of current.brickModel.bricks){const k=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;partHistogram[k]=(partHistogram[k]??0)+1;}
  return {...current,metrics:{...current.metrics,...(rawModel?measureBrickDifference(rawModel,current.brickModel):{}),brickCount:current.brickModel.bricks.length,partHistogram,
    structuralAddedMappedCellCount:priorAdded+added.length},assemblyEvaluation:{...current.assemblyEvaluation,after:assessAssemblyQuality(current.assemblyPlan)},
    receiverConnectionCompletion:{selected:true,budget,addedCells:added,attempts}};
}
