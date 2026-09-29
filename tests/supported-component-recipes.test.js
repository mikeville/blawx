import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedComponentFixture} from './helpers/supported-component-fixture.js';
import {completeSupportedComponentRecipes} from '../src/supported-component-recipes.js';
import {supportedRecipeRejections} from '../src/supported-recipe-validation.js';
import {createBookletPresentation} from '../src/assembly-booklet-presentation.js';
import {inspectConstruction} from '../src/construction.js';
import {assessAssemblyQuality} from '../src/assembly-quality.js';
const count = r => createBookletPresentation(r).numbering.diagramCount;

test('replace a capture recipe with complete supported layers across rotations, colors and nested recipes',() => {
  for (const nested of [false,true]) for (let turn=0;turn<4;turn++) {
    const before = supportedComponentFixture(turn,{nested,recolor:turn%2}), snapshot = structuredClone(before);
    const after = completeSupportedComponentRecipes(before);
    assert(after.supportedComponentRecipes?.selected);
    assert.deepEqual(before,snapshot);
    assert.equal(count(before),nested ? 10 : 8);
    assert.equal(count(after),nested ? 7 : 6);
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    const path = after.supportedComponentRecipes.attempts.at(-1).path;
    assert.deepEqual(supportedRecipeRejections(before,after,path),[]);
    assert.equal(after.metrics.brickCount,after.brickModel.bricks.length);
    assert.equal(Object.values(after.metrics.partHistogram).reduce((a,b) => a+b,0),after.brickModel.bricks.length);
    assert.deepEqual(after.diagnostics,inspectConstruction(after.brickModel));
    assert.deepEqual(after.assemblyEvaluation.after,assessAssemblyQuality(after.assemblyPlan));
    assert.equal(completeSupportedComponentRecipes(after),after);
  }
});

test('preserve semantic guides, protected recipes and unsupported inputs exactly',() => {
  const empty = {}; assert.equal(completeSupportedComponentRecipes(empty),empty);
  for (const property of ['recipeFamily','sharedHandledRecipe','repeatContinuation','mirroredAssembly']) {
    const before = supportedComponentFixture();
    before.assemblyPlan.modules.find(m => m.id === 'body')[property] = {id:'protected'};
    assert.equal(completeSupportedComponentRecipes(before),before);
  }
  const semantic = supportedComponentFixture(); semantic.semanticGuide = {version:1};
  assert.equal(completeSupportedComponentRecipes(semantic),semantic);
  const named = supportedComponentFixture(); named.guide.sections[0].semanticLabel = 'Known component';
  assert.equal(completeSupportedComponentRecipes(named),named);
  const broken = supportedComponentFixture(); broken.assemblyError = 'Failed input';
  assert.equal(completeSupportedComponentRecipes(broken),broken);
});

test('reject physical, operation, reference and outside-task regressions even when diagram counts improve',() => {
  const before = supportedComponentFixture(), accepted = completeSupportedComponentRecipes(before);
  const reject = (change,expected) => {
    const candidate = structuredClone(accepted); change(candidate);
    assert(supportedRecipeRejections(before,candidate,'body').some(r => r.includes(expected)),expected);
  };
  reject(r => { r.brickModel.bricks[0].color = 'red'; },'Occupied shape or colors');
  reject(r => { r.brickModel.bricks.push({...r.brickModel.bricks[0]}); },'Overlapping');
  reject(r => { r.instructionPlan.steps[0].sourceStepIds.reverse(); r.instructionPlan.steps[0].sourceStepIds.push('missing'); },'Canonical operation');
  reject(r => { r.instructionPlan.steps[0].tableRecipe = {completionStepId:'missing'}; },'Stale table');
  reject(r => { r.instructionPlan.steps.find(s => s.moduleId === 'later').visibleBrickIds = []; },'Outside tasks');
  reject(r => { r.assemblyPlan.steps.find(s => s.kind === 'join' && s.moduleId === 'body').issues.push({severity:'error',code:'blocked'}); },'Successful attachment');
  reject(r => { r.instructionPlan.steps.find(s => s.nestedRecipe && s.kind === 'build').insertionDirection = 'up'; },'Unsupported or hidden');
});
