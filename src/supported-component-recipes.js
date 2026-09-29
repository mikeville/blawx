import {proposeAnchoredPacking,packingSignature} from './anchored-packing.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {recipeBrickId} from './assembly-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {prepareNestedRecipePresentation} from './nested-recipe-presentation.js';
import {replanRecipeTasks,replanRecipeFloors,replanSupportedRecipeCourses} from './recipe-tasks.js';
import {completeNestedCourseDiagrams} from './nested-course-diagrams.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {supportedRecipeRejections,withinRecipe} from './supported-recipe-validation.js';
import {inspectConstruction} from './construction.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const protectedRecipe = m => ['recipeFamily','sharedHandledRecipe','repeatContinuation','mirroredAssembly'].some(k => m[k]);
const count = r => createBookletPresentation(r).numbering.diagramCount;

function candidateScopes(before) {
  const repeats = new Set(createBookletPresentation(before).presentation.sections.filter(s => s.repeatCount > 1)
    .flatMap(s => s.instances.flatMap(i => i.brickIds)));
  const scopes = [];
  function visit(recipe,path) {
    if (protectedRecipe(recipe) || recipe.moduleReplay.some(protectedRecipe)) return;
    const steps = before.instructionPlan.steps.filter(s => withinRecipe(s,path));
    const members = steps.flatMap(s => s.newBrickIds);
    if (recipe.moduleReplay.length > 1 && members.length >= 12 && members.length <= 200
      && !members.some(id => repeats.has(id))) scopes.push({path,steps:steps.length});
    for (const [id,child] of Object.entries(recipe.moduleRecipes??{})) visit(child,path+'/'+id);
  }
  for (const [id,recipe] of Object.entries(before.assemblyPlan.moduleRecipes??{})) {
    const root = before.assemblyPlan.modules.find(m => m.id === id);
    if (root?.buildContext && !protectedRecipe(root)) visit(recipe,id);
  }
  return scopes.sort((a,b) => b.steps-a.steps).slice(0,3);
}

function supportedCourses(region) {
  const floor = Math.min(...region.map(b => b.y));
  const groups = [...new Set(region.map(b => b.y))].sort((a,b) => a-b).map(y => region.filter(b => b.y === y)
    .sort((a,b) => a.z-b.z || a.x-b.x).map(b => recipeBrickId({...b,y:b.y-floor})));
  return {floor,recipe:{allowUnderAttachments:false,groupUnderAttachments:false,
    moduleReplay:[{id:'module-1',label:'Complete component',kind:'grounded',brickIds:groups.flat(),
      brickOrder:groups.flat(),actionOrder:true,placementGroups:groups}],diagramGroups:groups}};
}

