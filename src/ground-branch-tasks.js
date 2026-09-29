import { foundationAreas } from './complete-feature-tasks.js';
import { createAssemblyPlan } from './assembly.js';
import { createRectangularLayerGroups } from './rectangular-layer-groups.js';
import { createGuideSections } from './guide-sections.js';
import { createBookletPresentation } from './assembly-booklet-presentation.js';
import { chooseInstructionView, chooseInstructionSequence } from './instruction-visibility.js';
import { prepareNestedRecipePresentation } from './nested-recipe-presentation.js';
import { assessAssemblyQuality } from './assembly-quality.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort();
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w
  && a.z < b.z + b.d && b.z < a.z + a.d;
const courseOrder = (a, b) => a.y - b.y || a.z - b.z || a.x - b.x;

/** Trace separate ground starts to their first shared connecting course. */
export function discoverGroundBranches(bricks) {
  // Side contact defines a work area here; it does not imply a stud connection.
  const roots = foundationAreas(bricks.filter(brick => brick.y === 0));
  if (roots.length < 2 || roots.length > 8) return null;
  const owners = new Map(roots.flatMap((root, index) =>
    root.map(brick => [brick.id, new Set([index])])));
  for (const brick of [...bricks].sort(courseOrder)) {
    if (owners.has(brick.id)) continue;
    const below = bricks.filter(lower => lower.y + 1 === brick.y && overlaps(lower, brick));
    const ancestors = new Set(below.flatMap(lower => [...(owners.get(lower.id) ?? [])]));
    if (!ancestors.size) return null;
    owners.set(brick.id, ancestors);
  }

  // Once branches meet, finish complete courses, including pieces whose own
  // ancestry remains local. Otherwise those pieces create a later downward return.
  const receiverFloor = Math.min(...bricks.filter(brick => owners.get(brick.id).size > 1)
    .map(brick => brick.y));
  const groups = roots.map((_, index) => bricks.filter(brick => brick.y < receiverFloor
    && owners.get(brick.id).size === 1 && owners.get(brick.id).has(index)));
  const shared = bricks.filter(brick => brick.y >= receiverFloor);
  if (shared.length) groups.push(shared);
  if (groups.slice(0, roots.length).some(group => group.length < 3
    || Math.max(...group.map(brick => brick.y)) < 1)) return null;

  const groupByBrick = new Map(groups.flatMap((group, index) =>
    group.map(brick => [brick.id, index])));
  const requires = groups.map(() => new Set());
  for (const lower of bricks) for (const upper of bricks) {
    if (lower.y < upper.y && overlaps(lower, upper)
      && groupByBrick.get(lower.id) !== groupByBrick.get(upper.id)) {
      requires[groupByBrick.get(upper.id)].add(groupByBrick.get(lower.id));
    }
  }
  const pending = new Set(groups.map((_, index) => index));
  const tasks = [];
  while (pending.size) {
    const ready = [...pending].find(index => [...requires[index]].every(prior => !pending.has(prior)));
    if (ready === undefined) return null;
    pending.delete(ready);
    tasks.push(groups[ready].sort(courseOrder));
  }
  return { tasks, roots: roots.length, shared: shared.length,
    ownership: Object.fromEntries([...owners].map(([id, roots]) => [id, [...roots]])) };
}

function eligibleStep(step) {
  return step.kind === 'build' && step.newBrickIds.length
    && !step.nestedRecipe && !step.nestedRecipePath && !step.tableRecipe
    && !step.instructionAction && !step.joinContext
    && (step.insertionDirection ?? 'down') === 'down'
    && step.issues.every(issue => issue.code === 'limited-support' && issue.severity === 'warning');
}

function replaceSteps(plan, steps) {
  return { ...plan, steps, stats: { ...plan.stats, stepCount: steps.length,
    maxBricksPerStep: Math.max(...steps.map(step => step.newBrickIds.length)),
    planReferenceCount: steps.reduce((count, step) => count + step.newBrickIds.length
      + step.visibleBrickIds.length + step.highlightBrickIds.length, 0) } };
}

function repeatedRecipes(result) {
  return createBookletPresentation(result).presentation.sections.filter(section => section.repeatCount > 1);
}

function repeatSignature(result) {
  return repeatedRecipes(result).map(section => [section.repeatCount, section.stepIds.length,
    sorted(section.instances.flatMap(instance => instance.brickIds))]);
}

function unreadableSteps(plan) {
  return new Set([...chooseInstructionSequence(plan)]
    .filter(([, view]) => !view.passes || view.truncated).map(([id]) => id));
}

