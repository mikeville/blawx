import {prepareNestedRecipePresentation} from './nested-recipe-presentation.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {recipeBrickId} from './assembly-recipes.js';
import {facesTouch, spatialRegions, placementFootprint} from './placement-groups.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {refreshNestedRecipeReferences} from './nested-recipe-references.js';
import {createGuideSections} from './guide-sections.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {chooseInstructionSequence, chooseInstructionView} from './instruction-visibility.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';

const sorted = ids => [...ids].sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const direction = s => s.joinContext?.direction ?? s.insertionDirection ?? 'down';
const clean = s => s.kind === 'build' && s.newBrickIds.length && direction(s) === 'down'
  && same(sorted(s.newBrickIds),sorted(s.highlightBrickIds))
  && s.issues.every(i => i.code === 'limited-support' && i.severity === 'warning')
  && !['tableRecipe','instructionAction','buildRegion','placementTask','groundLayout'].some(k => s[k]);

function leafRecipe(recipes, parentId, scopeId) {
  if (!scopeId.startsWith(parentId+'/')) return null;
  const path = scopeId.slice(parentId.length+1).split('/');
  let recipe = recipes[parentId];
  for (const [index,id] of path.entries()) {
    const child = recipe?.moduleReplay?.find(m => m.id === id);
    if (!child) return null;
    if (index === path.length-1) return !recipe.moduleRecipes?.[id] && child.kind === 'grounded' && !child.buildContext ? child : null;
    recipe = recipe.moduleRecipes?.[id];
  }
  return null;
}

// Ground edge contact keeps a table layout together. It is deliberately absent
// from the stud graph: these pieces cannot be lifted together until connected.
function tableComponents(plan, ids, floor) {
  const selected = new Set(ids), by = new Map(plan.bricks.map(b => [b.id,b]));
  const adjacency = new Map(ids.map(id => [id,new Set()]));
  for (const {a,b} of plan.graph.edges) if (selected.has(a) && selected.has(b)) {
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  }
  const roots = ids.map(id => by.get(id)).filter(b => b.y === floor);
  for (let i=0;i<roots.length;i++) for (let j=i+1;j<roots.length;j++) if (facesTouch(roots[i],roots[j])) {
    adjacency.get(roots[i].id).add(roots[j].id); adjacency.get(roots[j].id).add(roots[i].id);
  }
  const pending = new Set(ids), groups = [];
  while (pending.size) {
    const group = new Set([pending.values().next().value]);
    for (const id of group) { pending.delete(id); for (const next of adjacency.get(id)) if (pending.has(next)) group.add(next); }
    groups.push([...group]);
  }
  return groups;
}

export function discoverNestedGroundLayouts(result, {includeCompleted = false} = {}) {
  const plan=result.instructionPlan;
  if (!plan || !result.assemblyPlan?.moduleRecipes) return [];
  const by=new Map(plan.bricks.map(b => [b.id,b]));
  const repeated=new Set(createBookletPresentation(result).presentation.sections.filter(s => s.repeatCount>1)
    .flatMap(s => s.instances.flatMap(i => i.brickIds)));
  const scopes=new Map();
  for (const [index,step] of plan.steps.entries()) if (step.nestedRecipe && !step.nestedRecipe.separate) {
    const id=step.nestedRecipe.id;
    if (!scopes.has(id)) scopes.set(id,[]);
    scopes.get(id).push(index);
  }
  const proposals=[];
  for (const [scopeId,indexes] of scopes) {
    if (indexes.length<3 || indexes.at(-1)-indexes[0]+1!==indexes.length) continue;
    const steps=indexes.map(i => plan.steps[i]),scope=steps[0].nestedRecipe;
    const leaf=leafRecipe(result.assemblyPlan.moduleRecipes,scope.parentModuleId,scopeId);
    const ids=steps.flatMap(s => s.newBrickIds);
    if (!leaf || ids.length<8 || ids.length>320 || steps.some(s => !clean(s)) || ids.some(id => repeated.has(id))) continue;
    if (!same(sorted(ids.map(id => recipeBrickId({...by.get(id),y:by.get(id).y-scope.floorY}))),sorted(leaf.brickIds))) continue;
    const components=tableComponents(plan,ids,scope.floorY);
    if (components.length<2 || components.length>8 || components.some(ids => {
      const bs=ids.map(id => by.get(id));
      return ids.length<2 || ids.length>80 || !bs.some(b => b.y===scope.floorY)
        || Math.max(...bs.map(b=>b.x+b.w))-Math.min(...bs.map(b=>b.x))>16
        || Math.max(...bs.map(b=>b.z+b.d))-Math.min(...bs.map(b=>b.z))>16;
    })) continue;
    const owner=new Map(components.flatMap((ids,i)=>ids.map(id=>[id,i])));
    const sequence=steps.map(s => [...new Set(s.newBrickIds.map(id=>owner.get(id)))]);
    if (sequence.some(ids=>ids.length!==1)) continue; // A diagram remains a whole task.
    const taskIds=new Set(steps.filter(s=>s.componentTask).map(s=>s.componentTask.id));
    const scopeSteps=new Set(steps.map(s=>s.id));
    if ([...taskIds].some(id=>{
      if (typeof id!=='string') return true;
      const members=plan.steps.filter(s=>s.componentTask?.id===id);
      return members.some((s,i)=>!scopeSteps.has(s.id)||s.componentTask.total!==members.length
        ||s.componentTask.index!==i+1||s.componentTask.lastStepId!==members.at(-1).id)
        ||new Set(members.flatMap(s=>s.newBrickIds.map(id=>owner.get(id)))).size!==1;
    })) continue; // Existing tasks move whole within their proven work area.
    const runs=sequence.map(ids=>ids[0]).filter((id,i,all)=>!i||all[i-1]!==id);
    if (!includeCompleted && runs.length===components.length) continue;
    const receiver=plan.steps.slice(indexes.at(-1)+1).find(s => s.moduleId===steps[0].moduleId
      && s.kind==='join' && direction(s)==='down' && !s.issues.length
      && components.every(ids=>s.joinContext.supportGroups.some(g=>g.contacts.some(c=>ids.includes(c.supportBrickId)))));
    if (!receiver) continue;
    const ordered=components.flatMap((_,i)=>steps.filter(s=>owner.get(s.newBrickIds[0])===i));
    proposals.push({scope,from:indexes[0],end:indexes.at(-1)+1,ordered,components,runsBefore:runs.length});
  }
  return proposals;
}

