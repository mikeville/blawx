import {sectionData} from './guide-sections.js';
import {canonicalSignature,eligibleNestedRepeat} from './guide-presentation.js';

// Final reader preparation: expose complete matching child recipes without
// changing any checked operation, diagram, attachment, or physical build scene.
export function prepareNestedRecipePresentation(result) {
  const plan=result.instructionPlan,guide=result.guide;
  if(!plan||!guide||result.semanticGuide||guide.sections.some(s=>s.nestedRepeat))return result;
  const context={plan,bricksById:new Map(plan.bricks.map(b=>[b.id,b])),
    modulesById:new Map(plan.modules.map(m=>[m.id,m])),stepsById:new Map(plan.steps.map(s=>[s.id,s]))};
  const sourceByStep=new Map(guide.sections.flatMap(section=>section.stepIds.map(id=>[id,section])));
  const scopes=new Map();
  for(const step of plan.steps)if(step.nestedRecipe?.separate){
    const scope=step.nestedRecipe.id;
    if(!scopes.has(scope))scopes.set(scope,[]);scopes.get(scope).push(step);
  }
  const families=new Map();
  for(const [scope,steps]of scopes){
    const builds=steps.filter(s=>s.kind==='build'),join=steps.at(-1);
    if(builds.length<2||join.kind!=='join')continue;
    const sources=[...new Set(builds.map(s=>sourceByStep.get(s.id)))];
    // A verified semantic boundary must not be silently removed by repetition.
    if(sources.some(s=>s.semanticConfidence==='high'||s.semanticConfidence==='inferred'))continue;
    const familyId=`nested:${join.moduleId}:${scope.slice(0,scope.lastIndexOf('/'))}`;
    const section={...sectionData({id:`nested-recipe-${scope}`,label:'Assembly',steps:builds,...context}),
      nestedRepeat:{scopeId:scope,attachmentStepId:join.id,familyId}};
    if(!eligibleNestedRepeat(section,context))continue;
    const key=familyId+'|'+canonicalSignature(section,context).signature;
    if(!families.has(key))families.set(key,[]);families.get(key).push(section);
  }
  const selected=[...families.values()].filter(f=>f.length>1).flat();
  if(!selected.length)return result;
  const nextGuide=restoreNestedRecipeSections(plan,guide,selected);
  if(nextGuide===guide)return result;
  return {...result,guide:nextGuide,
    nestedRecipePresentation:{families:[...families.values()].filter(f=>f.length>1).map(f=>({copies:f.length,
      parts:f[0].brickIds.length,buildDiagrams:f[0].stepIds.length,scopeIds:f.map(s=>s.nestedRepeat.scopeId)}))}};
}

// Naming may describe a recipe together with its attachment, but must retain
// the checked recipe boundary and its separate placement in the reader.
export function restoreNestedRecipeSections(plan,guide,selected) {
  if(!selected.length)return guide;
  const context={bricksById:new Map(plan.bricks.map(b=>[b.id,b])),
    modulesById:new Map(plan.modules.map(m=>[m.id,m])),stepsById:new Map(plan.steps.map(s=>[s.id,s]))};
  const owner=new Map(selected.flatMap(section=>section.stepIds.map(id=>[id,section]))),emitted=new Set(),sections=[];
  for(const source of guide.sections){
    let pending=[],part=0;
    const flush=()=>{
      if(!pending.length)return;
      if(pending.length===source.stepIds.length)sections.push(source);
      else sections.push({...source,...sectionData({id:`${source.id}-remainder-${++part}`,label:source.label,
        steps:pending.map(id=>context.stepsById.get(id)),...context})});
      pending=[];
    };
    for(const id of source.stepIds){
      const recipe=owner.get(id);
      if(!recipe){pending.push(id);continue;}
      flush();if(!emitted.has(recipe.id)){
        const named=Object.hasOwn(source,'semanticConfidence') ? {
          semanticConfidence:source.semanticConfidence,semanticLabel:source.semanticLabel,
          semanticEvidence:source.semanticEvidence,
        } : {};
        sections.push({...recipe,...named});emitted.add(recipe.id);
      }
    }
    flush();
  }
  const stepIds=sections.flatMap(s=>s.stepIds),brickIds=sections.flatMap(s=>s.brickIds);
  if(stepIds.length!==plan.steps.length||stepIds.some((id,i)=>id!==plan.steps[i].id)
    ||brickIds.length!==plan.bricks.length||new Set(brickIds).size!==plan.bricks.length)return guide;
  return {...guide,sections,stats:{...guide.stats,sectionCount:sections.length,
    groupCount:sections.reduce((n,s)=>n+s.groups.length,0),coverageComplete:true}};
}
