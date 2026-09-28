import {guideComponents} from './guide-components.js';
import {nestedRecipeScopes} from './nested-recipe-references.js';
import { escapeMarkup } from './part-illustration.js';

const WARNING_COPY = {
  'temporary-hold': 'Keep this section supported on a flat surface while building. Its stability has not been verified.',
  'limited-support': 'Only a small part of this brick engages the adjoining bricks. Support it while pressing the next pieces into place; strength is not verified.',
  'unsupported-addition': 'This piece has no verified support below it. A support or connection is still needed before this step can be built.',
  'no-stud-engagement': 'This section does not connect to the model by studs. Its attachment still needs a design change.',
  'unresolved-prerequisite': 'An earlier connection is unresolved. Resolve that connection before adding this section.',
  'blocked-insertion': 'Earlier pieces block this placement. The build order or connection still needs a design change.',
  'blocked-module-insertion': 'Earlier pieces block this attachment. The build order or connection still needs a design change.',
  'future-path-blocked': 'This placement would block a later piece. The build order still needs a design change.',
  'disconnected-clusters': 'These pieces are not connected as one section. Their attachments still need a design change.',
  'disconnected-work-surface': 'This section cannot yet be lifted as one connected assembly. Its connections still need a design change.',
};

function placementMap(bricks, highlighted, contacts = []) {
  if (!bricks.length) return null;
  const minX = Math.min(...bricks.map(b => b.x));
  const minZ = Math.min(...bricks.map(b => b.z));
  const width = Math.max(...bricks.map(b => b.x + b.w)) - minX;
  const depth = Math.max(...bricks.map(b => b.z + b.d)) - minZ;
  if (width > 64 || depth > 64) return null;
  return {width, depth, bricks: bricks.map(b => ({x:b.x-minX, z:b.z-minZ, w:b.w, d:b.d,
    added:highlighted.has(b.id)})), contacts:contacts.map(c => ({x:c.x-minX, z:c.z-minZ}))};
}

function followsMatchingOppositeEnd(plan, step, module, additions, byId) {
  const previous=plan.steps[plan.steps.indexOf(step)-1];
  if(!module||!additions.length||previous?.moduleId!==step.moduleId||previous.kind!=='build'||step.kind!=='build')return false;
  const earlier=previous.newBrickIds.map(id=>byId.get(id));
  if(earlier.length!==additions.length||new Set([...earlier,...additions].map(b=>b.y)).size!==1)return false;
  const bounds=bs=>({x:Math.min(...bs.map(b=>b.x)),z:Math.min(...bs.map(b=>b.z)),
    maxX:Math.max(...bs.map(b=>b.x+b.w)),maxZ:Math.max(...bs.map(b=>b.z+b.d))});
  const a=bounds(earlier),b=bounds(additions),whole=bounds(module.brickIds.map(id=>byId.get(id)));
  const shape=(bs,origin)=>bs.map(p=>`${p.x-origin.x},${p.z-origin.z}:${p.w},${p.d}:${p.color}`).sort().join('|');
  if(shape(earlier,a)!==shape(additions,b))return false;
  return ['x','z'].some(axis=>{
    const other=axis==='x'?'z':'x',end=axis==='x'?'maxX':'maxZ';
    const low=a[axis]<b[axis]?a:b,high=low===a?b:a;
    return a[other]===b[other]&&high[axis]-low[end]>=2
      &&low[axis]===whole[axis]&&high[end]===whole[end];
  });
}

