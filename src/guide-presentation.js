import { varyGuideSectionLabels } from './guide-label-variation.js';

const QUARTER_TURNS = 4;
const MAX_PART_STEPS = 12;

function rotatePart(brick, rotationQuarterTurns) {
  switch (rotationQuarterTurns % QUARTER_TURNS) {
    case 1: return { ...brick, x: -brick.z - brick.d, z: brick.x, w: brick.d, d: brick.w };
    case 2: return { ...brick, x: -brick.x - brick.w, z: -brick.z - brick.d };
    case 3: return { ...brick, x: brick.z, z: -brick.x - brick.w, w: brick.d, d: brick.w };
    default: return { ...brick };
  }
}

function boundsOrigin(bricks) {
  return {
    x: Math.min(...bricks.map((brick) => brick.x)),
    y: Math.min(...bricks.map((brick) => brick.y)),
    z: Math.min(...bricks.map((brick) => brick.z)),
  };
}

function partKey(brick, origin) {
  return `${brick.x - origin.x},${brick.y - origin.y},${brick.z - origin.z}:${brick.w}x${brick.d}:${brick.color}`;
}

function inventoryFor(bricks) {
  const entries = new Map();
  for (const brick of bricks) {
    const w = Math.min(brick.w, brick.d);
    const d = Math.max(brick.w, brick.d);
    const key = `${w}x${d}:${brick.color}`;
    const entry = entries.get(key) ?? { key, w, d, color: brick.color, count: 0 };
    entry.count += 1;
    entries.set(key, entry);
  }
  return [...entries.values()].sort((a, b) => a.w - b.w || a.d - b.d || a.color.localeCompare(b.color));
}

function validateInputs(plan, guide) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('plan must be an object.');
  if (!guide || typeof guide !== 'object' || Array.isArray(guide)) throw new TypeError('guide must be an object.');
  if (!Array.isArray(plan.bricks) || !Array.isArray(plan.modules) || !Array.isArray(plan.steps)) {
    throw new TypeError('plan must contain bricks, modules, and steps arrays.');
  }
  if (!Array.isArray(guide.sections)) throw new TypeError('guide must contain a sections array.');

  const uniqueMap = (items, name) => {
    const result = new Map();
    for (const item of items) {
      if (typeof item?.id !== 'string' || result.has(item.id)) throw new RangeError(`${name} IDs must be unique strings.`);
      result.set(item.id, item);
    }
    return result;
  };
  const bricksById = uniqueMap(plan.bricks, 'Plan brick');
  const modulesById = uniqueMap(plan.modules, 'Plan module');
  const stepsById = uniqueMap(plan.steps, 'Plan step');
  const sectionIds = new Set();
  const covered = [];
  for (const section of guide.sections) {
    if (typeof section?.id !== 'string' || sectionIds.has(section.id)) throw new RangeError('Guide section IDs must be unique strings.');
    sectionIds.add(section.id);
    if (!Array.isArray(section.brickIds) || !Array.isArray(section.moduleIds) || !Array.isArray(section.stepIds)) {
      throw new TypeError(`Guide section ${section.id} must contain brickIds, moduleIds, and stepIds arrays.`);
    }
    for (const brickId of section.brickIds) {
      if (!bricksById.has(brickId)) throw new RangeError(`Guide section ${section.id} references an unknown brick.`);
      covered.push(brickId);
    }
    for (const moduleId of section.moduleIds) if (!modulesById.has(moduleId)) {
      throw new RangeError(`Guide section ${section.id} references an unknown module.`);
    }
    for (const stepId of section.stepIds) if (!stepsById.has(stepId)) {
      throw new RangeError(`Guide section ${section.id} references an unknown step.`);
    }
  }
  if (covered.length !== bricksById.size || new Set(covered).size !== bricksById.size) {
    throw new RangeError('Guide presentation requires every plan brick in exactly one source section.');
  }
  return { bricksById, modulesById, stepsById };
}

