import {createAssemblyPlan} from './assembly.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {assemblyRejectionReasons, unresolvedCells} from './refine-construction.js';

function connectedGroups(ids, adjacency) {
  const remaining = new Set(ids), groups = [];
  while (remaining.size) {
    const group = new Set([remaining.values().next().value]);
    for (const id of group) {
      remaining.delete(id);
      for (const neighbor of adjacency.get(id)) if (remaining.has(neighbor)) group.add(neighbor);
    }
    groups.push([...group]);
  }
  return groups;
}

// An overhanging rim may have no downward build route even though its final
// connections are sound. Build its small connected sections on the table, then
// join them to the completed receiving course. Do not extract unrelated pieces
// merely because they occupy the same height range.
export function planHangingAssemblies(before) {
  const plan = before.assemblyPlan;
  if (!plan || before.assemblyError || !plan.stats.rootFailureCount || plan.bricks.length > 800) return before;
  const byId = new Map(plan.bricks.map(b => [b.id,b]));
  const adjacency = new Map(plan.bricks.map(b => [b.id,new Set()]));
  for (const {a,b} of plan.graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  const descriptors = plan.modules.map(m => ({id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,
    brickIds:m.brickIds,brickOrder:plan.steps.filter(s => s.moduleId === m.id).flatMap(s => s.newBrickIds),
    ...(m.buildContext ? {buildContext:{...m.buildContext,orderPolicy:'course-first'}} : {})}));
  const attempts = [], candidates = [];
  for (const module of plan.modules.filter(m => m.kind === 'grounded' && !m.buildContext)) {
    const roots = new Set(plan.steps.filter(s => s.moduleId === module.id)
      .flatMap(s => s.issues.filter(i => i.code === 'unsupported-addition').map(i => i.brickIds[0])));
    const floors = [...new Set([...roots].map(id => byId.get(id).y))].filter(y => y > 0).sort((a,b) => a-b);
    for (const floor of floors) {
      if (attempts.length >= 8) break;
      // Two courses provide a flat seed and its connecting course. Taller
      // components need their own discovery rather than arbitrary height cuts.
      const band = module.brickIds.filter(id => byId.get(id).y >= floor && byId.get(id).y <= floor+1);
      const groups = connectedGroups(band,adjacency).filter(ids => ids.some(id => roots.has(id)));
      if (!groups.length || groups.length > 8 || groups.some(ids => ids.length < 2 || ids.length > 24)) continue;
      const selected = new Set(groups.flat());
      const prefix = module.brickIds.filter(id => !selected.has(id) && byId.get(id).y <= floor);
      const rest = module.brickIds.filter(id => !selected.has(id) && !prefix.includes(id));
      if (!prefix.length && plan.modules.indexOf(module) === 0) continue;
      const original = descriptors.find(m => m.id === module.id);
      const continuation = (ids,suffix) => ({...original,id:`${module.id}-${suffix}`,brickIds:ids,brickOrder:ids});
      const sections = groups.map((brickIds,i) => ({id:`${module.id}-rim-${floor}-${i+1}`,
        label:`Separate assembly ${i+1}`,kind:'detail',groupType:'work-surface',brickIds,brickOrder:brickIds,
        buildContext:{kind:'work-surface',floorY:floor,orderPolicy:'course-first'}}));
      const replacements = [...(prefix.length ? [continuation(prefix,'receiving-course')] : []),...sections,
        ...(rest.length ? [{...continuation(rest,'remainder'),groupType:'continuation'}] : [])];
      const replay = descriptors.flatMap(m => m.id === module.id ? replacements : [m]);
      try {
        const assemblyPlan = createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,
          integratedBuild:plan.integratedBuild ?? false,preferLocalProgress:true,preferLocalFoundations:true});
        const candidate = prepareAssemblyGuide({...before,assemblyPlan},{moduleReplay:replay});
        const reasons = assemblyRejectionReasons(plan,candidate.assemblyPlan);
        const oldUnresolved = unresolvedCells(plan), nextUnresolved = unresolvedCells(candidate.assemblyPlan);
        if (nextUnresolved.size >= oldUnresolved.size || [...nextUnresolved].some(cell => !oldUnresolved.has(cell))) {
          reasons.push('Must remove unresolved volume without introducing new unresolved cells');
        }
        const recipeIds = new Set(sections.map(m => m.id));
        const recipes = candidate.assemblyPlan.steps.filter(s => recipeIds.has(s.moduleId));
        if (recipes.some(s => s.kind === 'unresolved' || s.issues.some(i => i.severity === 'error'))
          || recipes.filter(s => s.kind === 'join' && !s.issues.length).length !== sections.length) reasons.push('Incomplete recipe or attachment');
        if (!candidate.guide.stats.coverageComplete || !candidate.assemblyEvaluation.compaction.sourceStepCoverageComplete) reasons.push('Incomplete coverage');
        attempts.push({moduleId:module.id,floor,sections:sections.length,rejectionReasons:reasons});
        if (!reasons.length) candidates.push({candidate,sections:sections.length,floor,moduleId:module.id});
      } catch (error) { attempts.push({moduleId:module.id,floor,rejectionReasons:[error.message]}); }
    }
  }
  candidates.sort((a,b) => a.candidate.assemblyPlan.stats.unresolvedBrickCount-b.candidate.assemblyPlan.stats.unresolvedBrickCount
    || a.candidate.instructionPlan.steps.length-b.candidate.instructionPlan.steps.length);
  const winner = candidates[0];
  return {...(winner?.candidate ?? before),hangingAssemblyPlanning:{selected:!!winner,attempts,
    ...(winner ? {moduleId:winner.moduleId,floor:winner.floor,sections:winner.sections,
      beforeUnresolved:plan.stats.unresolvedBrickCount,afterUnresolved:winner.candidate.assemblyPlan.stats.unresolvedBrickCount} : {})}};
}
