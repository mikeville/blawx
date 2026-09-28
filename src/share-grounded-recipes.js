import {createAssemblyPlan} from './assembly.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {mapRecipe} from './assembly-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {retainUnchangedDiagrams,refreshTableRecipeReferences} from './preserve-instruction-diagrams.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {createGuideSections} from './guide-sections.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {chooseInstructionSequence} from './instruction-visibility.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=ids=>[...ids].sort();
const cells=bricks=>sorted(bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)));
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';

function sharePair(before,source,target,turn) {
  const old=before.assemblyPlan,by=new Map(old.bricks.map(b=>[b.id,b]));
  const sourceParts=source.brickIds.map(id=>by.get(id)),targetParts=target.brickIds.map(id=>by.get(id));
  const replacements=mapRecipe(sourceParts,targetParts,turn);
  if (!same(cells(replacements),cells(targetParts))) return null;
  const mapped=new Map(sourceParts.map((b,i)=>[b.id,replacements[i].id])),removed=new Set(target.brickIds);
  const brickModel={...before.brickModel,bricks:[...old.bricks.filter(b=>!removed.has(b.id)),...replacements].map(({id,...b})=>b)};
  const replay=recipeReplay(old,{preservePlacements:true}).map(m=> {
    if(m.id!==target.id)return m;
    const groups=old.steps.filter(s=>s.moduleId===source.id&&s.newBrickIds.length).map(s=>s.newBrickIds.map(id=>mapped.get(id)));
    return {...m,brickIds:replacements.map(b=>b.id),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true};
  });
  const plan=createAssemblyPlan({brickModel,moduleReplay:replay,moduleRecipes:replayNestedRecipes(old),integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  plan.modules=plan.modules.map(m=>{
    const prior=old.modules.find(p=>p.id===m.id);
    return prior?.componentRecipe?{...m,componentRecipe:structuredClone(prior.componentRecipe)}:m;
  });
  if(!same(sorted(unresolvedCells(plan)),sorted(unresolvedCells(old)))||plan.steps.filter(s=>s.moduleId===target.id).some(s=>s.issues.length))throw Error('Shared component placement failed');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const next=plan.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&s.nestedRecipe?.id===join.nestedRecipe?.id);
    if(!next||next.issues.length||direction(next)!==direction(join)||!same(contactCells(old,join),contactCells(plan,next)))throw Error('Shared component changed an attachment');
  }
  const context=p=>({...p,steps:p.steps.map(s=>s.moduleId!==target.id&&target.brickIds.every(id=>s.visibleBrickIds.includes(id))
    ?{...s,visibleBrickIds:[...s.visibleBrickIds.filter(id=>!removed.has(id)),...replacements.map(b=>b.id)]}:s)});
  const expected={...before,assemblyPlan:context(old),instructionPlan:context(before.instructionPlan)};
  let result=restoreUnchangedRecipeMetadata(expected,prepareAssemblyGuide({...before,brickModel,assemblyPlan:plan},{moduleReplay:replay}));
  result=retainUnchangedDiagrams(expected,result);
  const canonical=plan.steps.filter(s=>s.moduleId===target.id&&s.newBrickIds.length);let cursor=0;
  const diagrams=before.instructionPlan.steps.filter(s=>s.moduleId===source.id).map((s,i)=> {
    const ids=s.newBrickIds.map(id=>mapped.get(id)),ops=[];let total=0;
    while(total<ids.length&&cursor<canonical.length){const op=canonical[cursor++];ops.push(op);total+=op.newBrickIds.length;}
    if(!same(sorted(ops.flatMap(s=>s.newBrickIds)),sorted(ids)))throw Error('Shared task changed placements');
    return {...ops.at(-1),id:`shared-ground-${i}`,newBrickIds:ids,highlightBrickIds:s.highlightBrickIds.map(id=>mapped.get(id)),
      sourceStepIds:ops.map(s=>s.id),issues:ops.flatMap(s=>s.issues),orderedOperations:ops.map(s=>({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,
        highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}))};
  });
  if(cursor!==canonical.length)throw Error('Incomplete shared task coverage');
  const oldSteps=result.instructionPlan.steps,first=oldSteps.findIndex(s=>s.moduleId===target.id),removedCount=oldSteps.filter(s=>s.moduleId===target.id).length;
  const steps=refreshTableRecipeReferences([...oldSteps.slice(0,first),...diagrams,...oldSteps.slice(first+removedCount)]
    .map((s,i)=>({...s,id:`instruction-step-${i+1}`})));
  result={...result,instructionPlan:{...result.instructionPlan,steps,stats:{...result.instructionPlan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}}};
  result.guide=createGuideSections(result.instructionPlan);
  const outside=p=>p.steps.filter(s=>s.moduleId!==target.id).map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds,
    visible:sorted(s.visibleBrickIds),direction:direction(s),issues:s.issues}));
  if(!same(outside(expected.instructionPlan),outside(result.instructionPlan))||!same(steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id)))throw Error('Shared component changed outside tasks or coverage');
  const view=createBookletPresentation(result),repeated=view.presentation.sections.find(s=>s.repeatCount>1&&s.instances.some(i=>i.brickIds.some(id=>replacements.some(b=>b.id===id))));
  const cameras=chooseInstructionSequence(result.instructionPlan);
  if(!repeated)throw Error('Complete grounded recipe did not repeat');
  if(count(result)>=count(before))throw Error('Shared recipe does not simplify the guide');
  if(steps.filter(s=>s.moduleId===target.id).some(s=>!cameras.get(s.id)?.passes||cameras.get(s.id)?.truncated))throw Error('Shared additions are obscured');
  result.assemblyEvaluation={...result.assemblyEvaluation,compaction:{...result.assemblyEvaluation?.compaction,
    sourceStepCount:plan.steps.length,instructionDiagramCount:steps.length,mergedDiagramCount:steps.filter(s=>s.sourceStepIds.length>1).length,
    collapsedStepCount:plan.steps.length-steps.length,sourceStepCoverageComplete:true}};
  return result;
}

// Only complete grounded components supplied by a validated ownership change
// are eligible. Exact occupied geometry permits retiling; mirrors are distinct.
export function shareGroundedRecipes(before,moduleIds) {
  let result=before;const attempts=[];
  for(let round=0;round<3;round++){
    const plan=result.assemblyPlan,modules=plan.modules.filter(m=>moduleIds.has(m.id)&&m.kind==='grounded'&&!m.buildContext&&!m.recipeFamily
      &&m.brickIds.length<=80&&plan.steps.filter(s=>s.moduleId===m.id).every(s=>s.kind==='build'&&!s.issues.length&&!s.nestedRecipe&&direction(s)==='down'));
    let winner=null;
    outer:for(let i=0;i<modules.length-1;i++)for(let j=i+1;j<modules.length;j++)for(const [source,target]of [[modules[i],modules[j]],[modules[j],modules[i]]]){
      for(let turn=0;turn<4;turn++)try{const candidate=sharePair(result,source,target,turn);if(candidate){attempts.push({source:source.id,target:target.id,turn,reasons:[]});winner=candidate;break outer;}}catch(error){attempts.push({source:source.id,target:target.id,turn,reasons:[error.message]});}
    }
    if(!winner)break;result=winner;
  }
  return attempts.length?{...result,groundedRecipeSharing:{selected:result!==before,attempts}}:result;
}