function issueSignature(step, rotationQuarterTurns, origin, context) {
  return (step.issues ?? []).map(({ code, severity, brickIds = [] }) => {
    const affected = brickIds.map((brickId) => {
      const brick = context.bricksById.get(brickId);
      return brick ? partKey(rotatePart(brick, rotationQuarterTurns), origin) : `external:${brickId}`;
    }).sort().join(',');
    return `${code}:${severity ?? ''}:[${affected}]`;
  }).sort().join(',');
}

function semanticSignature(section) {
  if (!Object.hasOwn(section, 'semanticConfidence') && !Object.hasOwn(section, 'semanticLabel')) return '';
  const confidence = section.semanticConfidence ?? 'uncertain';
  const hasUsableLabel = confidence === 'high' || confidence === 'inferred';
  const label = hasUsableLabel && typeof section.semanticLabel === 'string'
    ? section.semanticLabel.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
  return `${hasUsableLabel ? 'named' : confidence}:${label}`;
}

function sectionSignature(section, rotationQuarterTurns, context) {
  const rotated = section.brickIds.map((brickId) => rotatePart(context.bricksById.get(brickId), rotationQuarterTurns));
  const origin = boundsOrigin(rotated);
  const geometry = rotated.map((brick) => partKey(brick, origin)).sort().join('|');
  const stepStructure = section.stepIds.map((stepId) => {
    const step = context.stepsById.get(stepId);
    const additions = step.newBrickIds
      .map((brickId) => partKey(rotatePart(context.bricksById.get(brickId), rotationQuarterTurns), origin))
      .sort().join(',');
    return `${step.kind}:${step.insertionDirection ?? 'down'}:${issueSignature(step, rotationQuarterTurns, origin, context)}:[${additions}]`;
  }).join('|');
  const groupStructure = (section.groups ?? []).map((group) => `${group.status}:${group.stepIds.length}`).join('|');
  return `${section.status}||${semanticSignature(section)}||${geometry}||${stepStructure}||${groupStructure}`;
}

export function canonicalSignature(section, context) {
  const candidates = Array.from({ length: QUARTER_TURNS }, (_, rotationQuarterTurns) => ({
    rotationQuarterTurns,
    signature: sectionSignature(section, rotationQuarterTurns, context),
  }));
  candidates.sort((a, b) => a.signature.localeCompare(b.signature) || a.rotationQuarterTurns - b.rotationQuarterTurns);
  return candidates[0];
}

function transformBetween(representative, instance, context) {
  if(!representative.brickIds.length&&!instance.brickIds.length)return {
    rotationQuarterTurns:0,translation:{x:0,y:0,z:0}};
  const targetBricks = instance.brickIds.map((brickId) => context.bricksById.get(brickId));
  const targetOrigin = boundsOrigin(targetBricks);
  const targetSignature = sectionSignature(instance, 0, context);
  const sourceBricks = representative.brickIds.map((brickId) => context.bricksById.get(brickId));
  for (let rotationQuarterTurns = 0; rotationQuarterTurns < QUARTER_TURNS; rotationQuarterTurns += 1) {
    const rotated = sourceBricks.map((brick) => rotatePart(brick, rotationQuarterTurns));
    const sourceOrigin = boundsOrigin(rotated);
    if (sectionSignature(representative, rotationQuarterTurns, context) !== targetSignature) continue;
    return {
      rotationQuarterTurns,
      translation: {
        x: targetOrigin.x - sourceOrigin.x,
        y: targetOrigin.y - sourceOrigin.y,
        z: targetOrigin.z - sourceOrigin.z,
      },
    };
  }
  return null;
}

