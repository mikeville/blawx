import {createGuideSections} from './guide-sections.js';
import {evaluateInstructionVisibility} from './instruction-visibility.js';
import {nestedRecipeScopes} from './nested-recipe-references.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
const overlap = (a, b) => Math.max(0, Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))
  * Math.max(0, Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z));
const parentPath = step => nestedRecipeScopes(step).slice(0,-1);

function singletonJoin(step, sources) {
  if (step.kind !== 'join' || step.insertionDirection !== 'up' || step.issues.length
    || step.attachmentTask || step.tableRecipe || step.instructionAction
    || step.joinContext?.direction !== 'up' || step.joinContext.supportGroups.length !== 1
    || step.joinContext.requiresAlignment || !step.nestedRecipe?.separate
    || step.newBrickIds.length !== 1 || !same(step.newBrickIds,step.highlightBrickIds)
    || step.sourceStepIds?.length !== 2) return false;
  const [build,join] = step.sourceStepIds.map(id => sources.get(id));
  return build?.kind === 'build' && join?.kind === 'join' && !build.issues.length && !join.issues.length
    && same(build.newBrickIds,step.newBrickIds) && !join.newBrickIds.length
    && same(join.highlightBrickIds,step.highlightBrickIds) && same(join.joinContext,step.joinContext)
    && build.nestedRecipe?.id === step.nestedRecipe.id && join.nestedRecipe?.id === step.nestedRecipe.id
    && step.nestedRecipe.firstStepId === build.id && step.nestedRecipe.attachmentStepId === join.id
    && same(step.orderedOperations?.map(op=>op.id),step.sourceStepIds);
}

function connected(ids, edges) {
  const allowed = new Set(ids), reached = new Set([ids[0]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const {a,b} of edges) if (allowed.has(a) && allowed.has(b) && reached.has(a) !== reached.has(b)) {
      reached.add(a); reached.add(b); changed = true;
    }
  }
  return reached.size === allowed.size;
}

function combine(run, plan, byId) {
  const first = run[0], last = run.at(-1), ids = run.flatMap(s=>s.newBrickIds);
  const bricks = ids.map(id=>byId.get(id));
  if (new Set(ids).size !== ids.length || bricks.some(b=>!b)
    || new Set(bricks.map(b=>b.y)).size !== 1
    || new Set(bricks.map(b=>`${b.w},${b.d},${b.color}`)).size > 4) return null;
  for (const axis of ['x','z']) if (Math.max(...bricks.map(b=>b[axis]+b[axis==='x'?'w':'d']))
    - Math.min(...bricks.map(b=>b[axis])) > 32) return null;
  const receiver = first.joinContext.supportGroups[0].brickIds;
  if (!receiver.length || receiver.some(id=>!byId.has(id) || ids.includes(id))
    || !connected(receiver,plan.graph.edges)) return null;
  const prior = first.visibleBrickIds.filter(id=>!ids.includes(id));
  if (receiver.some(id=>!prior.includes(id))) return null;
  const contacts = [];
  for (let i=0;i<run.length;i++) {
    const step=run[i], group=step.joinContext.supportGroups[0];
    if (!sameSet(step.visibleBrickIds,[...prior,...ids.slice(0,i+1)])
      || !sameSet(group.brickIds,[...receiver,...ids.slice(0,i)])
      || step.joinContext.supportFloorY !== Math.min(...group.brickIds.map(id=>byId.get(id).y))
      || !group.contacts.length) return null;
    for (const contact of group.contacts) {
      const support=byId.get(contact.supportBrickId), piece=bricks[i];
      if (!receiver.includes(contact.supportBrickId) || contact.bandBrickId !== piece.id
        || support.y !== piece.y+1 || overlap(piece,support) !== contact.studs || contact.studs <= 0) return null;
      contacts.push(contact);
    }
  }
  // The viewer chooses one of these underside views. Every piece must remain
  // legible in each possible selection, including the smallest additions.
  for (const angle of [.25,.75,1.25,1.75]) {
    const view=evaluateInstructionVisibility({visibleBricks:last.visibleBrickIds.map(id=>byId.get(id)),
      highlightGroups:bricks.map(b=>({id:b.id,bricks:[b]})),azimuth:angle*Math.PI,elevation:-Math.PI/7});
    if (!view.passes || view.truncated) return null;
  }
  const combined={...last,id:first.id,label:'Attach underside pieces',newBrickIds:ids,highlightBrickIds:[...ids],
    sourceStepIds:run.flatMap(s=>s.sourceStepIds),orderedOperations:run.flatMap(s=>s.orderedOperations),
    joinContext:{...first.joinContext,supportGroups:[{...first.joinContext.supportGroups[0],contacts}]},
    attachmentTask:{kind:'individual-pieces',sourceDiagramIds:run.map(s=>s.id),
      placements:run.map(s=>({brickId:s.newBrickIds[0],sourceStepIds:s.sourceStepIds,nestedRecipe:s.nestedRecipe}))}};
  // These are completed sibling placements, not a join completing any one
  // child or its enclosing parent. Canonical child references stay in placements.
  delete combined.nestedRecipe;
  delete combined.nestedRecipePath;
  if (parentPath(first).length) combined.nestedRecipePath=parentPath(first);
  return combined;
}