const payload = s => ({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds,
  visible:sorted(s.visibleBrickIds),issues:s.issues,direction:direction(s),join:s.joinContext,
  scopes:(s.nestedRecipePath ?? (s.nestedRecipe?[s.nestedRecipe]:[])).map(r=>[r.id,r.parentModuleId,r.floorY,r.separate])});
const repeats = r => createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1)
  .map(s=>[s.repeatCount,s.instances.map(i=>sorted(i.brickIds))]);

// Replay can divide a validated batch without changing what the builder sees.
// Compare each placement's outcome and scope, retaining warning attribution.
export function samePlacementOutcomes(before,after) {
  const placements=plan=>plan.steps.flatMap(s=>s.newBrickIds.map(id=>({id,module:s.moduleId,kind:s.kind,
    direction:direction(s),scopes:payload(s).scopes,
    issues:s.issues.filter(issue=>!issue.brickIds?.length||issue.brickIds.includes(id))})))
    .sort((a,b)=>a.id.localeCompare(b.id));
  return same(before.bricks,after.bricks)&&same(placements(before),placements(after))
    &&same(before.steps.filter(s=>!s.newBrickIds.length).map(payload),after.steps.filter(s=>!s.newBrickIds.length).map(payload));
}

function literalDiagramCoverage(result) {
  const {assemblyPlan, instructionPlan}=result,source=new Map(assemblyPlan.steps.map(s=>[s.id,s]));
  const operation=s=>[s.id,s.kind,s.newBrickIds,s.highlightBrickIds,s.issues,s.insertionDirection??'down'];
  return same(instructionPlan.steps.flatMap(s=>s.sourceStepIds),assemblyPlan.steps.map(s=>s.id))
    &&instructionPlan.steps.every(s=>same(sorted(s.newBrickIds),sorted(s.sourceStepIds.flatMap(id=>source.get(id).newBrickIds)))
      &&same(s.orderedOperations.map(operation),s.sourceStepIds.map(id=>operation(source.get(id)))));
}