function continuationContacts(module, brickIds, end, context) {
  const continuation = module.repeatContinuation;
  if (!continuation?.brickIds?.length) return new Set();
  const steps = context.plan.steps;
  const joinIndex = steps.findIndex(s => s.id === continuation.joinSourceStepId
    || s.sourceStepIds?.includes(continuation.joinSourceStepId));
  const join = steps[joinIndex], interfaces = new Set(continuation.brickIds);
  if (joinIndex <= end || join.kind !== 'join' || join.issues?.length
    || join.joinContext?.direction !== 'down' || interfaces.size !== continuation.brickIds.length
    || [...interfaces].some(id => brickIds.has(id))) return new Set();
  const group = join.joinContext.supportGroups.find(g => g.brickIds.length === brickIds.size+interfaces.size
    && g.brickIds.every(id => brickIds.has(id) || interfaces.has(id)));
  if (!group) return new Set();
  const placements = steps.slice(end+1,joinIndex).filter(s => s.newBrickIds.some(id => interfaces.has(id)));
  if (placements.some(s => s.kind !== 'build' || s.issues?.length || s.nestedRecipe
    || (s.insertionDirection ?? 'down') !== 'down'
    || context.modulesById.get(s.moduleId)?.buildContext)
    || [...interfaces].some(id => placements.filter(s => s.newBrickIds.includes(id)).length !== 1)) return new Set();
  const contacts = new Set();
  for (const {a,b} of context.plan.graph?.edges ?? []) {
    const core = brickIds.has(a) ? a : brickIds.has(b) ? b : null;
    const other = core === a ? b : a;
    if (!core || !interfaces.has(other)) continue;
    const lower = context.bricksById.get(core), upper = context.bricksById.get(other);
    const step = placements.find(s => s.newBrickIds.includes(other));
    if (upper.y !== lower.y+1 || !step.visibleBrickIds.includes(core)
      || step.newBrickIds.includes(core)) return new Set();
    contacts.add([a,b].sort().join('|'));
  }
  return contacts;
}

function eligibleHandledRepeat(section,module,context){
  const familyId=module.sharedHandledRecipe?.familyId;
  if(!familyId||module.buildContext||module.kind!=='detail')return false;
  const ids=new Set(module.brickIds),steps=section.stepIds.map(id=>context.stepsById.get(id));
  if(section.brickIds.length!==ids.size||section.brickIds.some(id=>!ids.has(id))
    ||steps.some(s=>s.kind!=='build'||s.moduleId!==module.id||s.nestedRecipe||(s.insertionDirection??'down')!=='down'
      ||s.issues.some(i=>i.code!=='temporary-hold'||i.severity!=='warning')||s.visibleBrickIds.some(id=>!ids.has(id))))return false;
  const family=new Set(context.plan.modules.filter(m=>m.sharedHandledRecipe?.familyId===familyId).map(m=>m.id));
  const joins=context.plan.steps.filter(s=>family.has(s.moduleId)&&s.kind==='join');
  const join=joins.find(s=>s.moduleId===module.id),firstJoin=context.plan.steps.findIndex(s=>s===joins[0]);
  if(family.size<2||joins.length!==family.size||joins.some(s=>s.issues.length)||!join
    ||join.highlightBrickIds.length!==ids.size||join.highlightBrickIds.some(id=>!ids.has(id))
    ||context.plan.steps.some((s,i)=>family.has(s.moduleId)&&s.newBrickIds.length&&i>=firstJoin))return false;
  const edges=context.plan.graph?.edges??[],external=edges.filter(({a,b})=>ids.has(a)!==ids.has(b));
  if(!external.length||external.some(({a,b})=>!join.visibleBrickIds.includes(ids.has(a)?b:a)))return false;
  const reached=new Set([module.brickIds[0]]);
  for(const id of reached)for(const {a,b} of edges){const other=a===id?b:b===id?a:null;if(ids.has(other))reached.add(other);}
  return reached.size===ids.size;
}

