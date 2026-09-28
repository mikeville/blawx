import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const order = (a, b) => a.y-b.y || a.z-b.z || a.x-b.x;
function signature(bricks) {
  const x = Math.min(...bricks.map(b => b.x)), z = Math.min(...bricks.map(b => b.z));
  return bricks.map(b => `${b.x-x},${b.y},${b.z-z}:${b.w},${b.d}:${b.color}`).sort().join('|');
}
function commonCores(groups) {
  const ceiling = Math.min(...groups.map(bs => Math.max(...bs.map(b => b.y))));
  for (let floor = ceiling; floor >= 2; floor--) {
    const cores = groups.map(bs => bs.filter(b => b.y < floor));
    if (cores.some((bs, i) => bs.length < 4 || bs.length < groups[i].length-bs.length
      || !bs.some(b => b.y === 0) || !bs.some(b => b.y === floor-1))) continue;
    if (cores.every(bs => signature(bs) === signature(cores[0]))) return {cores, floor};
  }
  return null;
}
function references(plan, modules, steps) {
  return {...plan, modules, steps, stats:{...plan.stats, moduleCount:modules.length, stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s => s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s) => n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
}

// The shared component can end below different connection pieces. Repeat only
// complete identical lower courses, then build the real interfaces in context.
export function refineRepeatedSupportCores(result) {
  const plan = result.assemblyPlan, diagrams = result.instructionPlan;
  if (!plan || !diagrams || result.assemblyError || result.repeatedCoreRefinement?.selected) return result;
  const join = plan.steps.find(s => s.kind === 'join' && !s.issues.length && s.joinContext?.direction === 'down');
  const groups = join?.joinContext.supportGroups;
  if (!groups || groups.length < 2 || groups.length > 8) return result;
  const byId = new Map(plan.bricks.map(b => [b.id,b]));
  const target = plan.modules.find(m => m.brickIds.includes(groups[0].brickIds[0]));
  if (!target || target.kind !== 'grounded' || target.buildContext || target.groupType || target.recipeFamily) return result;
  const ids = groups.flatMap(g => g.brickIds), selected = new Set(ids);
  if (selected.size !== ids.length || ids.length !== target.brickIds.length
    || target.brickIds.some(id => !selected.has(id)) || groups.some(g => g.brickIds.length > 80)) return result;
  const parts = groups.map(g => g.brickIds.map(id => byId.get(id)));
  if (parts.every(bs => signature(bs) === signature(parts[0]))) return result;
  const shared = commonCores(parts);
  if (!shared) return result;
  const sources = plan.steps.filter(s => s.moduleId === target.id), old = diagrams.steps.filter(s => s.moduleId === target.id);
  if ([...sources,...old].some(s => s.kind !== 'build' || s.issues.length || (s.insertionDirection ?? 'down') !== 'down')
    || sources.some((s,i) => plan.steps[i] !== s) || old.some((s,i) => diagrams.steps[i] !== s)) return result;
  try {
    const coreIds = new Set(shared.cores.flatMap(bs => bs.map(b => b.id)));
    const interfaces = parts.flat().filter(b => !coreIds.has(b.id)).sort(order);
    const replay = shared.cores.map((bs,i) => ({id:`${target.id}-core-${i+1}`, label:`Base assembly ${i+1}`, kind:'grounded',
      brickIds:bs.map(b => b.id), brickOrder:[...bs].sort(order).map(b => b.id)}));
    replay.push({id:`${target.id}-interfaces`,label:'Support connections',kind:'grounded',groupType:'supported-additions',
      brickIds:interfaces.map(b => b.id),brickOrder:interfaces.map(b => b.id)});
    const brickModel = {version:1,kind:'bricks',bricks:parts.flat().map(({id,...b}) => b)};
    const local = createAssemblyPlan({brickModel,moduleReplay:replay});
    if (local.steps.some(s => s.kind !== 'build' || s.issues.length)) return result;
    const localModules = local.modules.map((m,i) => ({...m,componentIds:target.componentIds,...(i >= shared.cores.length ? {} : {
      recipeFamily:`${target.id}-cores`,repeatContinuation:{joinSourceStepId:join.id,
        brickIds:parts[i].filter(b => !coreIds.has(b.id)).map(b => b.id)}})}));
    const canonical = local.steps.map(s => ({...s,id:`shared-core-${s.id}`}));
    const compacted = compactAssemblyPlan({...local,modules:localModules,steps:canonical}).plan;
    const replace = (original, prefix, removed) => references(original,
      [...localModules,...original.modules.filter(m => m.id !== target.id)],
      [...prefix,...original.steps.slice(removed.length)]);
    const assemblyPlan = replace(plan,canonical,sources), instructionPlan = replace(diagrams,
      compacted.steps.map(s => ({...s,id:`shared-core-${s.id}`})),old);
    const coverage = assemblyPlan.steps.flatMap(s => s.newBrickIds);
    if (coverage.length !== plan.bricks.length || new Set(coverage).size !== plan.bricks.length
      || JSON.stringify(instructionPlan.steps.flatMap(s => s.sourceStepIds)) !== JSON.stringify(assemblyPlan.steps.map(s => s.id))) return result;
    const guide = createGuideSections(instructionPlan), presentation = deriveGuidePresentation({plan:instructionPlan,guide});
    const repeat = presentation.sections.find(s => s.repeatCount === groups.length && s.brickIds.length === shared.cores[0].length);
    const count = p => p.sections.reduce((n,s) => n+s.stepIds.length,0);
    if (!repeat || count(presentation) >= count(deriveGuidePresentation({plan:diagrams,guide:result.guide}))) return result;
    return {...result,assemblyPlan,instructionPlan,guide,
      assemblyEvaluation:{...result.assemblyEvaluation,after:assessAssemblyQuality(assemblyPlan),
        compaction:{...result.assemblyEvaluation?.compaction,sourceStepCount:assemblyPlan.steps.length,
          instructionDiagramCount:instructionPlan.steps.length,mergedDiagramCount:instructionPlan.steps.filter(s => s.sourceStepIds.length > 1).length,
          collapsedStepCount:assemblyPlan.steps.length-instructionPlan.steps.length,sourceStepCoverageComplete:true,brickCoverageComplete:true}},
      repeatedCoreRefinement:{selected:true,moduleId:target.id,repeatCount:groups.length,piecesPerCore:shared.cores[0].length,
        interfaceBrickIds:interfaces.map(b => b.id),interfaceFloor:shared.floor,preservedJoinId:join.id,
        oldSourceStepIds:sources.map(s => s.id),oldDiagramIds:old.map(s => s.id)}};
  } catch {
    return result;
  }
}