function makeDiagrams(groups, canonical, module, byId) {
  const diagrams = groups.map((group, index) => {
    const operations = canonical.filter(step => step.placementGroupId === `${module.id}-patch-${index + 1}`);
    const last = operations.at(-1);
    const ids = operations.flatMap(step => step.newBrickIds);
    if (!last || !same(sorted(ids), sorted(group.brickIds))) throw Error('Missing branch operations');
    const view = chooseInstructionView({
      visibleBricks: last.visibleBrickIds.map(id => byId.get(id)), highlightedIds: ids,
    });
    if (!view.passes || view.truncated) throw Error('Hidden branch additions');
    return { ...last, id: `${module.id}-ground-branch-diagram-${index + 1}`,
      newBrickIds: ids, highlightBrickIds: ids, sourceStepIds: operations.map(step => step.id),
      orderedOperations: operations.map(step => ({ id: step.id, kind: step.kind,
        newBrickIds: step.newBrickIds, highlightBrickIds: step.highlightBrickIds,
        issues: step.issues, insertionDirection: step.insertionDirection ?? 'down' })),
      componentTask: { id: `${module.id}-ground-branch-${group.task}` } };
  });

  // Consolidate readable courses within a task, never across independent branches.
  for (let index = 0; index < diagrams.length - 1;) {
    const first = diagrams[index], next = diagrams[index + 1];
    const ids = [...first.newBrickIds, ...next.newBrickIds];
    const parts = ids.map(id => byId.get(id));
    const capacity = new Set(parts.map(brick => brick.color)).size === 1 ? 24 : 12;
    if (first.componentTask.id !== next.componentTask.id || ids.length > capacity
      || Math.max(...parts.map(brick => brick.y)) - Math.min(...parts.map(brick => brick.y)) > 2) {
      index++;
      continue;
    }
    const view = chooseInstructionView({
      visibleBricks: next.visibleBrickIds.map(id => byId.get(id)), highlightedIds: ids,
    });
    if (!view.passes || view.truncated) { index++; continue; }
    diagrams.splice(index, 2, { ...next, id: first.id, newBrickIds: ids, highlightBrickIds: ids,
      sourceStepIds: [...first.sourceStepIds, ...next.sourceStepIds],
      orderedOperations: [...first.orderedOperations, ...next.orderedOperations] });
  }
  for (const step of diagrams) {
    const task = diagrams.filter(other => other.componentTask.id === step.componentTask.id);
    step.componentTask = { ...step.componentTask, index: task.indexOf(step) + 1,
      total: task.length, lastStepId: task.at(-1).id };
  }
  return diagrams;
}

function replaceBranchScope(before, module, sources, oldDiagrams, found, byId) {
  const parts = module.brickIds.map(id => byId.get(id));
  const groups = found.tasks.flatMap((task, index) => createRectangularLayerGroups(task, {
    maxBricks: 24, maxSpan: 24, maxPartTypes: 8, balancePanels: true,
  }).map(group => ({ ...group, task: index })));
  const descriptor = { id: module.id, label: module.label, kind: 'grounded',
    brickIds: module.brickIds, brickOrder: groups.flatMap(group => group.brickIds),
    placementGroups: groups.map(group => group.brickIds), actionOrder: true };
  const local = createAssemblyPlan({
    brickModel: { version: 1, kind: 'bricks', bricks: parts.map(({ id, ...brick }) => brick) },
    moduleReplay: [descriptor], preferLocalProgress: true, preferLocalFoundations: true,
  });
  if (local.steps.some(step => step.kind !== 'build' || step.issues.length)) {
    throw Error('Local placement has warnings or failures');
  }
  const initial = sources[0].visibleBrickIds.filter(id => !module.brickIds.includes(id));
  if (parts.some(brick => initial.some(id => byId.get(id).y > brick.y && overlaps(byId.get(id), brick)))) {
    throw Error('Existing scene blocks insertion');
  }
  const canonical = local.steps.map((step, index) => ({ ...step,
    id: `${module.id}-ground-branch-operation-${index + 1}`,
    visibleBrickIds: [...initial, ...step.visibleBrickIds] }));
  const diagrams = makeDiagrams(groups, canonical, module, byId);
  if (diagrams.length > oldDiagrams.length + 1) throw Error('Branch plan adds too many diagrams');
  if (!same(sorted(canonical.at(-1).visibleBrickIds), sorted(sources.at(-1).visibleBrickIds))) {
    throw Error('Completed scene changed');
  }
  const sourceStart = before.assemblyPlan.steps.indexOf(sources[0]);
  const diagramStart = before.instructionPlan.steps.indexOf(oldDiagrams[0]);
  const assemblyPlan = replaceSteps(before.assemblyPlan, [
    ...before.assemblyPlan.steps.slice(0, sourceStart), ...canonical,
    ...before.assemblyPlan.steps.slice(sourceStart + sources.length),
  ]);
  const instructionPlan = replaceSteps(before.instructionPlan, [
    ...before.instructionPlan.steps.slice(0, diagramStart), ...diagrams,
    ...before.instructionPlan.steps.slice(diagramStart + oldDiagrams.length),
  ]);
  if (new Set(assemblyPlan.steps.map(step => step.id)).size !== assemblyPlan.steps.length
    || new Set(instructionPlan.steps.map(step => step.id)).size !== instructionPlan.steps.length) {
    throw Error('Duplicate step ID');
  }
  if (!same(instructionPlan.steps.flatMap(step => step.sourceStepIds), assemblyPlan.steps.map(step => step.id))
    || !same(sorted(instructionPlan.steps.flatMap(step => step.newBrickIds)), sorted(assemblyPlan.bricks.map(brick => brick.id)))) {
    throw Error('Coverage changed');
  }
  const compaction = { ...before.assemblyEvaluation?.compaction,
    sourceStepCount: assemblyPlan.steps.length, instructionDiagramCount: instructionPlan.steps.length,
    collapsedStepCount: assemblyPlan.steps.length - instructionPlan.steps.length,
    mergedDiagramCount: instructionPlan.steps.filter(step => step.sourceStepIds.length > 1).length,
    brickCoverageComplete: true, sourceStepCoverageComplete: true };
  const result = prepareNestedRecipePresentation({ ...before, assemblyPlan, instructionPlan,
    guide: createGuideSections(instructionPlan), assemblyEvaluation: { ...before.assemblyEvaluation,
      compaction, after: assessAssemblyQuality(assemblyPlan) } });
  if (!same(repeatSignature(before), repeatSignature(result))) throw Error('Repeated recipes changed');
  const priorBad = unreadableSteps(before.instructionPlan);
  if ([...unreadableSteps(instructionPlan)].some(id => !priorBad.has(id))) throw Error('New hidden additions');
  return result;
}