export function eligibleNestedRepeat(section, context) {
  const recipe = section.nestedRepeat;
  if (!recipe || section.moduleIds.length !== 1) return false;
  const steps = section.stepIds.map(id => context.stepsById.get(id));
  const join = context.stepsById.get(recipe.attachmentStepId);
  const ids = new Set(section.brickIds);
  if (steps.length < 2 || !join || join.kind !== 'join' || join.issues?.length
    || join.nestedRecipe?.id !== recipe.scopeId || !join.nestedRecipe.separate
    || join.moduleId !== section.moduleIds[0] || join.newBrickIds.length
    || !['up','down'].includes(join.joinContext?.direction)
    || join.highlightBrickIds.length !== ids.size || join.highlightBrickIds.some(id => !ids.has(id))
    || steps.some(s => s.kind !== 'build' || s.nestedRecipe?.id !== recipe.scopeId
      || (s.insertionDirection ?? 'down') !== 'down' || !s.newBrickIds.length
      || s.issues.some(i => i.code !== 'temporary-hold' || i.severity !== 'warning')
      || s.visibleBrickIds.some(id => !ids.has(id)))) return false;
  const start = context.plan.steps.indexOf(steps[0]);
  if (steps.some((s,i) => context.plan.steps[start+i] !== s)
    || context.plan.steps[start+steps.length] !== join) return false;
  const edges = context.plan.graph?.edges ?? [];
  const contacts = new Set(join.joinContext.supportGroups.flatMap(g => g.contacts)
    .map(c => [c.supportBrickId,c.bandBrickId].sort().join('|')));
  const external = edges.filter(({a,b}) => ids.has(a) !== ids.has(b));
  if (!external.length || external.some(({a,b}) => !contacts.has([a,b].sort().join('|'))
    || !join.visibleBrickIds.includes(ids.has(a) ? b : a))) return false;
  const reached = new Set([section.brickIds[0]]);
  for (const id of reached) for (const {a,b} of edges) {
    const other = a === id ? b : b === id ? a : null;
    if (ids.has(other)) reached.add(other);
  }
  return reached.size === ids.size;
}

function eligibleForRepeat(section, context) {
  // An unresolved grounded section may repeat because this projection keeps its
  // warning state. The exact signature also requires the same affected geometry;
  // joins and dependencies remain ineligible so repetition cannot imply success.
  if (section.moduleIds.length !== 1) return false;
  if (section.nestedRepeat) return eligibleNestedRepeat(section, context);
  const module = context.modulesById.get(section.moduleIds[0]);
  if(module.sharedHandledRecipe)return eligibleHandledRepeat(section,module,context);
  if (module.kind !== 'grounded') return false;
  if (module.brickIds.length !== section.brickIds.length
    || module.brickIds.some((brickId) => !section.brickIds.includes(brickId))) return false;
  if (section.stepIds.some((stepId) => {
    const step = context.stepsById.get(stepId);
    return step.moduleId !== module.id || step.kind === 'join' || step.newBrickIds.length === 0;
  })) return false;
  const brickIds = new Set(section.brickIds);
  const externalEdges = (context.plan.graph?.edges ?? []).filter(({a,b})=>brickIds.has(a)!==brickIds.has(b));
  if (!externalEdges.length) return true;
  // A completed component may repeat before a checked join. Every external
  // contact must belong to that join or its explicit supported continuation.
  const end = Math.max(...section.stepIds.map(id=>context.plan.steps.findIndex(s=>s.id===id)));
  const joins = context.plan.steps.slice(end+1).filter(s=>s.kind==='join' && !s.issues?.length
    && s.joinContext?.direction==='down');
  const contacts = new Set(joins.flatMap(s=>s.joinContext.supportGroups.flatMap(group=>
    group.contacts.map(c=>[c.supportBrickId,c.bandBrickId].sort().join('|')))));
  // A repeated grounded core may receive distinct, explicitly built interface
  // pieces before its checked join. The full support group and all intervening
  // placements must still exist; a marker alone cannot waive dependencies.
  for (const contact of continuationContacts(module, brickIds, end, context)) contacts.add(contact);
  if (!externalEdges.every(({a,b})=>contacts.has([a,b].sort().join('|')))) return false;
  const adjacency=new Map([...brickIds].map(id=>[id,[]]));
  for(const {a,b} of context.plan.graph.edges) if(brickIds.has(a)&&brickIds.has(b)) {
    adjacency.get(a).push(b);adjacency.get(b).push(a);
  }
  const reached=new Set([section.brickIds[0]]);
  for(const id of reached) for(const neighbor of adjacency.get(id)) reached.add(neighbor);
  return reached.size===brickIds.size;
}

