import {spatialRegions,placementFootprint}from'./placement-groups.js';
import {chooseInstructionView,chooseInstructionSequence}from'./instruction-visibility.js';
import {createGuideSections}from'./guide-sections.js';
import {createBookletPresentation}from'./assembly-booklet-presentation.js';
import {prepareNestedRecipePresentation}from'./nested-recipe-presentation.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
// Complexity follows the occupied surface, palette and holes rather than an
// arbitrary strip boundary. Visibility is checked separately for every brick.
function coherent(bs){
 const p=placementFootprint(bs);if(bs.length>80||p.width>24||p.depth>24||p.fill<.45||new Set(bs.map(b=>b.color)).size>3||new Set(bs.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`)).size>8||spatialRegions(bs).length!==1)return false;
 if(new Set(bs.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}:${b.color}`)).size>12)return false;
 const palette=[...new Set(bs.map(b=>b.color))].map(color=>({color,area:bs.filter(b=>b.color===color).reduce((n,b)=>n+b.w*b.d,0)})).sort((a,b)=>b.area-a.area);
 if(palette.length>1&&(palette[0].area<bs.reduce((n,b)=>n+b.w*b.d,0)*.6||palette.slice(1).some(({color})=>spatialRegions(bs.filter(b=>b.color===color)).length>4)))return false;
 const cells=new Set(bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.z+Math.floor(i/b.w)}`))),air=new Set();
 for(let x=p.minX-1;x<=p.maxX;x++)for(let z=p.minZ-1;z<=p.maxZ;z++)if(!cells.has(`${x},${z}`))air.add(`${x},${z}`);
 let holes=-1;while(air.size){holes++;const queue=[air.values().next().value];air.delete(queue[0]);for(const key of queue){const[x,z]=key.split(',').map(Number);for(const [a,b]of[[x+1,z],[x-1,z],[x,z+1],[x,z-1]]){const k=`${a},${b}`;if(air.delete(k))queue.push(k);}}}return holes<=1;
}
/** Keep a complete readable nested course together without changing physical operations. */
export function completeNestedCourseDiagrams(before){
 if(!before.instructionPlan||!before.assemblyPlan||before.assemblyError||before.semanticGuide
   ||before.instructionPlan.bricks.length>1000||before.completeNestedCourseDiagrams)return before;
 if(before.guide?.sections.some(s=>s.semanticConfidence||s.semanticLabel))return before;
 const plan=before.instructionPlan,by=new Map(plan.bricks.map(b=>[b.id,b])),book=createBookletPresentation(before),protectedIds=new Set(book.presentation.sections.filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds))),modules=new Map(plan.modules.map(m=>[m.id,m]));
 const clean=s=>s.nestedRecipe&&s.kind==='build'&&s.newBrickIds.length&&!s.issues.length&&!['attachmentTask','instructionAction','tableRecipe','placementTask','groundLayout','buildRegion'].some(k=>s[k])&&s.insertionDirection!=='up'&&!s.newBrickIds.some(id=>protectedIds.has(id))&&s.newBrickIds.length===s.highlightBrickIds.length&&s.newBrickIds.every(id=>s.highlightBrickIds.includes(id))&&new Set(s.newBrickIds.map(id=>by.get(id).y)).size===1;
 const context=s=>JSON.stringify([s.moduleId,s.nestedRecipe??null,s.nestedRecipePath??null]);
 const changes=[],steps=[],remap=new Map();
 for(let i=0;i<plan.steps.length;){const first=plan.steps[i];let end=i+1;
  if(clean(first)){const y=by.get(first.newBrickIds[0]).y,ctx=context(first);while(end<plan.steps.length&&clean(plan.steps[end])&&context(plan.steps[end])===ctx&&by.get(plan.steps[end].newBrickIds[0]).y===y)end++;
   const run=plan.steps.slice(i,end),ids=run.flatMap(s=>s.newBrickIds),bs=ids.map(id=>by.get(id)),last=run.at(-1),floor=first.nestedRecipe?.floorY??modules.get(first.moduleId)?.buildContext?.floorY??0,initial=first.visibleBrickIds.filter(id=>!ids.includes(id)).map(id=>by.get(id));
   // Complete courses only: no other build in the working scope returns to it.
   const elsewhere=plan.steps.some((s,n)=>(n<i||n>=end)&&context(s)===ctx&&s.newBrickIds.some(id=>by.get(id).y===y));
   const grounded=bs.every(b=>b.y===floor||initial.some(p=>p.y===b.y-1&&overlap(p,b)));
   if(run.length>=2&&!elsewhere&&coherent(bs)&&grounded){
    const view=chooseInstructionView({visibleBricks:last.visibleBrickIds.map(id=>by.get(id)),highlightedIds:ids});
    if(view.passes&&!view.truncated&&view.groups.every(g=>g.visibleBrickCount)){
     const combined={...first,newBrickIds:ids,highlightBrickIds:[...ids],visibleBrickIds:last.visibleBrickIds,sourceStepIds:run.flatMap(s=>s.sourceStepIds),orderedOperations:run.flatMap(s=>s.orderedOperations),completedCourse:{course:y,sourceDiagramIds:run.map(s=>s.id)}};
     if(!run.every(s=>same(s.componentTask?.id,first.componentTask?.id)))delete combined.componentTask;
     for(const s of run)remap.set(s.id,first.id);steps.push(combined);changes.push({before:run.map(s=>plan.steps.indexOf(s)+1),parts:ids.length,scope:ctx,course:y});i=end;continue;
    }
   }
  }
  steps.push(first);i++;
 }
 if(!changes.length)return before;
 const updated=steps.map(s=>({...s,...(s.tableRecipe?{tableRecipe:{...s.tableRecipe,completionStepId:remap.get(s.tableRecipe.completionStepId)??s.tableRecipe.completionStepId}}:{})}));
 for(const s of updated)if(s.componentTask){const group=updated.filter(t=>t.componentTask?.id===s.componentTask.id);s.componentTask={...s.componentTask,index:group.indexOf(s)+1,total:group.length,lastStepId:group.at(-1).id};}
 const instructionPlan={...plan,steps:updated,stats:{...plan.stats,stepCount:updated.length,maxBricksPerStep:Math.max(...updated.map(s=>s.newBrickIds.length)),planReferenceCount:updated.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
 if(!same(updated.flatMap(s=>s.newBrickIds),plan.steps.flatMap(s=>s.newBrickIds))||!same(updated.flatMap(s=>s.sourceStepIds),plan.steps.flatMap(s=>s.sourceStepIds))||!same(updated.flatMap(s=>s.orderedOperations),plan.steps.flatMap(s=>s.orderedOperations)))throw Error('Canonical operations changed');
 const views=chooseInstructionSequence(instructionPlan),oldViews=chooseInstructionSequence(plan),bad=v=>new Set([...v].filter(([,v])=>!v.passes||v.truncated).map(([id])=>id)),oldBad=bad(oldViews);if([...bad(views)].some(id=>!oldBad.has(id)))return before;
 const after=prepareNestedRecipePresentation({...before,instructionPlan,guide:createGuideSections(instructionPlan),completeNestedCourseDiagrams:{beforeDiagrams:plan.steps.length,afterDiagrams:updated.length,changes}}),repeat=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>[s.repeatCount,s.stepIds.length,s.instances.flatMap(i=>i.brickIds).sort()]);
 if(!same(repeat(after),repeat(before)))return before;
 const compaction=before.assemblyEvaluation?.compaction;
 return compaction?{...after,assemblyEvaluation:{...before.assemblyEvaluation,compaction:{...compaction,
  instructionDiagramCount:updated.length,collapsedStepCount:before.assemblyPlan.steps.length-updated.length,
  mergedDiagramCount:updated.filter(s=>s.sourceStepIds.length>1).length}}}:after;
}