/** Consolidate reader tasks while retaining every validated source operation. */
export function consolidateUnderAttachmentTasks(result) {
  const plan=result.instructionPlan;
  if (!plan || !result.assemblyPlan || result.assemblyError || result.semanticGuide) return result;
  const byId=new Map(plan.bricks.map(b=>[b.id,b])), sources=new Map(result.assemblyPlan.steps.map(s=>[s.id,s]));
  const protectedSteps=new Set((result.guide?.sections ?? []).filter(s=>s.semanticLabel && s.semanticConfidence)
    .flatMap(s=>s.stepIds));
  const eligible=step=>!protectedSteps.has(step.id) && singletonJoin(step,sources);
  const steps=[], tasks=[], remap=new Map();
  for (let index=0;index<plan.steps.length;) {
    const first=plan.steps[index];
    if (!eligible(first)) { steps.push(first); index++; continue; }
    let end=index+1;
    while (end<plan.steps.length && end-index<8 && eligible(plan.steps[end])
      && plan.steps[end].moduleId===first.moduleId && same(parentPath(plan.steps[end]),parentPath(first))) end++;
    let merged=null, length=end-index;
    for (;length>=2;length--) if ((merged=combine(plan.steps.slice(index,index+length),plan,byId))) break;
    if (!merged) { steps.push(first); index++; continue; }
    steps.push(merged); tasks.push(merged);
    for (const id of merged.attachmentTask.sourceDiagramIds) remap.set(id,merged.id);
    index+=length;
  }
  if (!tasks.length) return result;
  for (const key of ['newBrickIds','sourceStepIds','orderedOperations']) {
    if (!same(steps.flatMap(s=>s[key]),plan.steps.flatMap(s=>s[key]))) return result;
  }
  const updated=steps.map(s=>s.tableRecipe && remap.has(s.tableRecipe.completionStepId)
    ? {...s,tableRecipe:{...s.tableRecipe,completionStepId:remap.get(s.tableRecipe.completionStepId)}} : s);
  const instructionPlan={...plan,steps:updated,stats:{...plan.stats,stepCount:updated.length,
    maxBricksPerStep:Math.max(...updated.map(s=>s.newBrickIds.length)),
    planReferenceCount:updated.reduce((n,s)=>n+s.visibleBrickIds.length+s.newBrickIds.length+s.highlightBrickIds.length,0)}};
  const compaction=result.assemblyEvaluation?.compaction;
  return {...result,instructionPlan,guide:createGuideSections(instructionPlan),
    underAttachmentTasks:{beforeDiagrams:plan.steps.length,afterDiagrams:updated.length,
      tasks:tasks.map(s=>({stepId:s.id,...s.attachmentTask}))},
    ...(compaction?{assemblyEvaluation:{...result.assemblyEvaluation,compaction:{...compaction,
      instructionDiagramCount:updated.length,collapsedStepCount:compaction.sourceStepCount-updated.length,
      mergedDiagramCount:updated.filter(s=>s.sourceStepIds.length>1).length}}}:{})};
}