function genericLabel(section, index, context) {
  if (section.nestedRepeat) return 'Assembly';
  if(section.stepIds.length&&section.stepIds.every(id=>context.stepsById.get(id).kind==='join'))return 'Attach assemblies';
  if (section.stepIds.length && section.stepIds.every(id => context.stepsById.get(id).insertionDirection === 'up')) return 'Underside';
  const modules = section.moduleIds.map((moduleId) => context.modulesById.get(moduleId));
  if(modules.length&&modules.every(module=>module.sharedHandledRecipe||module.localInterfaceRepair))return 'Assembly';
  if (modules.every(module => /^Base assembly \d+$/.test(module.label))) return 'Base assembly';
  if (modules.some(({ buildContext }) => buildContext?.kind === 'work-surface')) return 'Platform';
  const sectionBrickIds = new Set(section.brickIds);
  if (context.plan.steps.some(step => step.kind === 'join'
    && step.joinContext?.supportGroups?.some(group => group.brickIds?.some(id => sectionBrickIds.has(id))))) return 'Supports';
  if (/finishing/i.test(section.label) || modules.every(({ label, kind }) => kind === 'detail' || /^Color detail/.test(label))) {
    return 'Finishing touches';
  }
  if (modules.some(({ label }) => /^Unresolved detached parts/.test(label))) return 'Details';
  if (modules.some(({ kind }) => kind === 'floating')) return 'Upper details';
  if (index === 0) return 'Base';
  if (modules.some(({ label }) => /^Upper section/.test(label))) return 'Upper details';
  return 'Main build';
}

function assignLabels(entries, context) {
  return entries.map((entry, index) => ({
    ...entry,
    label: (entry.semanticConfidence === 'high' || entry.semanticConfidence === 'inferred')
      && typeof entry.semanticLabel === 'string' && entry.semanticLabel.trim()
      ? entry.semanticLabel.trim()
      : genericLabel(entry, index, context),
  }));
}

function readingParts(section, context) {
  const chunks = [];
  let chunk = [];
  let stepCount = 0;
  for (const group of section.groups ?? []) {
    if (!Array.isArray(group.stepIds) || !Array.isArray(group.brickIds)) {
      throw new TypeError(`Guide section ${section.id} groups must contain stepIds and brickIds arrays.`);
    }
    if (group.stepIds.length > MAX_PART_STEPS) {
      throw new RangeError(`Guide group ${group.id} exceeds the ${MAX_PART_STEPS}-step reading-part limit.`);
    }
    if (chunk.length && stepCount + group.stepIds.length > MAX_PART_STEPS) {
      chunks.push(chunk);
      chunk = [];
      stepCount = 0;
    }
    chunk.push(group);
    stepCount += group.stepIds.length;
  }
  if (chunk.length) chunks.push(chunk);
  if (!chunks.length && section.stepIds.length) {
    throw new RangeError(`Guide section ${section.id} has steps that are not assigned to groups.`);
  }

  const representedBrickIds = chunks.flatMap((groups) => groups.flatMap(({ brickIds }) => brickIds));
  if (representedBrickIds.length !== section.brickIds.length
    || new Set(representedBrickIds).size !== section.brickIds.length
    || section.brickIds.some((brickId) => !representedBrickIds.includes(brickId))) {
    throw new RangeError(`Guide section ${section.id} groups must cover every section brick exactly once.`);
  }
  const representedStepIds = chunks.flatMap((groups) => groups.flatMap(({ stepIds }) => stepIds));
  if (representedStepIds.length !== section.stepIds.length
    || representedStepIds.some((stepId, index) => stepId !== section.stepIds[index])) {
    throw new RangeError(`Guide section ${section.id} groups must retain every section step in order.`);
  }

  let stepOffset = 0;
  return chunks.map((groups, partIndex) => {
    const stepIds = groups.flatMap(({ stepIds }) => stepIds);
    const brickIds = groups.flatMap(({ brickIds }) => brickIds);
    const part = {
      id: `${section.id}-part-${partIndex + 1}`,
      partIndex,
      partCount: chunks.length,
      stepRange: { start: stepOffset + 1, end: stepOffset + stepIds.length },
      groupIds: groups.map(({ id }) => id),
      stepIds,
      brickIds,
      brickCount: brickIds.length,
      inventory: inventoryFor(brickIds.map((brickId) => context.bricksById.get(brickId))),
      status: groups.some(({ status }) => status === 'unresolved') ? 'unresolved' : 'ready',
    };
    stepOffset += stepIds.length;
    return part;
  });
}