// All wording and measurements come from the displayed plan, including its
// compacted numbering. No subject names or guessed orientation are required.
export function createStepGuidance(plan, step, numbering, repetition = null) {
  const byId = new Map((plan.bricks ?? []).map(b => [b.id,b]));
  const module = plan.modules?.find(m => m.id === step.moduleId);
  const foundation = plan.moduleRecipes?.[module?.id]?.kind === 'foundation';
  const visible = (step.visibleBrickIds ?? []).map(id => byId.get(id)).filter(Boolean);
  const highlighted = new Set(step.highlightBrickIds ?? []);
  const additions = (step.newBrickIds ?? []).map(id => byId.get(id)).filter(Boolean);
  const messages = [...new Set((step.issues ?? []).map(issue => WARNING_COPY[issue.code] ?? issue.message).filter(Boolean))];
  const warning = messages.join(' ') || 'This connection has not been verified. Review the support and placement before building.';
  let instruction = '';
  let map = null;
  let mapLabel = 'Base layer';
  const separateRecipe = nestedRecipeScopes(step).findLast(scope=>scope.separate);
  const component = guideComponents(plan).find(c => c.moduleIds.includes(step.moduleId));
  const joins = plan.steps.filter(s => s.kind === 'join' && ['down','up'].includes(s.joinContext?.direction) && !s.nestedRecipe && !s.attachmentTask);
  if (step.kind === 'join' && step.joinContext?.direction === 'up') {
    const item = highlighted.size === 1 ? 'piece' : 'completed assembly';
    instruction = step.nestedRecipe
      ? `Support the connected section you are building. Align this ${item} underneath it, with its studs facing up, then press it into place.`
      : `Support the connected model. Align this ${item} underneath it, with its studs facing up, then press it into place.`;
  } else if (step.kind === 'join' && step.joinContext?.direction === 'down') {
    const groups = step.joinContext.supportGroups;
    const contacts = groups.flatMap(group => (group.contacts ?? []).flatMap(contact => {
      const lower = byId.get(contact.supportBrickId), upper = byId.get(contact.bandBrickId);
      if (!lower || !upper || lower.y + 1 !== upper.y) return [];
      const cells = [];
      for(let x=Math.max(lower.x,upper.x);x<Math.min(lower.x+lower.w,upper.x+upper.w);x++) {
        for(let z=Math.max(lower.z,upper.z);z<Math.min(lower.z+lower.d,upper.z+upper.d);z++) cells.push({x,z});
      }
      return cells;
    }));
    const completedBases = groups.length > 0 && groups.every(group => (plan.modules ?? []).some(m => /^Base assembly \d+$/.test(m.label)
      && (group.brickIds ?? []).some(id => m.brickIds.includes(id))));
    const unit = completedBases ? 'assembly' : 'support';
    instruction = `Line up the ${groups.length === 1 ? unit : `${groups.length} ${completedBases ? 'assemblies' : 'supports'}`} as shown, then lower the assembled section onto ${contacts.length ? `the ${contacts.length} marked studs` : 'them'}. Press above each connection.`;
    const supports = new Set(groups.flatMap(g => g.brickIds ?? []));
    map = placementMap(visible.filter(b => supports.has(b.id)), new Set(), contacts);
    mapLabel = 'Support positions';
    if (step.nestedRecipe) instruction = `Attach this assembly to the section you are building.${contacts.length ? ` Line up the ${contacts.length} marked studs.` : ''}`;
  } else if (separateRecipe) {
    const nested = separateRecipe;
    const first = plan.steps.find(s => nestedRecipeScopes(s).some(scope=>scope.id===nested.id) && s.kind !== 'join');
    const attachment = plan.steps.find(s => s.nestedRecipe?.id === nested.id && s.kind === 'join');
    const joinNumber = attachment && numbering.byStepId.get(attachment.id);
    if (first?.id === step.id) {
      if (repetition?.copies > 1) {
        const attachments = repetition.attachmentStepIds.map(id => numbering.byStepId.get(id));
        instruction = `Build ${repetition.copies} copies of this assembly separately on a flat table.`;
        if (attachments.every(Number.isInteger)) instruction += ` Attach them in steps ${attachments.join(', ')}.`;
      } else instruction = `Build this assembly separately on a flat table.${joinNumber ? ` Attach it to the section you are building in step ${joinNumber}.` : ''}`;
    }
    if (additions.some(b => b.y === nested.floorY)) {
      map = placementMap(visible.filter(b => b.y === nested.floorY), highlighted);
      if (additions.some(b => b.y > nested.floorY)) instruction += ' Place the lower pieces first, then connect them with the pieces above.';
    }
  } else if (module?.buildContext?.kind === 'work-surface') {
    const first = plan.steps.find(s => s.moduleId === module.id && s.kind !== 'join');
    const join = joins.find(s => s.moduleId === module.id);
    const joinNumber = join && numbering.byStepId.get(join.id);
    if (first?.id === step.id) instruction = `Build this section separately on a flat table.${joinNumber ? ` Attach it in step ${joinNumber}.` : ''}`;
    const floor = step.nestedRecipe?.floorY ?? module.buildContext.floorY;
    if (additions.some(b => b.y === floor)) {
      map = placementMap(visible.filter(b => b.y === floor), highlighted);
      const placement = additions.some(b => b.y > floor)
        ? 'Place the lower pieces first, then connect them with the pieces above.'
        : 'Keep these base pieces flat on the table until they are joined.';
      instruction = instruction ? `${instruction} ${placement}` : placement;
    }
  } else {
    const laterJoin = component?.attachment ?? joins.find(s => s.joinContext.supportGroups.some(g =>
      (g.brickIds ?? []).some(id => highlighted.has(id))));
    const joinNumber = laterJoin && numbering.byStepId.get(laterJoin.id);
    if (joinNumber && additions.some(b => b.y === 0)) {
      instruction = `Build this ${/^Base assembly \d+$/.test(module?.label) ? 'assembly' : 'support'} on a flat table. Keep it there until step ${joinNumber}.`;
      map = placementMap(additions.filter(b => b.y === 0), highlighted);
    }
    if (joinNumber && /^Base assembly \d+$/.test(module?.label)
      && (component?.steps ?? plan.steps.filter(s => s.moduleId === module.id)).filter(s => s.newBrickIds.length).at(-1)?.id === step.id) {
      instruction = `Set this completed assembly aside. Attach it in step ${joinNumber}.`;
    }
  }
  const action = step.instructionAction?.kind;
  if (action === 'foundation') {
    const message='Lay out this short foundation on the table. Connect it in the next step.';
    const introduction=instruction.includes('Build this section separately')?instruction.split(' Keep these')[0]:'';
    instruction=introduction ? `${introduction} ${message}` : message;
  } else if (action === 'bond') {
    instruction='Connect the foundation pieces with this layer.';
  }
  const destination = step.instructionAction?.destination;
  if (destination?.kind === 'layer') {
    if(destination.course===destination.firstCourse) {
      const first=plan.steps.find(s=>s.moduleId===module.id&&s.newBrickIds.length);
      const join=joins.find(s=>s.moduleId===module.id),joinNumber=join&&numbering.byStepId.get(join.id);
      const introduction=first?.id===step.id
        ? `Lay out the base on a flat table.${joinNumber?` Attach the finished section in step ${joinNumber}.`:''} `:'';
      instruction=introduction+(destination.ordinal===destination.total
        ? 'Complete the base layer. Keep the pieces in place until the next layer connects them.'
        : 'Continue the base layer in the next step. Keep these pieces flat on the table.');
    } else {
      instruction=destination.ordinal===destination.total
        ? destination.course===destination.lastCourse?'Complete the top layer.':'Complete this layer to connect the base pieces.'
        : destination.ordinal>1?'Continue this layer across the completed surface.'
          : destination.course===destination.firstCourse+1?'Add the connecting layer across the base.':'Start the next layer across the completed surface.';
    }
  }
  if (destination?.kind === 'band') {
    if (action === 'foundation') {
      const first = plan.steps.find(s => s.moduleId === module.id && s.newBrickIds.length);
      const join = joins.find(s => s.moduleId === module.id);
      const joinNumber = join && numbering.byStepId.get(join.id);
      const introduction = first?.id === step.id
        ? `Build this section on a flat table.${joinNumber ? ` Attach it in step ${joinNumber}.` : ''} ` : '';
      instruction = `${introduction}${destination.ordinal === 1
        ? 'Lay out the base pieces for the first strip.'
        : 'Extend the base across the full width, as shown.'} Connect these pieces in the next step.`;
    } else if (action === 'bond') {
      instruction = destination.ordinal === 1
        ? 'Join the base pieces across the strip.'
        : 'Join the new base pieces to the completed section.';
    } else if (action === 'complete-band') {
      instruction = destination.ordinal === destination.total
        ? 'Finish the last strip to complete this surface.'
        : 'Finish the top of this strip before extending the base.';
    }
  }
  if(step.tableRecipe&&!step.tableRecipe.layerTask) {
    const {ordinal,total,completionStepId}=step.tableRecipe;
    const completion=numbering.byStepId.get(completionStepId);
    const join=joins.find(s=>s.moduleId===module?.id),joinNumber=join&&numbering.byStepId.get(join.id);
    instruction=ordinal===1
      ? `Lay out the complete base on a flat table. Keep this section flat${completion?` through step ${completion}`:' until all its layers are complete'}.${joinNumber?` Attach the finished section in step ${joinNumber}.`:''}`
      : ordinal===total ? plan.moduleRecipes?.[module?.id]?.kind==='foundation'
        ? 'Complete the top layer.' : 'Complete the top layer before attaching this section.'
        : 'Complete this layer. Keep the section flat on the table.';
  }
  if(step.placementTask?.kind==='ground-layout') {
    instruction='Lay out these base pieces on a flat table. Keep them in place as you build upwards.';
    map=placementMap(visible.filter(b=>b.y===0),highlighted);
  }else if(step.placementTask?.kind==='upright-layers') {
    instruction=`Add these ${step.placementTask.layerCount} matching layers to each upright, working from the bottom up.`;
  }
  if(!instruction&&followsMatchingOppositeEnd(plan,step,module,additions,byId)) {
    instruction='Add the matching pieces at the opposite end.';
  }
  if(!instruction&&step.buildRegion?.index===1&&step.buildRegion.total>1) {
    const lastNumber=numbering.byStepId.get(step.buildRegion.lastStepId);
    if(lastNumber)instruction=`Build up this area through step ${lastNumber}.`;
  }
  if (!instruction && step.componentTask) {
    const task=step.componentTask,last=numbering.byStepId.get(task.lastStepId);
    if(task.index===1&&task.total>1&&last) instruction=`Build up this section through step ${last} before moving to the next area.`;
    else if(new Set(additions.map(b=>b.y)).size>1) instruction='Place the lower pieces first, then build upwards to complete this part of the section.';
  }
  if (step.groundLayout) {
    const {ordinal,total} = step.groundLayout;
    instruction = ordinal === total
      ? 'Complete the base outline on a flat table before building upwards.'
      : 'Lay out this part of the base on a flat table. Continue the outline in the next step.';
    map = placementMap(visible.filter(b => b.y === 0),highlighted);
    mapLabel = 'Base layout';
  }
  if (step.insertionDirection === 'up' && step.kind === 'build') {
    instruction = foundation || module?.buildContext?.kind === 'work-surface'
      ? 'Lift the connected section off the table. Attach these pieces underneath, with their studs facing up, then return the section to the table.'
      : 'Support the model and attach these pieces from underneath, with their studs facing up.';
  }
  if(module?.sharedHandledRecipe){
    const family=(plan.modules??[]).filter(m=>m.sharedHandledRecipe?.familyId===module.sharedHandledRecipe.familyId);
    const ids=new Set(family.map(m=>m.id)),attachments=plan.steps.filter(s=>ids.has(s.moduleId)&&s.kind==='join');
    const numbers=attachments.map(s=>numbering.byStepId.get(s.id)).filter(Number.isFinite);
    const where=numbers.length===attachments.length?` Attach them in steps ${numbers.join(' and ')}.`:'';
    const builds=plan.steps.filter(s=>s.moduleId===module.id&&s.kind==='build');
    if(step.kind==='join')instruction=attachments.at(-1)?.id===step.id
      ? 'Attach the remaining completed assembly as shown.' : 'Attach one of the completed assemblies as shown.';
    else if(builds[0]?.id===step.id)instruction=`Build ${family.length} copies of this assembly on a flat table.${where}`;
    else if(builds.at(-1)?.id===step.id)instruction=`Set the completed assemblies aside.${where}`;
  }
  if(module?.mirroredAssembly&&step.kind==='build'){
    const first=plan.steps.find(s=>s.moduleId===module.id&&s.kind==='build');
    const source=plan.steps.filter(s=>s.moduleId===module.mirroredAssembly.sourceModuleId&&s.kind==='build');
    const start=source.length&&numbering.byStepId.get(source[0].id),end=source.length&&numbering.byStepId.get(source.at(-1).id);
    if(first?.id===step.id&&start&&end&&plan.steps.indexOf(source.at(-1))<plan.steps.indexOf(first)){
      instruction=`Build a separate mirrored version of the assembly from ${start===end?`step ${start}`:`steps ${start}–${end}`}. Follow the orientation shown here.${instruction?` ${instruction}`:''}`;
    }
  }
  if (step.attachmentTask?.kind === 'individual-pieces') {
    instruction = 'Support the connected section. Attach these pieces underneath one at a time, with their studs facing up. Each arrow marks a separate placement.';
  }
  if (foundation && plan.steps.find(s=>s.moduleId===step.moduleId&&s.newBrickIds.length)?.id===step.id) {
    const own = plan.steps.filter(s=>s.moduleId===step.moduleId);
    const lift = own.findIndex(s=>s.insertionDirection==='up');
    const completion = lift>0 ? numbering.byStepId.get(own[lift-1].id) : null;
    instruction = `Lay out these pieces on a flat table. Keep this section flat${completion ? ` through step ${completion}` : ' until the pieces are connected'}.`;
  }
  if (step.completedCourse) {
    instruction = `${instruction ? `${instruction} ` : ''}Complete this layer before continuing.`;
    map = placementMap(visible.filter(b => b.y === step.completedCourse.course), highlighted);
    mapLabel = 'Layer layout';
  }
  const previous=plan.steps[plan.steps.indexOf(step)-1];
  const inverted=step.workingOrientation?.kind==='inverted';
  if(inverted){
    const first=previous?.workingOrientation?.kind!=='inverted'
      ||previous.nestedRecipe?.id!==step.nestedRecipe?.id;
    instruction=first?'Build this section upside down on a flat table, with its studs facing the table.':'';
    if(step.workingFeature)instruction=`${instruction} Complete this raised feature from its bottom layer upwards.`.trim();
    // A canonical top-down map would contradict the displayed working pose.
    map=null;
  }else if(previous?.workingOrientation?.kind==='inverted'){
    instruction=`Turn the completed section upright. ${instruction}`.trim();
  }
  return {instruction, warning, map, mapLabel};
}

