import {workingFrameProposals} from './working-frame-packing.js';
import {discoverInvertedCore} from './inverted-component-recipes.js';
import {recipeWorkingFrame} from './recipe-working-frame.js';
import {discoverLayeredComponentRecipe} from './component-recipe-discovery.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeBrickId} from './assembly-recipes.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {replanRecipeTasks,replanRecipeFloors,replanSupportedRecipeCourses} from './recipe-tasks.js';
import {prepareNestedRecipePresentation} from './nested-recipe-presentation.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells,packingProfile} from './refine-construction.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {proposeConnectedPacking} from './connected-packing.js';
import {inspectConstruction} from './construction.js';
const requireEqual=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Recipe replay must preserve exact geometry and canonical coverage');};
import {chooseInstructionSequence} from './instruction-visibility.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
const key=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`,sorted=xs=>[...xs].sort();
function replayRepair(before,patch){
 const old=before.assemblyPlan,byKey=new Map(old.bricks.map(b=>[key(b),b])),byId=new Map(old.bricks.map(b=>[b.id,b])),owner=new Map(old.modules.flatMap(m=>m.brickIds.map(id=>[id,m]))),component=new Map(old.graph.components.flatMap(c=>c.brickIds.map(id=>[id,c])));
 const touched=patch.before.map(b=>byKey.get(key(b))),anchors=touched.filter(b=>component.get(b.id).grounded),parents=[...new Set(anchors.map(b=>owner.get(b.id)))];
 if(parents.length!==1||!parents[0].buildContext)throw Error('One table receiver required');
 const parent=parents[0];if(['recipeFamily','sharedHandledRecipe','repeatContinuation','mirroredAssembly'].some(k=>parent[k]))throw Error('Protected receiving recipe');
 const joined=new Set(touched.filter(b=>!component.get(b.id).grounded).flatMap(b=>component.get(b.id).brickIds));
 if(!joined.size||[...joined].some(id=>owner.get(id).kind!=='floating'))throw Error('Complete detached components required');
 const scopes=[...new Set(anchors.map(b=>old.steps.find(s=>s.newBrickIds.includes(b.id))?.nestedRecipe?.id))];
 if(scopes.length!==1||!scopes[0])throw Error('One nested receiving scope required');
 const scope=scopes[0],recipes=replayNestedRecipes(old),root=recipes?.[parent.id];if(!root)throw Error('Missing receiver recipe');
 const removed=new Set(touched.map(b=>b.id)),retainedMoved=[...joined].filter(id=>!removed.has(id)).map(id=>byId.get(id));
 const brickModel={...before.brickModel,bricks:patch.bricks},identified=createAssemblyPlan({brickModel}).bricks,newByKey=new Map(identified.map(b=>[key(b),b]));
 const added=[...patch.after,...retainedMoved].map(b=>newByKey.get(key(b))),affectedOriginal=new Set([...removed,...joined]);let leafOld=[],leafNew=[],changedRecipePath=scope;
 function update(recipe,path,floor,members){
  if(Object.entries(recipe.moduleRecipes??{}).some(([id,r])=>r.orientation==='inverted'&&scope.startsWith(path+'/'+id+'/'))){
   const parts=[...members.filter(b=>!affectedOriginal.has(b.id)),...added];
   const discovered=discoverInvertedCore(parts,{allowMixedMaterials:true});
   if(!discovered.candidate)throw Error('Changed working component has no complete recipe: '+JSON.stringify(discovered.attempts));
   if(discovered.candidate.floor!==floor)throw Error('Changed working recipe floor');
   leafOld=members.map(b=>b.id);leafNew=parts.map(b=>newByKey.get(key(b)).id);changedRecipePath=path;
   return discovered.candidate.recipe;
  }
  const frame=recipeWorkingFrame(recipe,members,floor);
  const localOld=new Map(members.map(b=>[recipeBrickId(frame.toLocal(b)),b]));
  let completeReplacement=null;
  const next={...recipe,moduleReplay:recipe.moduleReplay.map(child=>{
   const childPath=path+'/'+child.id;if(scope!==childPath&&!scope.startsWith(childPath+'/'))return child;
   const original=child.brickIds.map(id=>localOld.get(id));if(original.some(b=>!b))throw Error('Unresolved local ownership');
   const parts=[...original.filter(b=>!affectedOriginal.has(b.id)),...added];
   const local=parts.map(b=>recipeBrickId(frame.toLocal(b)));
   if(new Set(local).size!==local.length)throw Error('Duplicate moved ownership');
   if(scope===childPath){
    if(recipe.moduleRecipes?.[child.id])throw Error('Expected terminal recipe scope');
    leafOld=original.map(b=>b.id);leafNew=parts.map(b=>newByKey.get(key(b)).id);
    if(recipe.moduleReplay.length===1&&!frame.inverted){const discovered=discoverLayeredComponentRecipe(parts);if(discovered.floor!==floor)throw Error('Changed recipe floor');completeReplacement=discovered.recipe;}
    const localParts=parts.map(frame.toLocal);
    const groups=[...new Set(localParts.map(b=>b.y))].sort((a,b)=>a-b).map(y=>localParts.filter(b=>b.y===y).toSorted((a,b)=>a.z-b.z||a.x-b.x).map(recipeBrickId));
    return {...child,brickIds:local,brickOrder:groups.flat(),placementGroups:frame.inverted?groups:undefined,actionOrder:frame.inverted};
   }
   return {...child,brickIds:local,brickOrder:local,actionOrder:false,placementGroups:undefined};
  })};
  if(completeReplacement)return completeReplacement;
  delete next.diagramGroups;
  if(recipe.moduleRecipes){next.moduleRecipes={...recipe.moduleRecipes};for(const child of recipe.moduleReplay){const path2=path+'/'+child.id;if(scope.startsWith(path2+'/'))next.moduleRecipes[child.id]=update(recipe.moduleRecipes[child.id],path2,floor+(child.buildContext?.floorY??0),child.brickIds.map(id=>localOld.get(id)));}}
  return next;
 }
 recipes[parent.id]=update(root,parent.id,parent.buildContext.floorY,parent.brickIds.map(id=>byId.get(id)));
 const rootNew=[...parent.brickIds.filter(id=>!affectedOriginal.has(id)),...added.map(b=>b.id)];
 const replay=recipeReplay(old,{preservePlacements:true}).map(m=>m.id===parent.id?{...m,brickIds:rootNew,brickOrder:rootNew,placementGroups:undefined,actionOrder:false}:restrictRecipe(m,m.brickIds.filter(id=>!joined.has(id)))).filter(m=>m.brickIds.length);
 const plan=createAssemblyPlan({brickModel,moduleReplay:replay,moduleRecipes:recipes,integratedBuild:old.integratedBuild??false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
 const changed=new Set([...leafOld,...joined]);
 const adapt=p=>({...p,steps:p.steps.filter(s=>!s.newBrickIds.some(id=>joined.has(id))).map(s=>{
  const completed=leafOld.every(id=>s.visibleBrickIds.includes(id));
  if(!completed)return s;
  const visible=[...new Set([...s.visibleBrickIds.filter(id=>!changed.has(id)),...leafNew])];
  const highlight=s.kind==='join'&&leafOld.every(id=>s.highlightBrickIds.includes(id))?[...s.highlightBrickIds.filter(id=>!changed.has(id)),...leafNew]:s.highlightBrickIds;
  return {...s,visibleBrickIds:visible,highlightBrickIds:highlight};
 })});
 const expected={...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)};
 // Changed leaf tasks are rebuilt; preserve tasks only in all other scopes.
 expected.instructionPlan.steps=expected.instructionPlan.steps.filter(s=>!s.nestedRecipe?.id?.startsWith(changedRecipePath+'/')&&s.nestedRecipe?.id!==changedRecipePath);
 let candidate=retainUnchangedDiagrams(expected,restoreUnchangedRecipeMetadata(expected,prepareAssemblyGuide({...before,brickModel,assemblyPlan:plan},{moduleReplay:replay})),{omittedContextIds:joined});
 const moduleIds=new Set([parent.id]);candidate=replanSupportedRecipeCourses(replanRecipeFloors(replanRecipeTasks(candidate,{moduleIds}),{moduleIds}),{moduleIds});candidate=prepareNestedRecipePresentation(candidate);
 const priorCells=packingProfile(before.brickModel.bricks).cells,currentCells=packingProfile(candidate.brickModel.bricks).cells;requireEqual([...priorCells].map(([k,c])=>[k,c.color]).sort(),[...currentCells].map(([k,c])=>[k,c.color]).sort());
 const oldBad=unresolvedCells(old),bad=unresolvedCells(candidate.assemblyPlan);const reasons=[];
 if(bad.size>=oldBad.size||[...bad].some(c=>!oldBad.has(c)))reasons.push('Unresolved cells did not improve');
 for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
  const next=candidate.assemblyPlan.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&s.nestedRecipe?.id===join.nestedRecipe?.id);
  if(!next||next.issues.length||JSON.stringify(contactCells(old,join))!==JSON.stringify(contactCells(candidate.assemblyPlan,next)))reasons.push('Prior attachment changed: '+join.id);
 }
 const reviewIds=new Set(old.modules.filter(m=>m.kind==='floating').flatMap(m=>m.brickIds));
 const prefix=changedRecipePath===scope?scope.slice(0,scope.lastIndexOf('/'))+'/':changedRecipePath+'/',within=s=>s.nestedRecipe?.id?.startsWith(prefix);
 const changedIds=new Set([...old.steps,...candidate.assemblyPlan.steps].filter(within).flatMap(s=>s.newBrickIds));
 const payload=s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:sorted(s.highlightBrickIds.filter(id=>!changedIds.has(id)&&!reviewIds.has(id))),visible:sorted(s.visibleBrickIds.filter(id=>!changedIds.has(id)&&!reviewIds.has(id))),direction:s.insertionDirection??'down',issues:s.issues,scopes:(s.nestedRecipePath??(s.nestedRecipe?[s.nestedRecipe]:[])).map(x=>[x.id,x.floorY,x.separate])});
 const outside=r=>r.instructionPlan.steps.filter(s=>!within(s)&&!s.newBrickIds.some(id=>reviewIds.has(id))&&s.kind!=='unresolved').map(payload);
 if(JSON.stringify(outside(candidate))!==JSON.stringify(outside(before)))reasons.push('Outside tasks changed');
 const repeated=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({count:s.repeatCount,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
 if(JSON.stringify(repeated(candidate))!==JSON.stringify(repeated(before)))reasons.push('Repeated recipes changed');
 const views=chooseInstructionSequence(candidate.instructionPlan);
 if(candidate.instructionPlan.steps.filter(s=>within(s)&&s.kind==='build').some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))reasons.push('New recipe additions obscured');
 const handling=r=>assessWorkSurfaceQuality(r.assemblyPlan,{moduleIds:new Set([parent.id])}).modules[0];
 const priorHandling=handling(before),nextHandling=handling(candidate),extra=Math.max(0,rootNew.length-parent.brickIds.length);
 if(nextHandling.finalComponentCount!==1||nextHandling.peakLooseBrickCount>priorHandling.peakLooseBrickCount+extra+2||nextHandling.firstBondAtAddition>priorHandling.firstBondAtAddition+extra+2)reasons.push('Handling worsened beyond added component');
 if(createBookletPresentation(candidate).numbering.diagramCount>createBookletPresentation(before).numbering.diagramCount+3)reasons.push('Guide fragmented');
 requireEqual(candidate.instructionPlan.steps.flatMap(s=>s.sourceStepIds),candidate.assemblyPlan.steps.map(s=>s.id));
 return {candidate,report:{parent:parent.id,scope,joined:joined.size,leafBefore:leafOld.length,leafAfter:leafNew.length,before:createBookletPresentation(before).numbering.diagramCount,after:createBookletPresentation(candidate).numbering.diagramCount,unresolved:candidate.assemblyPlan.stats.unresolvedBrickCount,beforeFailedCells:oldBad.size,afterFailedCells:bad.size,reasons}};
}

/** Rebuild a changed nested receiver without discarding successful sibling recipes. */
export function completeNestedDetachedComponents(before,{workingOrientation=false}={}){
 const receiptKey=workingOrientation?'workingDetachedCompletion':'nestedDetachedCompletion';
 if(!before.assemblyPlan?.stats.unresolvedBrickCount||!before.instructionPlan||before.assemblyError
   ||before.brickModel.bricks.length>1000||!before.assemblyPlan.moduleRecipes
   ||before[receiptKey]?.selected)return before;
 let current=before;const attempts=[],selected=[];
 const initialCount=createBookletPresentation(before).numbering.diagramCount;
 for(let round=0;round<4&&attempts.length<32;round++){
  const floating=new Set(current.assemblyPlan.modules.filter(m=>m.kind==='floating').flatMap(m=>m.brickIds));let accepted;
  if(!floating.size)break;
  for(const parent of current.assemblyPlan.modules.filter(m=>m.buildContext).slice(0,4)){
   const ids=new Set([...parent.brickIds,...floating]);
   const proposals=workingOrientation?workingFrameProposals(current,parent,floating)
     :proposeConnectedPacking(current.brickModel,{region:current.assemblyPlan.bricks.filter(b=>ids.has(b.id)),maxChecks:256,maxCandidates:8,diverseInterfaces:true}).proposals;
   for(const patch of proposals){
    if(attempts.length>=32)break;
    try{
     const {candidate,report}=replayRepair(current,patch);
     if(report.after>initialCount+3)report.reasons.push('Whole-guide fragmentation accumulated');
     attempts.push({round,...report});
     if(!report.reasons.length){accepted=candidate;selected.push({...report,patch:{before:patch.before,after:patch.after}});break;}
    }catch(error){attempts.push({round,parent:parent.id,error:error.message});}
   }
   if(accepted)break;
  }
  if(!accepted)break;current=accepted;
 }
 // Keep every receipt, guide reference and cached family exact on a no-op.
 if(!selected.length)return before;
 const partHistogram={};for(const b of current.brickModel.bricks){const key=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;partHistogram[key]=(partHistogram[key]??0)+1;}
 return {...current,metrics:{...current.metrics,brickCount:current.brickModel.bricks.length,partHistogram},diagnostics:inspectConstruction(current.brickModel),
   [receiptKey]:{selected:true,attempts,completed:selected}};
}
