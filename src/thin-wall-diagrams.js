import{placementFootprint,spatialRegions}from'./placement-groups.js';
import{chooseInstructionView}from'./instruction-visibility.js';
import{createGuideSections}from'./guide-sections.js';
export function consolidateThinWallDiagrams(result,moduleId){
 const p=result.instructionPlan,by=new Map(p.bricks.map(b=>[b.id,b])),steps=[],changes=[];
 const clean=s=>s.moduleId===moduleId&&s.kind==='build'&&!s.issues.length&&!s.tableRecipe&&!s.nestedRecipe&&!s.instructionAction&&!s.buildRegion&&!s.componentTask&&!s.placementTask&&(s.insertionDirection??'down')==='down';
 for(let i=0;i<p.steps.length;){const first=p.steps[i];let best=null,take=1;
  if(clean(first))for(let n=2;i+n<=p.steps.length;n++){
   const run=p.steps.slice(i,i+n);if(!clean(run.at(-1)))break;
   const ids=run.flatMap(s=>s.newBrickIds),bs=ids.map(id=>by.get(id)),shape=placementFootprint(bs),lo=Math.min(...bs.map(b=>b.y)),hi=Math.max(...bs.map(b=>b.y));
   if(ids.length>24||hi-lo>3||shape.width>24||shape.depth>24||Math.min(shape.width,shape.depth)>2)break;
   if(spatialRegions(bs).length!==1||new Set(bs.map(b=>b.color)).size>3||new Set(bs.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`)).size>8)continue;
   const next=p.steps[i+n];if(next&&clean(next)&&next.newBrickIds.some(id=>by.get(id).y<=hi))continue;
   const view=chooseInstructionView({visibleBricks:run.at(-1).visibleBrickIds.map(id=>by.get(id)),highlightedIds:ids});if(!view.passes||view.truncated)continue;
   best={...first,label:`${first.label.split(' · add ')[0]} · add ${ids.length} bricks`,newBrickIds:ids,highlightBrickIds:[...ids],visibleBrickIds:run.at(-1).visibleBrickIds,sourceStepIds:run.flatMap(s=>s.sourceStepIds),orderedOperations:run.flatMap(s=>s.orderedOperations)};take=n;
  }
  steps.push(best??first);if(best)changes.push({from:i+1,old:take,parts:best.newBrickIds.length});i+=take;
 }
 if(!changes.length)return{result,changes};
 const instructionPlan={...p,steps,stats:{...p.stats,stepCount:steps.length,maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),planReferenceCount:steps.reduce((n,s)=>n+s.visibleBrickIds.length+s.highlightBrickIds.length+s.newBrickIds.length,0)}};
 return{result:{...result,instructionPlan,guide:createGuideSections(instructionPlan)},changes};
}
