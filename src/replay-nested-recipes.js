import {recipeWorkingFrame} from './recipe-working-frame.js';
import {recipeBrickId} from './assembly-recipes.js';

// Stored discovery recipes can precede later course planning. Replay the
// executed child operations, while still asking the planner to validate them.
export function replayNestedRecipes(plan) {
  if (!plan.moduleRecipes) return plan.moduleRecipes;
  const recipes=structuredClone(plan.moduleRecipes),by=new Map(plan.bricks.map(b=>[b.id,b]));
  function replay(recipe,path,floor,depth=0,members=[]) {
    if(depth>=3)throw new RangeError('Nested recipes exceed the three-level replay limit.');
    const frame=recipeWorkingFrame(recipe,members.map(id=>by.get(id)),floor);
    const globalIds=new Map(members.map(id=>[recipeBrickId(frame.toLocal(by.get(id))),id]));
    for(const child of recipe.moduleReplay){
      const childPath=`${path}/${child.id}`,nested=recipe.moduleRecipes?.[child.id];
      if(nested){replay(nested,childPath,floor+(child.buildContext?.floorY ?? 0),depth+1,child.brickIds.map(id=>globalIds.get(id)).filter(Boolean));continue;}
      const steps=plan.steps.filter(s=>s.nestedRecipe?.id===childPath&&s.newBrickIds.length);
      // A strength advisory does not invalidate the executed placement order.
      // Replay still checks the connections and emits the current warning.
      if (!steps.length||steps.some(s=>s.issues.some(i=>i.code!=='limited-support'||i.severity!=='warning'))) continue;
      const groups=steps.map(s=>s.newBrickIds.map(id=>recipeBrickId(frame.toLocal(by.get(id)))));
      const ids=groups.flat();
      if (ids.length!==child.brickIds.length||new Set(ids).size!==ids.length||ids.some(id=>!child.brickIds.includes(id))) continue;
      child.brickOrder=ids;child.placementGroups=groups;child.actionOrder=true;
      if (child.buildContext) child.buildContext.orderPolicy='planned-actions';
    }
  }
  for(const [parentId,recipe] of Object.entries(recipes)) {
    const parent=plan.modules.find(m=>m.id===parentId);
    if(parent?.buildContext?.kind==='work-surface'||parent?.kind==='grounded')replay(recipe,parentId,parent.buildContext?.floorY??0,0,parent.brickIds ?? plan.bricks.map(b=>b.id));
  }
  return recipes;
}
