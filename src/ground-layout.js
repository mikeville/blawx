import {createRectangularLayerGroups} from './rectangular-layer-groups.js';
import {spatialRegions} from './placement-groups.js';
import {chooseInstructionView} from './instruction-visibility.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {createGuideSections} from './guide-sections.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const sameSet = (a,b) => a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
function withSteps(plan,steps) {
  return {...plan,steps,stats:{...plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s => s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s) => n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
}

// The initial floor has no earlier scene or vertical dependencies. Partition
// its full outline before choosing diagram boundaries, then retain every later
// operation and its validated scene. This is a table layout, not a stud bond.
export function completeGroundLayout(result) {
  const plan = result.assemblyPlan, guide = result.instructionPlan;
  if (!plan || !guide || result.assemblyError) return result;
  const module = plan.modules[0], byId = new Map(plan.bricks.map(b => [b.id,b]));
  if (!module || module.kind !== 'grounded' || module.buildContext) return result;
  const eligible = s => s.moduleId === module.id && s.kind === 'build' && s.newBrickIds.length
    && !s.issues.length && !s.instructionAction && !s.tableRecipe && !s.buildRegion && !s.groundLayout
    && (s.insertionDirection ?? 'down') === 'down'
    && (!s.placementTask || s.placementTask.kind === 'ground-layout')
    && sameSet(s.newBrickIds,s.highlightBrickIds) && s.newBrickIds.every(id => byId.get(id).y === 0);
  let sourceEnd = 0, diagramEnd = 0;
  while (sourceEnd < plan.steps.length && eligible(plan.steps[sourceEnd])) sourceEnd++;
  while (diagramEnd < guide.steps.length && eligible(guide.steps[diagramEnd])) diagramEnd++;
  const oldSource = plan.steps.slice(0,sourceEnd), oldDiagrams = guide.steps.slice(0,diagramEnd);
  const ids = oldSource.flatMap(s => s.newBrickIds), bricks = ids.map(id => byId.get(id));
  if (ids.length < 8 || ids.length > 96 || diagramEnd < 2
    || !sameSet(ids,oldDiagrams.flatMap(s => s.newBrickIds))
    || !sameSet(ids,module.brickIds.filter(id => byId.get(id).y === 0))
    || !sameSet(ids,oldSource.at(-1).visibleBrickIds)
    || oldSource.some(s => s.visibleBrickIds.some(id => !ids.includes(id)))
    || new Set(bricks.map(b => b.color)).size > 2 || spatialRegions(bricks).length !== 1) return result;
  const repeated = deriveGuidePresentation({plan:guide,guide:result.guide}).sections
    .filter(s => s.repeatCount > 1).flatMap(s => s.instances.flatMap(i => i.brickIds));
  if (module.brickIds.some(id => repeated.includes(id))) return result;
  const groups = createRectangularLayerGroups(bricks,{maxBricks:24,maxSpan:32,maxPartTypes:8});
  if (groups.length >= diagramEnd || groups.some(g => g.fillRatio < .6
    || spatialRegions(g.brickIds.map(id => byId.get(id))).length !== 1)) return result;
  const sources = [], diagrams = [], visible = [];
  for (const [index,group] of groups.entries()) {
    const groundLayout = {ordinal:index+1,total:groups.length};
    const operations = [];
    for (let start=0;start<group.brickIds.length;start+=12) {
      const added = group.brickIds.slice(start,start+12); visible.push(...added);
      const step = {id:`${module.id}-ground-layout-source-${sources.length+1}`,moduleId:module.id,
        label:`${module.label} · add ${added.length} bricks`,kind:'build',newBrickIds:added,
        highlightBrickIds:[...added],visibleBrickIds:[...visible],issues:[],groundLayout};
      sources.push(step); operations.push(step);
    }
    const view = chooseInstructionView({visibleBricks:visible.map(id => byId.get(id)),highlightedIds:group.brickIds});
    if (!view.passes || view.truncated || view.groups.some(g => !g.visibleBrickCount)) return result;
    diagrams.push({...operations.at(-1),id:`${module.id}-ground-layout-diagram-${index+1}`,
      newBrickIds:[...group.brickIds],highlightBrickIds:[...group.brickIds],
      label:`${module.label} · add ${group.brickIds.length} bricks`,sourceStepIds:operations.map(s => s.id),
      orderedOperations:operations.map(s => ({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,
        highlightBrickIds:s.highlightBrickIds,issues:[],insertionDirection:'down'}))});
  }
  if (!sameSet(visible,ids)) return result;
  const assemblyPlan = withSteps(plan,[...sources,...plan.steps.slice(sourceEnd)]);
  const instructionPlan = withSteps(guide,[...diagrams,...guide.steps.slice(diagramEnd)]);
  if (JSON.stringify(instructionPlan.steps.flatMap(s => s.sourceStepIds)) !== JSON.stringify(assemblyPlan.steps.map(s => s.id))) return result;
  return {...result,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),
    groundLayoutPlanning:{beforeDiagrams:diagramEnd,afterDiagrams:groups.length,parts:ids.length},
    assemblyEvaluation:{...result.assemblyEvaluation,after:assessAssemblyQuality(assemblyPlan),
      compaction:{...result.assemblyEvaluation.compaction,sourceStepCount:assemblyPlan.steps.length,
        instructionDiagramCount:instructionPlan.steps.length,
        collapsedStepCount:assemblyPlan.steps.length-instructionPlan.steps.length,
        mergedDiagramCount:instructionPlan.steps.filter(s => s.sourceStepIds.length > 1).length}}};
}
