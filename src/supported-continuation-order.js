import{consolidateThinWallDiagrams}from'./thin-wall-diagrams.js';
import{assessAssemblyQuality}from'./assembly-quality.js';
import{createAssemblyPlan}from'./assembly.js';
import{recipeReplay}from'./capture-recipes.js';
import{replayNestedRecipes}from'./replay-nested-recipes.js';
import{compactAssemblyPlan}from'./assembly-diagrams.js';
import{restoreUnchangedRecipeMetadata}from'./complete-assembly-recipes.js';
import{retainUnchangedDiagrams}from'./preserve-instruction-diagrams.js';
import{createGuideSections}from'./guide-sections.js';
import{createBookletPresentation}from'./assembly-booklet-presentation.js';
import{chooseInstructionSequence}from'./instruction-visibility.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=a=>[...a].sort();
const options={allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true};
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>[s.repeatCount,s.stepIds.length,sorted(s.instances.flatMap(i=>i.brickIds))]);
export function discoverSupportedContinuations(result){
 const p=result.assemblyPlan,by=new Map(p.bricks.map(b=>[b.id,b])),owner=new Map(p.modules.flatMap((m,i)=>m.brickIds.map(id=>[id,i])));
 const repeated=new Set(repeats(result).flatMap(r=>r[2])),protectedModule=m=>m.brickIds.some(id=>repeated.has(id))||m.recipeFamily||m.repeatContinuation||m.mirroredAssembly||m.sharedHandledRecipe;
 const found=[];
 for(let from=1;from<p.modules.length;from++){
  const m=p.modules[from],steps=p.steps.filter(s=>s.moduleId===m.id);
  if(m.kind!=='grounded'||m.buildContext||p.moduleRecipes?.[m.id]||m.brickIds.length<3||protectedModule(m)
   ||!['continuation','supported-additions'].includes(m.groupType)||!steps.length
   ||steps.some(s=>s.kind!=='build'||s.issues.length||s.nestedRecipe||(s.insertionDirection??'down')!=='down'))continue;
  const dependencies=new Set();
  for(const {a,b}of p.graph.edges){const lo=by.get(a).y<by.get(b).y?a:b,hi=lo===a?b:a;if(owner.get(hi)===from&&owner.get(lo)!==from)dependencies.add(owner.get(lo));}
  if(!dependencies.size||[...dependencies].some(i=>i>=from))continue;
  const to=Math.max(...dependencies)+1,crossed=p.modules.slice(to,from);
  if(!crossed.length||crossed.some(m=>m.buildContext?.kind!=='work-surface'||protectedModule(m)
   ||p.steps.some(s=>s.moduleId===m.id&&s.issues.some(i=>i.severity==='error'))))continue;
  found.push({moduleId:m.id,from,to,crossed:crossed.map(m=>m.id),contextIds:[...m.brickIds,...crossed.flatMap(m=>m.brickIds)],dependencies:[...dependencies].map(i=>p.modules[i].id)});
 }
 return found.sort((a,b)=>(b.from-b.to)-(a.from-a.to)).slice(0,8);
}
const operation=s=>[s.moduleId,s.kind,sorted(s.newBrickIds),sorted(s.highlightBrickIds),s.issues,s.insertionDirection??'down',s.workingOrientation??null,s.nestedRecipe?.id??null,s.joinContext?.direction??null,(s.joinContext?.supportGroups.flatMap(g=>g.contacts)??[]).map(c=>JSON.stringify(c)).sort()];
const stepKey=s=>JSON.stringify([s.moduleId,s.kind,sorted(s.newBrickIds),sorted(s.highlightBrickIds),s.nestedRecipe?.id??null]);
export function planSupportedContinuation(before,proposal){
 const p=before.assemblyPlan,replay=recipeReplay(p,{preservePlacements:true}),[moving]=replay.splice(proposal.from,1);moving.groupType='supported-additions';replay.splice(proposal.to,0,moving);
 const assemblyPlan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:replayNestedRecipes(p),...options});
 const oldOps=new Map(p.steps.map(s=>[stepKey(s),operation(s)]));
 if(oldOps.size!==p.steps.length||assemblyPlan.steps.length!==p.steps.length||assemblyPlan.steps.some(s=>!same(oldOps.get(stepKey(s)),operation(s))))throw Error('Placement or attachment changed');
 for(const m of p.modules)if(!same(p.steps.filter(s=>s.moduleId===m.id).map(stepKey),assemblyPlan.steps.filter(s=>s.moduleId===m.id).map(stepKey)))throw Error('Internal task order changed');
 const compacted=compactAssemblyPlan(assemblyPlan);
 let after=retainUnchangedDiagrams(before,restoreUnchangedRecipeMetadata(before,{...before,assemblyPlan,instructionPlan:compacted.plan,guide:createGuideSections(compacted.plan)}),{changedContextIds:new Set(proposal.contextIds)});
 const diagrams=r=>r.instructionPlan.steps.map(s=>JSON.stringify([s.moduleId,s.kind,sorted(s.newBrickIds),sorted(s.highlightBrickIds),s.issues,s.insertionDirection??'down',s.workingOrientation??null])).sort();
 if(!same(diagrams(before),diagrams(after))||count(before)!==count(after))throw Error('Diagram groups changed');
 if(!same(repeats(before),repeats(after)))throw Error('Repeated recipe changed');
 const priorViews=chooseInstructionSequence(before.instructionPlan),views=chooseInstructionSequence(after.instructionPlan),key=s=>JSON.stringify([s.moduleId,s.kind,sorted(s.highlightBrickIds)]),oldBad=new Set(before.instructionPlan.steps.filter(s=>{const v=priorViews.get(s.id);return v&&(!v.passes||v.truncated);}).map(key));
 if(after.instructionPlan.steps.some(s=>{const v=views.get(s.id);return v&&(!v.passes||v.truncated)&&!oldBad.has(key(s));}))throw Error('New hidden additions');
 if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),assemblyPlan.steps.map(s=>s.id)))throw Error('Incomplete coverage');
 return after;
}
/** Finish a supported continuation before switching to unrelated handled work.
 * All placements and joins replay; existing tasks stay whole before optional
 * consolidation of the moved wall's readable courses.
 */
export function scheduleSupportedContinuations(before){
 if(before.supportedContinuationScheduling?.selected||before.assemblyError||before.semanticGuide||!before.assemblyPlan||!before.instructionPlan||before.assemblyPlan.bricks.length>1000)return before;
 const attempts=[];
 for(const proposal of discoverSupportedContinuations(before)){
  try{
   const moved=planSupportedContinuation(before,proposal);
   const {result,changes}=consolidateThinWallDiagrams(moved,proposal.moduleId);
   const p=result.assemblyPlan,q=result.instructionPlan;
   const {contextIds,...summary}=proposal;attempts.push({...summary,selected:true,wallGroups:changes});
   return {...result,supportedContinuationScheduling:{selected:true,attempts},assemblyEvaluation:{...result.assemblyEvaluation,
    after:assessAssemblyQuality(p),compaction:{...result.assemblyEvaluation?.compaction,sourceStepCount:p.steps.length,
     instructionDiagramCount:q.steps.length,collapsedStepCount:p.steps.length-q.steps.length,
     mergedDiagramCount:q.steps.filter(s=>s.sourceStepIds.length>1).length}}};
  }catch(error){const {contextIds,...summary}=proposal;attempts.push({...summary,reason:error.message});}
 }
 return attempts.length?{...before,supportedContinuationScheduling:{selected:false,attempts}}:before;
}