/** Replace one complete grounded scope; all later operations stay literal. */
export function planGroundBranches(before) {
  const plan = before.assemblyPlan, instructions = before.instructionPlan;
  if (!plan || !instructions || before.assemblyError || plan.bricks.length > 1000) {
    return { selected: false, reason: 'outside-scope' };
  }
  const repeated = new Set(repeatedRecipes(before).flatMap(section =>
    section.instances.flatMap(instance => instance.brickIds)));
  const byId = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const attempts = [];
  for (const module of plan.modules) {
    if (module.kind !== 'grounded' || module.buildContext || module.brickIds.length > 400
      || module.brickIds.some(id => repeated.has(id))) continue;
    const sources = plan.steps.filter(step => step.moduleId === module.id);
    const old = instructions.steps.filter(step => step.moduleId === module.id);
    if (!sources.length || !old.length || sources.some(step => !eligibleStep(step))
      || old.some(step => !eligibleStep(step))
      || !same(sorted(sources.flatMap(step => step.newBrickIds)), sorted(module.brickIds))) continue;
    const sourceStart = plan.steps.indexOf(sources[0]), diagramStart = instructions.steps.indexOf(old[0]);
    if (!same(plan.steps.slice(sourceStart, sourceStart + sources.length), sources)
      || !same(instructions.steps.slice(diagramStart, diagramStart + old.length), old)) continue;
    const found = discoverGroundBranches(module.brickIds.map(id => byId.get(id)));
    if (!found) continue;
    const owner = new Map(found.tasks.flatMap((task, index) => task.map(brick => [brick.id, index])));
    let previous, visits = 0;
    for (const id of sources.flatMap(step => step.newBrickIds)) {
      const task = owner.get(id);
      if (task !== previous) visits++;
      previous = task;
    }
    const returns = visits - found.tasks.length;
    if (returns < 2) continue;
    try {
      const result = replaceBranchScope(before, module, sources, old, found, byId);
      return { selected: true, moduleId: module.id, returnsBefore: returns, returnsAfter: 0,
        roots: found.roots, shared: found.shared, taskSizes: found.tasks.map(task => task.length),
        before: createBookletPresentation(before).numbering.diagramCount,
        after: createBookletPresentation(result).numbering.diagramCount,
        sourceStepsBefore: sources.length,
        sourceStepsAfter: result.assemblyPlan.steps.filter(step => step.moduleId === module.id).length,
        result, attempts };
    } catch (error) {
      attempts.push({ moduleId: module.id, reason: error.message });
    }
  }
  return { selected: false, attempts };
}

export function completeGroundBranches(before) {
  const { result, ...receipt } = planGroundBranches(before);
  return result ? { ...result, groundBranchRefinement: receipt } : before;
}
