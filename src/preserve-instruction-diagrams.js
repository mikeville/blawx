import {createGuideSections} from './guide-sections.js';

const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const sameScene = (a,b) => same([...a].sort(),[...b].sort());
const scope = recipe => recipe && [recipe.id,recipe.parentModuleId,recipe.separate,recipe.floorY];
const payload = s => [s.moduleId,s.kind,s.newBrickIds,s.highlightBrickIds,s.issues,s.joinContext,s.insertionDirection ?? 'down',s.nestedRecipe,s.nestedRecipePath,s.workingOrientation];
const clean = s => s.kind === 'build' && !s.issues.length && !s.joinContext
  && same(s.newBrickIds,s.highlightBrickIds);
const operations = steps => steps.map(s => ({id:s.id,kind:s.kind,insertionDirection:s.insertionDirection ?? 'down',
  ...(s.workingOrientation ? {workingOrientation:structuredClone(s.workingOrientation)} : {}),
  newBrickIds:[...s.newBrickIds],highlightBrickIds:[...s.highlightBrickIds],issues:structuredClone(s.issues)}));
const placements = steps => steps.flatMap(s => s.newBrickIds.map(id => [id,s.insertionDirection ?? 'down']))
  .sort((a,b) => a[0].localeCompare(b[0]));

function matchingRange(old, start, canonical, oldSources, omittedContextIds, changedContextIds) {
  const previous = old.sourceStepIds.map(id => oldSources.get(id));
  if (clean(old) && previous.every(clean)) {
    // Revalidation can split a source batch. The old diagram still applies
    // when every placement, its direction and working scope are exact.
    // Keep the NEW validated internal sequence in orderedOperations.
    const sources = [];let count = 0;
    for (let i=start;i<canonical.length && count<old.newBrickIds.length;i++) {
      const s = canonical[i];
      if (!clean(s) || s.moduleId !== old.moduleId || !same(scope(s.nestedRecipe),scope(previous[0].nestedRecipe))
        || !same(s.workingOrientation,previous[0].workingOrientation)
        || !same(s.nestedRecipePath?.map(scope),previous[0].nestedRecipePath?.map(scope))) return null;
      sources.push(s);count += s.newBrickIds.length;
    }
    // A moved failed component is absent until its real attachment. Its old
    // ghost cannot force unrelated tasks apart; draw the newly validated scene.
    // A physically replayed module reorder can change background context.
    // The caller must validate placements, joins and visibility separately.
    const scene=sources.at(-1)?.visibleBrickIds??[];
    const expected=old.visibleBrickIds.filter(id=>!omittedContextIds.has(id)||scene.includes(id));
    return sources.length && same(placements(previous),placements(sources))
      && old.newBrickIds.every(id=>scene.includes(id))
      && sameScene(scene.filter(id=>!changedContextIds.has(id)),expected.filter(id=>!changedContextIds.has(id))) ? sources : null;
  }
  const sources = canonical.slice(start,start+previous.length);
  return sources.length === previous.length && sources.every((s,i) => same(payload(s),payload(previous[i])))
    && sameScene(sources.at(-1).visibleBrickIds,old.visibleBrickIds) ? sources : null;
}

