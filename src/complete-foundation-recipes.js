import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {createGuideSections} from './guide-sections.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {chooseUndersideInstructionView,chooseInstructionSequence} from './instruction-visibility.js';
import {unresolvedCells} from './refine-construction.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {foundationRecipeVariants} from './foundation-working-sequence.js';
import {completeNestedCourseDiagrams} from './nested-course-diagrams.js';

const options={allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=a=>[...a].sort();
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>[s.repeatCount,s.stepIds.length,sorted(s.instances.flatMap(i=>i.brickIds))]);
const physical=s=>[s.moduleId,s.kind,s.newBrickIds,sorted(s.highlightBrickIds),sorted(s.visibleBrickIds),s.insertionDirection??'down',s.workingOrientation??null,s.issues,s.joinContext??null];

/** Match loose ground pieces to the platform they actually support. */
export function discoverFoundationRecipes(result){
 const p=result.assemblyPlan,by=new Map(p.bricks.map(b=>[b.id,b])),owner=new Map(p.modules.flatMap((m,i)=>m.brickIds.map(id=>[id,i]))),adj=new Map(p.bricks.map(b=>[b.id,new Set()]));
 for(const{a,b}of p.graph.edges){adj.get(a).add(b);adj.get(b).add(a);}
 const repeated=new Set(repeats(result).flatMap(r=>r[2])),protectedModule=m=>m.brickIds.some(id=>repeated.has(id))||m.recipeFamily||m.repeatContinuation||m.mirroredAssembly||m.sharedHandledRecipe||p.moduleRecipes?.[m.id];
 const clean=m=>!protectedModule(m)&&p.steps.filter(s=>s.moduleId===m.id).every(s=>s.issues.every(i=>i.code==='limited-support'&&i.severity==='warning')&&!s.nestedRecipe&&['build','join'].includes(s.kind));
 const claimed=new Set(),found=[];
 for(const [index,m]of p.modules.entries()){
  if(found.length===4)break;
  if(m.buildContext?.kind!=='work-surface'||m.buildContext.floorY!==1||m.brickIds.length<8||!clean(m))continue;
  const core=new Set(m.brickIds);
  const lower=[...new Set(m.brickIds.flatMap(id=>[...adj.get(id)]))].filter(id=>by.get(id).y===0&&owner.get(id)<index&&p.modules[owner.get(id)].kind==='grounded'&&!p.modules[owner.get(id)].buildContext&&clean(p.modules[owner.get(id)]));
  if(lower.length<2||lower.length>24||lower.some(id=>claimed.has(id)))continue;
  const low=new Set(lower),finish=p.bricks.filter(b=>b.y===1&&owner.get(b.id)<index&&!core.has(b.id)&&p.modules[owner.get(b.id)].kind==='grounded'&&!p.modules[owner.get(b.id)].buildContext&&clean(p.modules[owner.get(b.id)])&&[...adj.get(b.id)].some(id=>low.has(id))&&[...adj.get(b.id)].filter(id=>by.get(id).y===0).every(id=>low.has(id))).map(b=>b.id);
  const ids=[...m.brickIds,...lower,...finish];
  if(ids.length>512||ids.some(id=>claimed.has(id)))continue;
  const groups=p.steps.filter(s=>s.moduleId===m.id&&s.newBrickIds.length).map(s=>[...s.newBrickIds]);
  const recipe={kind:'foundation',moduleReplay:[{id:'core',label:'Platform',kind:'grounded',groupType:'table-root',brickIds:[...m.brickIds],brickOrder:groups.flat(),actionOrder:true,placementGroups:groups,buildContext:{...m.buildContext}},
   {id:'underside',label:'Underside',kind:'grounded',groupType:'continuation',brickIds:lower,brickOrder:lower},
   ...(finish.length?[{id:'finish',label:'Finish foundation',kind:'grounded',groupType:'supported-additions',brickIds:finish,brickOrder:finish}]:[])]};
  found.push({moduleId:m.id,ids,lower,finish,recipe});for(const id of ids)claimed.add(id);
 }
 return found;
}

