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
  const label = confidence === 'high' && typeof section.semanticLabel === 'string'
    ? section.semanticLabel.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
  return `${confidence}:${label}`;
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

function canonicalSignature(section, context) {
  const candidates = Array.from({ length: QUARTER_TURNS }, (_, rotationQuarterTurns) => ({
    rotationQuarterTurns,
    signature: sectionSignature(section, rotationQuarterTurns, context),
  }));
  candidates.sort((a, b) => a.signature.localeCompare(b.signature) || a.rotationQuarterTurns - b.rotationQuarterTurns);
  return candidates[0];
}

function transformBetween(representative, instance, context) {
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

function eligibleForRepeat(section, context) {
  // An unresolved grounded section may repeat because this projection keeps its
  // warning state. The exact signature also requires the same affected geometry;
  // joins and dependencies remain ineligible so repetition cannot imply success.
  if (section.moduleIds.length !== 1) return false;
  const module = context.modulesById.get(section.moduleIds[0]);
  if (module.kind !== 'grounded') return false;
  if (module.brickIds.length !== section.brickIds.length
    || module.brickIds.some((brickId) => !section.brickIds.includes(brickId))) return false;
  if (section.stepIds.some((stepId) => {
    const step = context.stepsById.get(stepId);
    return step.moduleId !== module.id || step.kind === 'join' || step.newBrickIds.length === 0;
  })) return false;
  const brickIds = new Set(section.brickIds);
  return !(context.plan.graph?.edges ?? []).some(({ a, b }) => brickIds.has(a) !== brickIds.has(b));
}

function genericLabel(section, index, context) {
  const modules = section.moduleIds.map((moduleId) => context.modulesById.get(moduleId));
  if (modules.some(({ buildContext }) => buildContext?.kind === 'work-surface')) return 'Main assembly';
  if (/finishing/i.test(section.label) || modules.every(({ label, kind }) => kind === 'detail' || /^Color detail/.test(label))) {
    return 'Finishing touches';
  }
  if (modules.some(({ label }) => /^Unresolved detached parts/.test(label))) return 'Details';
  if (modules.some(({ kind }) => kind === 'floating')) return 'Upper details';
  if (index === 0) return 'Base';
  if (modules.some(({ label }) => /^Upper section/.test(label))) return 'Upper details';
  return 'Main shape';
}

function assignLabels(entries, context) {
  return entries.map((entry, index) => ({
    ...entry,
    label: entry.semanticConfidence === 'high' && typeof entry.semanticLabel === 'string' && entry.semanticLabel.trim()
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
    const signature = eligible ? canonicalSignature(section, context).signature : null;
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