/** Preserve readable diagrams only over an exactly revalidated placement range. */
export function retainUnchangedDiagrams(before,after,{omittedContextIds=new Set(),changedContextIds=new Set()}={}) {
  const oldSources = new Map(before.assemblyPlan.steps.map(s => [s.id,s]));
  const key = s => s.newBrickIds[0] ?? JSON.stringify(payload(s));
  const options = new Map(before.instructionPlan.steps.flatMap(s => s.newBrickIds.length
    ? s.newBrickIds.map(id => [id,s]) : [[key(oldSources.get(s.sourceStepIds[0])),s]]));
  const canonical = after.assemblyPlan.steps;
  const proposed = new Map(after.instructionPlan.steps.map(s => [s.sourceStepIds[0],s]));
  // Choose a complete partition: retaining a range must not strand the tail
  // inside a proposed diagram at an unvalidated boundary.
  const best = Array(canonical.length+1);best[canonical.length] = {retained:0,count:0};
  for (let i=canonical.length-1;i>=0;i--) {
    const choices = [],diagram = proposed.get(canonical[i].id);
    if (diagram && best[i+diagram.sourceStepIds.length]) choices.push({diagram,end:i+diagram.sourceStepIds.length,retained:0});
    const old = options.get(key(canonical[i])),sources = old && matchingRange(old,i,canonical,oldSources,omittedContextIds,changedContextIds);
    const recipeSource=old?.kind==='join'?sources?.at(-1):sources?.[0];
    if (sources && best[i+sources.length]) choices.push({diagram:{...old,sourceStepIds:sources.map(s => s.id),
      visibleBrickIds:sources.at(-1).visibleBrickIds,orderedOperations:operations(sources),
      ...(!old.attachmentTask&&recipeSource.nestedRecipe?{nestedRecipe:recipeSource.nestedRecipe}:{}),
      ...(!old.attachmentTask&&recipeSource.nestedRecipePath?{nestedRecipePath:recipeSource.nestedRecipePath}:{})},end:i+sources.length,retained:sources.length});
    for (const choice of choices) { const tail = best[choice.end];choice.retained += tail.retained;choice.count = tail.count+1; }
    choices.sort((a,b) => b.retained-a.retained || a.count-b.count);best[i] = choices[0];
  }
  if (!best[0]) throw Error('Cannot preserve existing diagram boundary');
  const output = [];for (let i=0;i<canonical.length;i=best[i].end) output.push(best[i].diagram);
  let steps = output.map((s,i) => ({...s,id:`instruction-step-${i+1}`}));
  for (const field of ['componentTask','buildRegion']) {
    const groups = new Map();
    for (const s of steps) if (s[field]) { const id = s[field].id;if (!groups.has(id)) groups.set(id,[]);groups.get(id).push(s); }
    steps = steps.map(s => {
      if (!s[field]) return s;
      const members = groups.get(s[field].id);
      if (s[field].total !== undefined && members.length !== s[field].total) { const copy = {...s};delete copy[field];return copy; }
      return {...s,[field]:{...s[field],lastStepId:members.at(-1).id}};
    });
  }
  steps=refreshTableRecipeReferences(steps);
  const instructionPlan = {...after.instructionPlan,steps,stats:{...after.instructionPlan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s => s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s) => n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
  return {...after,instructionPlan,guide:createGuideSections(instructionPlan),
    assemblyEvaluation:{...after.assemblyEvaluation,compaction:{...after.assemblyEvaluation?.compaction,
      sourceStepCount:canonical.length,instructionDiagramCount:steps.length,
      mergedDiagramCount:steps.filter(s => s.sourceStepIds.length>1).length,collapsedStepCount:canonical.length-steps.length,
      sourceStepCoverageComplete:same(steps.flatMap(s => s.sourceStepIds),canonical.map(s => s.id))}}};
}

/** Refresh references without merging distinct table recipes or working scopes. */
export function refreshTableRecipeReferences(steps){
  // A retained course can outlive its old diagram ID. Resolve completion by
  // its recipe and working scope, not by the last table task in the module:
  // one module can contain more than one independently completed recipe.
  const recipeKey=s=>JSON.stringify([s.moduleId,scope(s.nestedRecipe),s.tableRecipe.completionStepId,s.tableRecipe.total,s.tableRecipe.layerTask??false]);
  const completions=new Map();
  for(const s of steps)if(s.tableRecipe?.ordinal===s.tableRecipe?.total&&s.tableRecipe){
    const key=recipeKey(s);
    completions.set(key,completions.has(key)?null:s.id);
  }
  return steps.map(s=>{
    if(!s.tableRecipe)return s;
    const completionStepId=completions.get(recipeKey(s));
    return completionStepId&&completionStepId!==s.tableRecipe.completionStepId?{...s,tableRecipe:{...s.tableRecipe,completionStepId}}:s;
  });
}
