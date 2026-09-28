import {createAssemblyPlan} from './assembly.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {assemblyRejectionReasons, unresolvedCells} from './refine-construction.js';

function components(ids, adjacency) {
  const pending = new Set(ids), groups = [];
  while (pending.size) {
    const group = new Set([pending.values().next().value]);
    for (const id of group) {
      pending.delete(id);
      for (const next of adjacency.get(id)) if (pending.has(next)) group.add(next);
    }
    groups.push([...group]);
  }
  return groups;
}

// Follow the connected upper component through its full height. A horizontal
// cut alone can leave the very overhangs that made the original build fail.
export function planElevatedAssemblies(before) {
  const plan = before.assemblyPlan;
  if (!plan || before.assemblyError || !plan.stats.rootFailureCount || plan.bricks.length > 800) return before;
  const byId = new Map(plan.bricks.map(b => [b.id,b]));
  const adjacency = new Map(plan.bricks.map(b => [b.id,new Set()]));
  for (const {a,b} of plan.graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  const roots = new Set(plan.steps.flatMap(s => s.issues.filter(i => i.code === 'unsupported-addition').map(i => i.brickIds[0])));
  const replay = plan.modules.map(m => ({id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,
    brickIds:m.brickIds,brickOrder:plan.steps.filter(s => s.moduleId === m.id).flatMap(s => s.newBrickIds),
    ...(m.buildContext ? {buildContext:{...m.buildContext,orderPolicy:'course-first'}} : {})}));
  const oldUnresolved = unresolvedCells(plan), proposals = [], attempts = [], candidates = [];
  for (const module of plan.modules.filter(m => m.kind === 'grounded' && !m.buildContext)) {
    const floors = [...new Set(module.brickIds.filter(id => roots.has(id)).map(id => byId.get(id).y))].filter(y => y > 0);
    for (const floor of floors) {
      const groups = components(module.brickIds.filter(id => byId.get(id).y >= floor),adjacency);
      for (const ids of groups) {
        const bricks = ids.map(id => byId.get(id));
        if (!ids.some(id => roots.has(id)) || ids.length < 8 || ids.length > 256
          || Math.max(...bricks.map(b => b.y))-floor < 2) continue;
        if (Math.max(...bricks.map(b => b.x+b.w))-Math.min(...bricks.map(b => b.x)) > 32
          || Math.max(...bricks.map(b => b.z+b.d))-Math.min(...bricks.map(b => b.z)) > 32) continue;
        const selected = new Set(ids), rest = module.brickIds.filter(id => !selected.has(id));
        // The receiving structure must be complete before the elevated section.
        if (!rest.length || rest.some(id => byId.get(id).y >= floor)) continue;
        proposals.push({module,floor,ids,rest,rootCount:ids.filter(id => roots.has(id)).length});
      }
    }
  }
  proposals.sort((a,b) => b.rootCount-a.rootCount || a.ids.length-b.ids.length);
  for (const {module,floor,ids,rest} of proposals.slice(0,4)) {
    const id = `${module.id}-elevated-${floor}`;
    const nextReplay = replay.flatMap(m => m.id !== module.id ? [m] : [
      {...m,brickIds:rest,brickOrder:rest},
      {id,label:'Separate upper section',kind:'detail',groupType:'work-surface',brickIds:ids,brickOrder:ids,
        buildContext:{kind:'work-surface',floorY:floor,orderPolicy:'course-first'}},
    ]);
    try {
      const assemblyPlan = createAssemblyPlan({brickModel:before.brickModel,moduleReplay:nextReplay,
        integratedBuild:plan.integratedBuild ?? false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,
        preferLocalProgress:true,preferLocalFoundations:true});
      const candidate = prepareAssemblyGuide({...before,assemblyPlan},{moduleReplay:nextReplay});
      let reasons = assemblyRejectionReasons(plan,candidate.assemblyPlan);
      const unresolved = unresolvedCells(candidate.assemblyPlan);
      if (unresolved.size >= oldUnresolved.size || [...unresolved].some(cell => !oldUnresolved.has(cell))) {
        reasons.push('Must remove unresolved volume without introducing new unresolved cells');
      }
      // Reclassifying already failed detached geometry is not a new failure.
      // Every affected cell must still have been unresolved in the old plan.
      const blocked = candidate.assemblyPlan.steps.filter(s => s.issues.some(i => i.code === 'blocked-module-insertion'));
      if (blocked.length && blocked.every(s => s.highlightBrickIds.every(id => {
        const b = byId.get(id);
        for (let x=b.x;x<b.x+b.w;x++) for (let z=b.z;z<b.z+b.d;z++) if (!oldUnresolved.has(`${x},${b.y},${z}`)) return false;
        return true;
      }))) reasons = reasons.filter(r => r !== 'blockedJoinCount increased');
      const steps = candidate.assemblyPlan.steps.filter(s => s.moduleId === id);
      if (!steps.some(s => s.kind === 'join') || steps.some(s => s.issues.some(i => i.severity === 'error'))) {
        reasons.push('Incomplete component recipe or attachment');
      }
      if (!candidate.guide.stats.coverageComplete || !candidate.assemblyEvaluation.compaction.sourceStepCoverageComplete) reasons.push('Incomplete coverage');
      attempts.push({moduleId:module.id,floor,parts:ids.length,rejectionReasons:reasons,unresolved:candidate.assemblyPlan.stats.unresolvedBrickCount});
      if (!reasons.length) candidates.push({candidate,moduleId:module.id,floor,parts:ids.length});
    } catch (error) { attempts.push({moduleId:module.id,floor,parts:ids.length,rejectionReasons:[error.message]}); }
  }
  candidates.sort((a,b) => unresolvedCells(a.candidate.assemblyPlan).size-unresolvedCells(b.candidate.assemblyPlan).size
    || a.candidate.instructionPlan.steps.length-b.candidate.instructionPlan.steps.length);
  const winner = candidates[0];
  return {...(winner?.candidate ?? before),elevatedAssemblyPlanning:{selected:!!winner,attempts,
    ...(winner ? {moduleId:winner.moduleId,floor:winner.floor,parts:winner.parts,
      beforeUnresolved:plan.stats.unresolvedBrickCount,afterUnresolved:winner.candidate.assemblyPlan.stats.unresolvedBrickCount} : {})}};
}