function consolidateUnderside(result,parentId){
 const p=result.instructionPlan,by=new Map(p.bricks.map(b=>[b.id,b])),run=p.steps.filter(s=>s.nestedRecipe?.id===parentId+'/underside');
 if(run.length<2)return result;
 const ids=run.flatMap(s=>s.newBrickIds),parts=ids.map(id=>by.get(id));
 if(ids.length>24||new Set(parts.map(b=>b.y)).size!==1||new Set(parts.map(b=>`${b.w},${b.d},${b.color}`)).size>8||run.some(s=>s.kind!=='build'||s.insertionDirection!=='up'||s.issues.length))return result;
 if(['x','z'].some(axis=>Math.max(...parts.map(b=>b[axis]+b[axis==='x'?'w':'d']))-Math.min(...parts.map(b=>b[axis]))>24))return result;
 const view=chooseUndersideInstructionView({visibleBricks:run.at(-1).visibleBrickIds.map(id=>by.get(id)),highlightedIds:ids,scale:result.brickModel.meta?.scale});
 if(!view.passes||view.truncated||view.groups.some(g=>!g.visibleBrickCount))return result;
 const merged={...run[0],label:'Complete underside',newBrickIds:ids,highlightBrickIds:ids,visibleBrickIds:run.at(-1).visibleBrickIds,sourceStepIds:run.flatMap(s=>s.sourceStepIds),orderedOperations:run.flatMap(s=>s.orderedOperations)};
 const steps=p.steps.flatMap(s=>s===run[0]?[merged]:run.includes(s)?[]:[s]),instructionPlan={...p,steps,stats:{...p.stats,stepCount:steps.length,maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
 return {...result,instructionPlan,guide:createGuideSections(instructionPlan)};
}

export function planFoundationRecipes(before,proposals){
 const p=before.assemblyPlan,selected=new Set(proposals.flatMap(c=>c.ids)),parents=new Map(proposals.map(c=>[c.moduleId,c])),recipes=replayNestedRecipes(p)??{};
 const replay=recipeReplay(p,{preservePlacements:true}).flatMap(m=>{
  const c=parents.get(m.id);if(c){recipes[m.id]=c.recipe;return[{id:m.id,label:'Foundation',kind:'grounded',brickIds:c.ids,brickOrder:c.ids}];}
  const rest=m.brickIds.filter(id=>!selected.has(id));if(!rest.length)return [];
  const kept=restrictRecipe(m,rest),steps=p.steps.filter(s=>s.moduleId===m.id);
  if(!steps.some(s=>s.nestedRecipe)){kept.placementGroups=steps.map(s=>s.newBrickIds.filter(id=>rest.includes(id))).filter(g=>g.length);kept.brickOrder=kept.placementGroups.flat();kept.actionOrder=true;}
  return [kept];
 });
 const assemblyPlan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:recipes,...options});
 if(!same(sorted([...unresolvedCells(p)]),sorted([...unresolvedCells(assemblyPlan)])))throw Error('Foundation changed failed cells');
 const changed=new Set(p.modules.filter(m=>m.brickIds.some(id=>selected.has(id))).map(m=>m.id));
 const outside=plan=>plan.steps.filter(s=>!changed.has(s.moduleId)).map(physical);
 const evidence=plan=>plan.steps.filter(s=>!changed.has(s.moduleId)).flatMap(s=>s.kind==='join'
  ?[[s.moduleId,'join',s.nestedRecipe?.id??null,sorted(s.highlightBrickIds),s.insertionDirection??'down',s.joinContext,s.issues]]
  :s.newBrickIds.map(id=>[s.moduleId,s.kind,id,s.insertionDirection??'down',s.workingOrientation??null,s.nestedRecipe?.id??null,s.issues.filter(i=>i.brickIds.includes(id))])).map(JSON.stringify).sort();
 if(!same(evidence(p),evidence(assemblyPlan)))throw Error('Foundation changed outside placements or attachments');
 const expected=structuredClone(before),byPart=new Map(assemblyPlan.steps.flatMap(s=>s.newBrickIds.map(id=>[id,s]))),rank=new Map(assemblyPlan.steps.map((s,i)=>[s,i]));
 // Retained groups are proposals in a new scope. Physical replay above and
 // per-piece view checks below validate their new direction and visible context.
 for(const steps of[expected.assemblyPlan.steps,expected.instructionPlan.steps])for(const s of steps){
  if(!changed.has(s.moduleId)||!s.newBrickIds.length)continue;
  const ops=s.newBrickIds.map(id=>byPart.get(id)).sort((a,b)=>rank.get(a)-rank.get(b)),first=ops[0],last=ops.at(-1);
  if(ops.some(o=>o.moduleId!==first.moduleId||o.nestedRecipe?.id!==first.nestedRecipe?.id))continue;
  s.moduleId=first.moduleId;s.nestedRecipe=first.nestedRecipe;s.visibleBrickIds=last.visibleBrickIds;s.insertionDirection=first.insertionDirection;
 }
 const compact=compactAssemblyPlan(assemblyPlan);
 let after=retainUnchangedDiagrams(expected,{...before,assemblyPlan,instructionPlan:compact.plan});
 for(const c of proposals)after=consolidateUnderside(after,c.moduleId);
 // The boundary and its complete-course diagrams are evaluated together.
 // Earlier compaction receipts describe the old scopes, not these recipes.
 const {completeNestedCourseDiagrams:priorCourseReceipt,...uncompacted}=after;
 after=completeNestedCourseDiagrams(uncompacted);
 if(!after.completeNestedCourseDiagrams&&priorCourseReceipt)after={...after,completeNestedCourseDiagrams:priorCourseReceipt};
 after=restoreUnchangedRecipeMetadata(before,after);
 if(!same(outside(before.instructionPlan),outside(after.instructionPlan)))throw Error('Foundation changed outside diagrams');
 if(!same(repeats(before),repeats(after)))throw Error('Foundation changed repetition');
 if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),assemblyPlan.steps.map(s=>s.id)))throw Error('Incomplete foundation operation coverage');
 const views=chooseInstructionSequence(after.instructionPlan),by=new Map(assemblyPlan.bricks.map(b=>[b.id,b]));
 const retainedView=s=>before.instructionPlan.steps.some(old=>same(sorted(old.newBrickIds),sorted(s.newBrickIds))&&same(sorted(old.visibleBrickIds),sorted(s.visibleBrickIds))&&(old.insertionDirection??'down')===(s.insertionDirection??'down'));
 const readable=s=>{if(retainedView(s))return true;if(s.insertionDirection!=='up')return views.get(s.id)?.passes&&!views.get(s.id)?.truncated;const v=chooseUndersideInstructionView({visibleBricks:s.visibleBrickIds.map(id=>by.get(id)),highlightedIds:s.highlightBrickIds,scale:before.brickModel.meta?.scale});return v.passes&&!v.truncated&&v.groups.every(g=>g.visibleBrickCount);};
 if(after.instructionPlan.steps.some(s=>parents.has(s.moduleId)&&!readable(s)))throw Error('Foundation has hidden additions');
 if(count(after)>=count(before))throw Error('Foundation did not simplify the guide');
 return after;
}