function presentationEntry(representative, instances, index, context) {
  const { semanticEvidence: _semanticEvidence, ...publicRepresentative } = representative;
  const instanceData = instances.map((section) => ({
    sectionId: section.id,
    brickIds: [...section.brickIds],
    transform: transformBetween(representative, section, context),
    ...(section.nestedRepeat ? {attachmentStepId: section.nestedRepeat.attachmentStepId} : {}),
  }));
  const allBricks = instanceData.flatMap(({ brickIds }) => brickIds.map((brickId) => context.bricksById.get(brickId)));
  return {
    ...publicRepresentative,
    id: `presentation-${index + 1}`,
    label: representative.label,
    repeatCount: instances.length,
    representativeSectionId: representative.id,
    sectionIds: instances.map(({ id }) => id),
    instances: instanceData,
    inventory: inventoryFor(representative.brickIds.map((brickId) => context.bricksById.get(brickId))),
    totalInventory: inventoryFor(allBricks),
    parts: readingParts(representative, context),
  };
}

export function deriveGuidePresentation({ plan, guide, subject = null } = {}) {
  void subject;
  const context = { ...validateInputs(plan, guide), plan };
  const groups = [];
  const groupBySignature = new Map();
  const sectionToGroup = new Map();

  for (const section of guide.sections) {
    const eligible = eligibleForRepeat(section, context);
    const family=section.nestedRepeat?.familyId ?? context.modulesById.get(section.moduleIds[0])?.sharedHandledRecipe?.familyId;
    const signature = eligible ? (family?`${family}||`:'')+canonicalSignature(section, context).signature : null;
    let group = signature ? groupBySignature.get(signature) : null;
    if (!group) {
      group = { representative: section, instances: [] };
      groups.push(group);
      if (signature) groupBySignature.set(signature, group);
    }
    group.instances.push(section);
    sectionToGroup.set(section.id, group);
  }

  let sections = groups.map(({ representative, instances }, index) => presentationEntry(representative, instances, index, context));
  sections = assignLabels(sections, context);
  sections = varyGuideSectionLabels(sections);
  const presentationByGroup = new Map(groups.map((group, index) => [group, sections[index]]));
  const instanceIndexes = new Map(groups.map((group) => [group, 0]));
  const sequence = guide.sections.map((section) => {
    const group = sectionToGroup.get(section.id);
    const instanceIndex = instanceIndexes.get(group);
    instanceIndexes.set(group, instanceIndex + 1);
    return { sectionId: section.id, presentationSectionId: presentationByGroup.get(group).id, instanceIndex };
  });
  const representedIds = sections.flatMap(({ instances }) => instances.flatMap(({ brickIds }) => brickIds));
  const repeatedInstructions = sections.filter(({ repeatCount }) => repeatCount > 1);
  const readingPartCount = sections.reduce((sum, { parts }) => sum + parts.length, 0);
  const maxStepsPerPart = Math.max(0, ...sections.flatMap(({ parts }) => parts.map(({ stepIds }) => stepIds.length)));

  return {
    version: 1,
    sections,
    sequence,
    inventory: plan.inventory,
    stats: {
      sourceSectionCount: guide.sections.length,
      presentationSectionCount: sections.length,
      repeatedInstructionCount: repeatedInstructions.length,
      repeatedInstanceCount: repeatedInstructions.reduce((sum, { repeatCount }) => sum + repeatCount, 0),
      collapsedSectionCount: guide.sections.length - sections.length,
      representedInstanceCount: sequence.length,
      readingPartCount,
      maxStepsPerPart,
      brickCount: representedIds.length,
      coverageComplete: representedIds.length === plan.bricks.length && new Set(representedIds).size === plan.bricks.length,
    },
  };
}
