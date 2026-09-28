import {createAssemblyPlan} from './assembly.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {discoverWorkAreaTasks} from './work-area-tasks.js';

export const withinRecipe = (step,path) => step.nestedRecipe?.id === path || step.nestedRecipe?.id?.startsWith(path+'/');
const sorted = values => [...values].sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const hasError = step => step.issues.some(i => i.severity === 'error');
const allowed = new Set(['1x1','1x2','1x3','1x4','2x2','2x3','2x4']);

function occupancy(bricks) {
  const result = new Map();
  for (const b of bricks) {
    if (!allowed.has([b.w,b.d].sort((a,b) => a-b).join('x'))
      || ![b.x,b.y,b.z,b.w,b.d].every(Number.isSafeInteger)) throw Error('Illegal replacement brick');
    for (let x=b.x;x<b.x+b.w;x++) for (let z=b.z;z<b.z+b.d;z++) {
      const key = `${x},${b.y},${z}`;
      if (result.has(key)) throw Error('Overlapping replacement bricks');
      result.set(key,b.color);
    }
  }
  return [...result].sort();
}

/** Validate the final canonical plan, including changes made during diagram preparation. */
export function supportedRecipeRejections(before,after,path) {
  const reasons = [], old = before.assemblyPlan, plan = after.assemblyPlan, guide = after.instructionPlan;
  const check = (condition,message) => { if (!condition) reasons.push(message); };
  try {
    check(same(occupancy(before.brickModel.bricks),occupancy(after.brickModel.bricks)), 'Occupied shape or colors changed');
    const ids = sorted(plan.bricks.map(b => b.id));
    check(same(sorted(plan.steps.flatMap(s => s.newBrickIds)),ids)
      && same(sorted(guide.steps.flatMap(s => s.newBrickIds)),ids), 'Brick coverage changed');
    check(same(guide.steps.flatMap(s => s.sourceStepIds),plan.steps.map(s => s.id)), 'Canonical operation order changed');
    const sources = new Map(plan.steps.map(s => [s.id,s])), stepIds = new Set(guide.steps.map(s => s.id));
    const operation = s => [s.id,s.kind,s.newBrickIds,s.issues,s.insertionDirection??'down'];
    for (const s of guide.steps) {
      check(same(sorted(s.newBrickIds),sorted(s.sourceStepIds.flatMap(id => sources.get(id).newBrickIds)))
        && same(s.orderedOperations.map(operation),s.sourceStepIds.map(id => operation(sources.get(id)))), 'Diagram operations changed');
      check(!s.tableRecipe || stepIds.has(s.tableRecipe.completionStepId), 'Stale table completion');
      check(!s.componentTask || stepIds.has(s.componentTask.lastStepId), 'Stale component completion');
    }
    check(same(after.guide.sections.flatMap(s => s.stepIds),guide.steps.map(s => s.id)), 'Incomplete guide');
    check(same(sorted(unresolvedCells(old)),sorted(unresolvedCells(plan))), 'Physical failures changed');

    const changedIds = new Set([...old.steps,...plan.steps].filter(s => withinRecipe(s,path)).flatMap(s => s.newBrickIds));
    const outside = r => r.instructionPlan.steps.filter(s => !withinRecipe(s,path)).map(s => ({
      kind:s.kind,module:s.moduleId,new:s.newBrickIds,
      highlight:sorted(s.highlightBrickIds.filter(id => !changedIds.has(id))),
      visible:sorted(s.visibleBrickIds.filter(id => !changedIds.has(id))),
      issues:s.issues,direction:s.insertionDirection??'down',
    }));
    check(same(outside(before),outside(after)), 'Outside tasks changed');
    const repeated = r => createBookletPresentation(r).presentation.sections.filter(s => s.repeatCount > 1)
      .map(s => [s.repeatCount,s.stepIds.length,sorted(s.instances.flatMap(i => i.brickIds))]);
    check(same(repeated(before),repeated(after)), 'Repeated recipes changed');
    for (const s of old.steps.filter(s => s.kind === 'join' && !hasError(s)
      && !s.nestedRecipe?.id?.startsWith(path+'/'))) {
      const next = plan.steps.find(t => t.kind === 'join' && t.moduleId === s.moduleId && t.nestedRecipe?.id === s.nestedRecipe?.id);
      check(next && !hasError(next) && same(contactCells(old,s),contactCells(plan,next)), 'Successful attachment changed');
    }

    const inside = r => r.instructionPlan.steps.filter(s => withinRecipe(s,path));
    const joins = p => p.steps.filter(s => withinRecipe(s,path) && s.kind === 'join').length;
    check(inside(after).length < inside(before).length && joins(plan) < joins(old), 'Component did not simplify');
    check(createBookletPresentation(after).numbering.diagramCount < createBookletPresentation(before).numbering.diagramCount,
      'Whole guide did not simplify');
    const views = chooseInstructionSequence(guide);
    check(inside(after).filter(s => s.kind === 'build').every(s => !hasError(s)
      && (s.insertionDirection??'down') === 'down' && views.get(s.id)?.passes && !views.get(s.id)?.truncated), 'Unsupported or hidden additions');

    const byId = new Map(plan.bricks.map(b => [b.id,b]));
    const additions = plan.steps.filter(s => withinRecipe(s,path)).flatMap(s => s.newBrickIds.map(id => byId.get(id)));
    const areas = discoverWorkAreaTasks(additions);
    if (!areas) reasons.push('Work areas cannot be completed');
    else {
      const owner = new Map(areas.tasks.flatMap((bs,i) => bs.map(b => [b.id,i]))), heights = new Map(), runs = [];
      for (const b of additions) {
        const area = owner.get(b.id);
        check(b.y >= (heights.get(area)??-Infinity), 'Downward return within work area');
        heights.set(area,b.y);
        if (runs.at(-1) !== area) runs.push(area);
      }
      check(new Set(runs).size === runs.length, 'Completed work area revisited');
    }
    // Cheap checks reject first. Replay is the final proof that saved recipes
    // reproduce the supported placement/attachment sequence in the full scene.
    if (!reasons.length) {
      const replay = createAssemblyPlan({brickModel:after.brickModel,
        moduleReplay:recipeReplay(plan,{preservePlacements:true}),moduleRecipes:replayNestedRecipes(plan),
        integratedBuild:plan.integratedBuild??false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,
        preferLocalProgress:true,preferLocalFoundations:true});
      check(same(sorted(unresolvedCells(replay)),sorted(unresolvedCells(plan))), 'Recipe replay changes failures');
    }
  } catch (error) { reasons.push(error.message); }
  return [...new Set(reasons)];
}