/** Complete independent foundations before continuing their upper structures. */
export function completeFoundationRecipes(before){
 if(!before.assemblyPlan||!before.instructionPlan||before.assemblyError||before.semanticGuide||before.foundationRecipes?.selected||before.brickModel.bricks.length>1000)return before;
 const attempts=[],proposals=discoverFoundationRecipes(before),choices=[];
 const warnings=(plan,ids)=>plan.steps.flatMap(s=>s.issues.flatMap(i=>i.brickIds.filter(id=>ids.has(id)).map(id=>JSON.stringify([id,i.code,i.severity,i.message,sorted(i.brickIds)])))).sort();
 for(const proposal of proposals){
  const viable=[];
  for(const c of foundationRecipeVariants(before.assemblyPlan,proposal)){try{
   const brickModel={version:1,kind:'bricks',bricks:before.assemblyPlan.bricks.filter(b=>c.ids.includes(b.id)).map(({id,...b})=>b)};
   const local=createAssemblyPlan({brickModel,moduleReplay:[{id:c.moduleId,label:'Foundation',kind:'grounded',brickIds:c.ids,brickOrder:c.ids}],moduleRecipes:{[c.moduleId]:c.recipe},...options});
   const selected=new Set(c.ids);
   if(local.steps.some(s=>s.issues.some(i=>i.code!=='limited-support'||i.severity!=='warning'))
     ||!same(warnings(local,selected),warnings(before.assemblyPlan,selected)))throw Error('Foundation changed support or handling evidence');
   viable.push(c);attempts.push({moduleId:c.moduleId,parts:c.ids.length,reasons:[]});
  }catch(error){attempts.push({moduleId:c.moduleId,parts:c.ids.length,reasons:[error.message]});}}
  if(viable.length)choices.push(viable);
 }
 if(!choices.length)return attempts.length?{...before,foundationRecipes:{selected:false,attempts}}:before;
 // Foundations can share an earlier loose-parts module. Judge their working
 // boundaries together: moving one alone can change another's visible context.
 const queue=[choices.map(()=>0)],seen=new Set(),combinations=[];
 while(queue.length&&combinations.length<15){
  const indexes=queue.shift(),key=indexes.join(',');if(seen.has(key))continue;seen.add(key);combinations.push(indexes);
  indexes.forEach((value,i)=>{if(value+1<choices[i].length){const next=[...indexes];next[i]++;queue.push(next);}});
 }
 const fallback=choices.map(c=>c.length-1);if(!seen.has(fallback.join(',')))combinations.push(fallback);
 const reasons=[];
 for(const indexes of combinations){const accepted=indexes.map((n,i)=>choices[i][n]);try{
  const after=planFoundationRecipes(before,accepted),p=after.assemblyPlan,q=after.instructionPlan;
  return {...after,foundationRecipes:{selected:true,attempts,assemblies:accepted.map(({recipe,ids,...c})=>({...c,parts:ids.length})),beforeDiagrams:count(before),afterDiagrams:count(after)},assemblyEvaluation:{...after.assemblyEvaluation,after:assessAssemblyQuality(p),compaction:{...after.assemblyEvaluation?.compaction,instructionDiagramCount:q.steps.length,sourceStepCount:p.steps.length,collapsedStepCount:p.steps.length-q.steps.length,mergedDiagramCount:q.steps.filter(s=>s.sourceStepIds.length>1).length}}};
 }catch(error){reasons.push(error.message);}}
 return {...before,foundationRecipes:{selected:false,attempts,reasons:[...new Set(reasons)]}};
}