function rebuild(before,path,model,original,replacement) {
  const old = before.assemblyPlan, rootId = path.split('/')[0], root = old.modules.find(m => m.id === rootId);
  const removed = new Set(original.map(packingSignature)), ids = new Set(original.map(b => b.id));
  const recipes = replayNestedRecipes(old), found = supportedCourses(replacement);
  function update(recipe,prefix,floor) {
    if (prefix === path) {
      if (found.floor !== floor) throw Error('Changed recipe floor');
      return found.recipe;
    }
    const localOld = new Map(old.bricks.map(b => [recipeBrickId({...b,y:b.y-floor}),b]));
    const contains = m => path === prefix+'/'+m.id || path.startsWith(prefix+'/'+m.id+'/');
    const next = {...recipe,moduleRecipes:{...recipe.moduleRecipes},moduleReplay:recipe.moduleReplay.map(m => {
      if (!contains(m)) return m;
      const members = m.brickIds.map(id => localOld.get(id));
      if (members.some(b => !b)) throw Error('Unresolved recipe membership');
      const parts = [...members.filter(b => !removed.has(packingSignature(b))),...replacement];
      const local = parts.map(b => recipeBrickId({...b,y:b.y-floor}));
      if (new Set(local).size !== local.length) throw Error('Duplicate recipe membership');
      return {...m,brickIds:local,brickOrder:local,actionOrder:false,placementGroups:undefined};
    })};
    delete next.diagramGroups;
    for (const m of recipe.moduleReplay.filter(contains)) {
      next.moduleRecipes[m.id] = update(recipe.moduleRecipes[m.id],prefix+'/'+m.id,floor+(m.buildContext?.floorY??0));
    }
    return next;
  }
  recipes[rootId] = update(recipes[rootId],rootId,root.buildContext.floorY);
  const identified = createAssemblyPlan({brickModel:model}).bricks;
  const byKey = new Map(identified.map(b => [packingSignature(b),b]));
  const replacementIds = replacement.map(b => byKey.get(packingSignature(b)).id);
  const allRoot = [...root.brickIds.filter(id => !ids.has(id)),...replacementIds];
  const replay = recipeReplay(old,{preservePlacements:true}).map(m => m.id === rootId
    ? {...m,brickIds:allRoot,brickOrder:allRoot,actionOrder:false,placementGroups:undefined} : m);
  const plan = createAssemblyPlan({brickModel:model,moduleReplay:replay,moduleRecipes:recipes,
    integratedBuild:old.integratedBuild??false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,
    preferLocalProgress:true,preferLocalFoundations:true});
  // The same finished volume appears in later scenes with replacement part IDs.
  // No earlier scene may pretend that the component is already complete.
  const adapt = p => ({...p,steps:p.steps.map(s => !original.every(b => s.visibleBrickIds.includes(b.id)) ? s : ({
    ...s,visibleBrickIds:[...s.visibleBrickIds.filter(id => !ids.has(id)),...replacementIds],
    highlightBrickIds:s.kind === 'join' && original.every(b => s.highlightBrickIds.includes(b.id))
      ? [...s.highlightBrickIds.filter(id => !ids.has(id)),...replacementIds] : s.highlightBrickIds,
  }))});
  const expected = {...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)};
  expected.instructionPlan.steps = expected.instructionPlan.steps.filter(s => !withinRecipe(s,path));
  let candidate = prepareNestedRecipePresentation(retainUnchangedDiagrams(expected,restoreUnchangedRecipeMetadata(expected,
    prepareAssemblyGuide({...before,brickModel:model,assemblyPlan:plan},{moduleReplay:replay}))));
  // Re-establish coherent spatial tasks after repacking. A global height sweep
  // alone can interleave separate limbs, even when all placements are supported.
  const options = {moduleIds:new Set([rootId])};
  candidate = replanSupportedRecipeCourses(replanRecipeFloors(replanRecipeTasks(candidate,options),options),options);
  candidate = prepareNestedRecipePresentation(retainUnchangedDiagrams(expected,candidate));
  delete candidate.completeNestedCourseDiagrams;
  return completeNestedCourseDiagrams(candidate);
}

/** Replace unnecessary nested capture assemblies with supported component tasks. */
export function completeSupportedComponentRecipes(before) {
  if (!before.assemblyPlan?.moduleRecipes || !before.instructionPlan || before.assemblyError
    || before.brickModel.bricks.length > 1000 || before.supportedComponentRecipes?.selected || before.semanticGuide
    || before.guide?.sections.some(s => s.semanticConfidence || s.semanticLabel)) return before;
  const started = performance.now(), attempts = [], byId = new Map(before.assemblyPlan.bricks.map(b => [b.id,b]));
  for (const {path} of candidateScopes(before)) {
    try {
      const original = before.assemblyPlan.steps.filter(s => withinRecipe(s,path)).flatMap(s => s.newBrickIds.map(id => byId.get(id)));
      let model = before.brickModel, region = original;
      const patches = [];
      for (let round=0;round<4;round++) {
        const patch = proposeAnchoredPacking(model,region)[0];
        if (!patch) break;
        const removed = new Set(patch.before.map(packingSignature));
        region = [...region.filter(b => !removed.has(packingSignature(b))),...patch.after];
        model = {...model,bricks:patch.bricks};
        patches.push({before:patch.before,after:patch.after});
      }
      if (!patches.length) continue;
      const candidate = rebuild(before,path,model,original,region);
      const reasons = supportedRecipeRejections(before,candidate,path);
      attempts.push({path,patches,beforeDiagrams:count(before),afterDiagrams:count(candidate),reasons});
      if (reasons.length) continue;
      const partHistogram = {};
      for (const b of model.bricks) {
        const key = `${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;
        partHistogram[key] = (partHistogram[key]??0)+1;
      }
      const preparationMs = performance.now()-started;
      return {...candidate,diagnostics:inspectConstruction(model),
        metrics:{...candidate.metrics,brickCount:model.bricks.length,partHistogram,
          conversionMs:(before.metrics?.conversionMs??0)+preparationMs,
          stageTiming:{...before.metrics?.stageTiming,supportedComponentRecipesMs:preparationMs}},
        assemblyEvaluation:{...candidate.assemblyEvaluation,after:assessAssemblyQuality(candidate.assemblyPlan)},
        supportedComponentRecipes:{selected:true,attempts,preparationMs}};
    } catch (error) { attempts.push({path,reasons:[error.message]}); }
  }
  // Retain all geometry, recipes, diagram references and receipts on a no-op.
  return before;
}