export function guidanceMarkup(guidance) {
  if (!guidance?.instruction && !guidance?.map) return '';
  let map = '';
  if (guidance.map) {
    const {width,depth,bricks,contacts} = guidance.map;
    const rects = bricks.map(b => `<rect x="${b.x}" y="${b.z}" width="${b.w}" height="${b.d}" fill="${b.added ? '#f5cfdb' : '#dededb'}" stroke="#444" stroke-width=".08"/>`).join('');
    const grid = [];
    for(let x=0;x<=width;x++) grid.push(`M${x},0V${depth}`);
    for(let z=0;z<=depth;z++) grid.push(`M0,${z}H${width}`);
    const dots = contacts.map(c => `<circle cx="${c.x+.5}" cy="${c.z+.5}" r=".3" fill="#a02352"/>`).join('');
    const label = `${guidance.mapLabel}, top view. ${width} by ${depth} studs. One grid square is one stud.${contacts.length ? ' Dots mark connection studs.' : ' Pink marks new pieces.'}`;
    map = `<details class="manual-placement-map"><summary>Placement map · ${width} × ${depth} studs</summary><svg role="img" aria-label="${escapeMarkup(label)}" viewBox="-.5 -.5 ${width+1} ${depth+1}">${rects}<path d="${grid.join('')}" fill="none" stroke="#888" stroke-width=".025"/>${dots}</svg><p>${escapeMarkup(label)}</p></details>`;
  }
  return `<div class="manual-guidance">${guidance.instruction ? `<p>${escapeMarkup(guidance.instruction)}</p>` : ''}${map}</div>`;
}