function reorder(result,proposal) {
  const {scope,from,end,ordered}=proposal,p=result.assemblyPlan,q=result.instructionPlan;
  const original=q.steps.slice(from,end),by=new Map(p.bricks.map(b=>[b.id,b])),sourceBy=new Map(p.steps.map(s=>[s.id,s]));
  const recipes=replayNestedRecipes(p),leaf=leafRecipe(recipes,scope.parentModuleId,scope.id);
  const sources=ordered.flatMap(s=>s.sourceStepIds.map(id=>sourceBy.get(id)));
  if (sources.some(s=>!s||!clean(s))) throw Error('Nested layout has a protected operation');
  leaf.placementGroups=sources.map(s=>s.newBrickIds.map(id=>recipeBrickId({...by.get(id),y:by.get(id).y-scope.floorY})));
  leaf.brickOrder=leaf.placementGroups.flat(); leaf.actionOrder=true;
  const assemblyPlan=createAssemblyPlan({brickModel:result.brickModel,moduleReplay:recipeReplay(p,{preservePlacements:true}),moduleRecipes:recipes,
    integratedBuild:p.integratedBuild??false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  const selected=new Set(original.flatMap(s=>s.newBrickIds)),visible=original[0].visibleBrickIds.filter(id=>!selected.has(id));
  const movedSource=[],movedDiagrams=[];
  for (const diagram of ordered) {
    for (const id of diagram.sourceStepIds) {
      const s=sourceBy.get(id);visible.push(...s.newBrickIds);movedSource.push({...s,visibleBrickIds:[...visible]});
    }
    movedDiagrams.push({...diagram,visibleBrickIds:[...visible]});
  }
  const start=p.steps.findIndex(s=>s.id===original[0].sourceStepIds[0]);
  if (!same(p.steps.slice(start,start+sources.length).map(s=>s.id),original.flatMap(s=>s.sourceStepIds))) throw Error('Nested source coverage is not contiguous');
  const references=refreshNestedRecipeReferences(
    {...p,steps:[...p.steps.slice(0,start),...movedSource,...p.steps.slice(start+sources.length)]},
    {...q,steps:[...q.steps.slice(0,from),...movedDiagrams,...q.steps.slice(end)]});
  const expected={...result,...references,guide:createGuideSections(references.instructionPlan)};
  let candidate=retainUnchangedDiagrams(expected,restoreUnchangedRecipeMetadata(expected,prepareAssemblyGuide({...result,assemblyPlan})));
  // Displayed tasks and contacts stay exact. Internal batches may differ only
  // with the same per-piece outcomes and truthful, complete new source records.
  if (!same(candidate.instructionPlan.steps.map(payload),expected.instructionPlan.steps.map(payload))
    ||!samePlacementOutcomes(expected.assemblyPlan,candidate.assemblyPlan)) throw Error('Nested replay changed a placement, diagram or attachment');
  if (!literalDiagramCoverage(candidate)) throw Error('Nested replay lost source coverage');
  const priorHandling=assessWorkSurfaceQuality(p).modules;
  for(const current of assessWorkSurfaceQuality(candidate.assemblyPlan).modules){
    const prior=priorHandling.find(m=>m.moduleId===current.moduleId);
    if(!prior||['peakLooseBrickCount','peakComponentCount','finalComponentCount'].some(k=>current[k]>prior[k])) throw Error('Nested layout increased loose work');
  }
  if(result.guide.sections.some(s=>s.nestedRepeat)) candidate=prepareNestedRecipePresentation(candidate);
  if (!same(repeats(candidate),repeats(result))) throw Error('Nested layout changed repeated recipes');
  if (createBookletPresentation(candidate).numbering.diagramCount!==createBookletPresentation(result).numbering.diagramCount) throw Error('Nested layout changed displayed coverage');
  const oldViews=chooseInstructionSequence(q),views=chooseInstructionSequence(candidate.instructionPlan);
  for (let i=0;i<candidate.instructionPlan.steps.length;i++) {
    const step=candidate.instructionPlan.steps[i],view=views.get(step.id),old=oldViews.get(expected.instructionPlan.steps[i].id);
    if (view && (!view.passes||view.truncated) && old?.passes&&!old.truncated) throw Error('Nested layout obscured additions');
  }
  return {...candidate,assemblyEvaluation:{...candidate.assemblyEvaluation,after:assessAssemblyQuality(candidate.assemblyPlan)}};
}

/** Finish distinct table work areas inside a proven nested recipe. */
export function completeNestedGroundLayouts(result) {
  if (!result.instructionPlan || !result.assemblyPlan?.moduleRecipes || result.assemblyError
    || result.brickModel.bricks.length>1000 || result.nestedGroundLayouts?.selected) return result;
  let current=result;const attempts=[],completed=[],rejected=new Set();
  for(let round=0;round<4;round++) {
    const proposal=discoverNestedGroundLayouts(current).find(p=>!rejected.has(p.scope.id));if(!proposal)break;
    try {
      current=reorder(current,proposal);
      completed.push({scopeId:proposal.scope.id,componentSizes:proposal.components.map(c=>c.length),runsBefore:proposal.runsBefore,runsAfter:proposal.components.length});
    } catch(error) {attempts.push({scopeId:proposal.scope.id,reasons:[error.message]});rejected.add(proposal.scope.id);}
  }
  return completed.length||attempts.length ? {...current,nestedGroundLayouts:{selected:completed.length>0,completed,attempts}} : result;
}

// Finish a compact, connected table component in one readable diagram. This
// changes only the presentation: the original bottom-up operations remain the
// recipe, and side contact alone never makes an assembly ready to lift.
export function consolidateCompactNestedAreas(result) {
  if (!result.instructionPlan || !result.assemblyPlan || result.assemblyError) return result;
  const plan = result.instructionPlan, by = new Map(plan.bricks.map(b => [b.id,b]));
  const replacements = new Map(), removed = new Set(), changes = [];
  for (const proposal of discoverNestedGroundLayouts(result,{includeCompleted:true})) {
    for (const ids of proposal.components) {
      const wanted = new Set(ids), bs = ids.map(id => by.get(id)), bounds = placementFootprint(bs);
      const courses = [...new Set(bs.map(b => b.y))].sort((a,b) => a-b);
      if (ids.length > 12 || bounds.width > 6 || bounds.depth > 6 || courses.at(-1)-courses[0] > 2
        || new Set(bs.map(b => b.color)).size > 3
        || courses.some(y => spatialRegions(bs.filter(b => b.y===y)).length !== 1)) continue;
      const connected = new Set([ids[0]]);
      for (const id of connected) for (const edge of plan.graph.edges) {
        if (edge.a===id && wanted.has(edge.b)) connected.add(edge.b);
        if (edge.b===id && wanted.has(edge.a)) connected.add(edge.a);
      }
      if (connected.size !== ids.length) continue;
      const indexes = plan.steps.flatMap((s,i) => s.newBrickIds.some(id => wanted.has(id)) ? [i] : []);
      if (indexes.length < 2 || indexes.at(-1)-indexes[0]+1 !== indexes.length) continue;
      const run = indexes.map(i => plan.steps[i]);
      if (!same(sorted(run.flatMap(s => s.newBrickIds)),sorted(ids))) continue;
      const view = chooseInstructionView({visibleBricks:run.at(-1).visibleBrickIds.map(id => by.get(id)),highlightedIds:ids});
      if (!view.passes || view.truncated || view.groups.some(g => !g.visibleBrickCount)) continue;
      const first = run[0], last = run.at(-1), newIds = run.flatMap(s => s.newBrickIds);
      const issues = [...new Map(run.flatMap(s => s.issues).map(issue => [JSON.stringify(issue),issue])).values()];
      const combined = {...first,newBrickIds:newIds,highlightBrickIds:[...newIds],visibleBrickIds:last.visibleBrickIds,
        label:`Build this section · add ${newIds.length} bricks`,issues,
        sourceStepIds:run.flatMap(s => s.sourceStepIds),orderedOperations:run.flatMap(s => s.orderedOperations),
        componentTask:{id:`${first.id}-complete-area`,index:1,total:1,lastStepId:first.id}};
      replacements.set(first.id,combined);
      for (const step of run.slice(1)) removed.add(step.id);
      changes.push({scopeId:proposal.scope.id,sourceDiagramIds:run.map(s => s.id),parts:ids.length});
    }
  }
  if (!changes.length) return result;
  const steps = plan.steps.filter(s => !removed.has(s.id)).map(s => replacements.get(s.id) ?? s);
  const instructionPlan = {...plan,steps,stats:{...plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s => s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s) => n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
  for (const key of ['newBrickIds','sourceStepIds','orderedOperations']) {
    if (!same(steps.flatMap(s => s[key]),plan.steps.flatMap(s => s[key]))) return result;
  }
  const oldViews=chooseInstructionSequence(plan),views=chooseInstructionSequence(instructionPlan);
  for (const [id,view] of views) {
    if ((!view.passes || view.truncated) && oldViews.get(id)?.passes && !oldViews.get(id)?.truncated) return result;
  }
  let after = {...result,instructionPlan,guide:createGuideSections(instructionPlan),compactNestedAreas:{changes}};
  if (result.guide.sections.some(s => s.nestedRepeat)) after=prepareNestedRecipePresentation(after);
  if (!same(repeats(result),repeats(after))) return result;
  if (result.assemblyEvaluation?.compaction) after={...after,assemblyEvaluation:{...after.assemblyEvaluation,
    compaction:{...after.assemblyEvaluation.compaction,instructionDiagramCount:steps.length,
      collapsedStepCount:result.assemblyPlan.steps.length-steps.length,
      mergedDiagramCount:steps.filter(s => s.sourceStepIds.length>1).length}}};
  return after;
}
