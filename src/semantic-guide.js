import { createGuideSections, createGuideSectionsFromRanges } from './guide-sections.js';
import { deriveGuidePresentation } from './guide-presentation.js';

const MAX_BRICKS = 5_000;
const MAX_STEPS = 2_000;
const MAX_SECTIONS = 64;
const MAX_MODULES = 5_000;
const MAX_SUBJECT_LENGTH = 500;
const MAX_ID_LENGTH = 160;
const MAX_KIND_LENGTH = 64;
const MAX_LABEL_LENGTH = 64;
const MAX_EVIDENCE_LENGTH = 240;
const MAX_COLOR_LENGTH = 64;
const MAX_GRAPH_EDGES = 50_000;
const MAX_SOURCE_OPERATIONS = 10_000;
const MAX_REFERENCES = 250_000;
const COORDINATE_LIMIT = 10_000;
const INPUT_KEYS = ['version', 'fingerprint', 'subject', 'bricks', 'steps', 'modules', 'graph', 'protectedRanges'];
const STEP_KEYS = [
  'id', 'moduleId', 'kind', 'newBrickIds', 'sourceStepIds', 'insertionDirection', 'issueCodes',
  'dependencies', 'joinTargetModuleIds', 'orderedOperations', 'issues',
];
const OPERATION_KEYS = ['id', 'kind', 'newBrickIds', 'highlightBrickIds', 'insertionDirection', 'issues'];
const ISSUE_KEYS = ['code', 'severity', 'brickIds'];

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}

function exactKeys(value, keys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} contains missing or unknown fields.`);
  }
}

function boundedString(value, name, maximum, { empty = false, controls = false } = {}) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
  const normalized = value.normalize('NFC').trim();
  if (!empty && normalized.length === 0) throw new RangeError(`${name} must not be empty.`);
  if ([...normalized].length > maximum) throw new RangeError(`${name} exceeds ${maximum} characters.`);
  if (!controls && /[\u0000-\u001f\u007f]/u.test(normalized)) throw new RangeError(`${name} must be plain text.`);
  return normalized;
}

function id(value, name) {
  return boundedString(value, name, MAX_ID_LENGTH);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueStrings(values, name, known = null) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
  const result = values.map((value, index) => id(value, `${name}[${index}]`));
  if (new Set(result).size !== result.length) throw new RangeError(`${name} must not contain duplicates.`);
  if (known) for (const value of result) if (!known.has(value)) throw new RangeError(`${name} references unknown ID ${value}.`);
  return result;
}

function integer(value, name, { minimum = -COORDINATE_LIMIT, maximum = COORDINATE_LIMIT } = {}) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer.`);
  if (value < minimum || value > maximum) throw new RangeError(`${name} is outside the supported range.`);
  return value;
}

function uniqueMap(items, name) {
  const result = new Map();
  for (const item of items) {
    const itemId = id(item?.id, `${name} ID`);
    if (result.has(itemId)) throw new RangeError(`${name} IDs must be unique.`);
    result.set(itemId, item);
  }
  return result;
}

function canonicalIssue(value, name, brickIds) {
  object(value, name);
  exactKeys(value, ISSUE_KEYS, name);
  return {
    code: boundedString(value.code, `${name}.code`, MAX_KIND_LENGTH),
    severity: boundedString(value.severity, `${name}.severity`, MAX_KIND_LENGTH),
    brickIds: uniqueStrings(value.brickIds, `${name}.brickIds`, brickIds).sort(),
  };
}

function compareIssues(a, b) {
  return compareText(a.code, b.code) || compareText(a.severity, b.severity)
    || compareText(a.brickIds.join('\u0000'), b.brickIds.join('\u0000'));
}

function sourceIssues(issues, brickIds, name) {
  if (!Array.isArray(issues)) throw new TypeError(`${name} must be an array.`);
  return issues.map((issue, index) => {
    object(issue, `${name}[${index}]`);
    return canonicalIssue({
      code: issue.code,
      severity: issue.severity ?? '',
      brickIds: issue.brickIds ?? [],
    }, `${name}[${index}]`, brickIds);
  }).sort(compareIssues);
}

function canonicalOperation(value, name, brickIds) {
  object(value, name);
  exactKeys(value, OPERATION_KEYS, name);
  return {
    id: id(value.id, `${name}.id`),
    kind: boundedString(value.kind, `${name}.kind`, MAX_KIND_LENGTH),
    newBrickIds: uniqueStrings(value.newBrickIds, `${name}.newBrickIds`, brickIds),
    highlightBrickIds: uniqueStrings(value.highlightBrickIds, `${name}.highlightBrickIds`, brickIds),
    insertionDirection: boundedString(value.insertionDirection, `${name}.insertionDirection`, MAX_KIND_LENGTH),
    issues: value.issues.map((issue, index) => canonicalIssue(issue, `${name}.issues[${index}]`, brickIds)).sort(compareIssues),
  };
}

function sourceOperation(step, brickIds, name) {
  return {
    id: id(step.id, `${name}.id`),
    kind: boundedString(step.kind, `${name}.kind`, MAX_KIND_LENGTH),
    newBrickIds: uniqueStrings(step.newBrickIds, `${name}.newBrickIds`, brickIds),
    highlightBrickIds: uniqueStrings(step.highlightBrickIds ?? step.newBrickIds, `${name}.highlightBrickIds`, brickIds),
    insertionDirection: boundedString(step.insertionDirection ?? 'down', `${name}.insertionDirection`, MAX_KIND_LENGTH),
    issues: sourceIssues(step.issues ?? [], brickIds, `${name}.issues`),
  };
}

function fingerprintPayload(input) {
  const { fingerprint: _fingerprint, ...payload } = input;
  return JSON.stringify(payload);
}

// Eight separately seeded 32-bit lanes provide a compact, synchronous cache identity.
// This is deterministic in browsers and Node; it is not a security or authenticity claim.
function hashPayload(value) {
  const lanes = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
    0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ];
  for (let offset = 0; offset < value.length; offset += 1) {
    const code = value.charCodeAt(offset);
    for (let lane = 0; lane < lanes.length; lane += 1) {
      lanes[lane] ^= code + lane * 131;
      lanes[lane] = Math.imul(lanes[lane], 0x01000193 + lane * 2);
      lanes[lane] ^= lanes[lane] >>> 13;
    }
  }
  return lanes.map((lane, index) => {
    let hash = lane ^ Math.imul(value.length + index, 0x9e3779b1);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}

function canonicalGraph(graph, brickIds) {
  const sourceEdges = graph?.edges ?? [];
  if (!Array.isArray(sourceEdges)) throw new TypeError('plan.graph.edges must be an array.');
  if (sourceEdges.length > MAX_GRAPH_EDGES) throw new RangeError(`Semantic input is limited to ${MAX_GRAPH_EDGES} graph edges.`);
  const edges = sourceEdges.map((edge, index) => {
    object(edge, `Graph edge ${index + 1}`);
    const a = id(edge.a, `Graph edge ${index + 1}.a`);
    const b = id(edge.b, `Graph edge ${index + 1}.b`);
    if (!brickIds.has(a) || !brickIds.has(b) || a === b) throw new RangeError(`Graph edge ${index + 1} has invalid brick IDs.`);
    return { a, b, studs: integer(edge.studs, `Graph edge ${index + 1}.studs`, { minimum: 1, maximum: 1_000 }) };
  }).sort((a, b) => compareText(a.a, b.a) || compareText(a.b, b.b) || a.studs - b.studs);
  const signatures = edges.map(({ a, b }) => `${a}\u0000${b}`);
  if (new Set(signatures).size !== signatures.length) throw new RangeError('Graph edges must not be duplicated.');
  return { edges };
}

function dependencyEvidence(plan, steps, graph, modulesById) {
  const stepIndexByBrickId = new Map();
  steps.forEach((step, stepIndex) => step.newBrickIds.forEach((brickId) => stepIndexByBrickId.set(brickId, stepIndex)));
  const moduleIdByBrickId = new Map();
  for (const module of plan.modules) for (const brickId of module.brickIds ?? []) {
    if (moduleIdByBrickId.has(brickId)) throw new RangeError(`Brick ${brickId} belongs to multiple plan modules.`);
    moduleIdByBrickId.set(brickId, module.id);
  }
  const neighbors = new Map(plan.bricks.map(({ id: brickId }) => [brickId, []]));
  for (const edge of graph.edges) {
    neighbors.get(edge.a).push(edge.b);
    neighbors.get(edge.b).push(edge.a);
  }
  return steps.map((step, stepIndex) => {
    const sourceStep = plan.steps[stepIndex];
    const focusIds = step.newBrickIds.length
      ? step.newBrickIds
      : uniqueStrings(sourceStep.highlightBrickIds ?? [], `Plan step ${step.id}.highlightBrickIds`, new Set(neighbors.keys()));
    const dependencyIndexes = new Set();
    const targetModules = new Set();
    for (const brickId of focusIds) for (const neighborId of neighbors.get(brickId) ?? []) {
      const dependencyIndex = stepIndexByBrickId.get(neighborId);
      if (dependencyIndex !== undefined && dependencyIndex < stepIndex) dependencyIndexes.add(dependencyIndex);
      const targetModuleId = moduleIdByBrickId.get(neighborId);
      if (!step.newBrickIds.length && targetModuleId && targetModuleId !== step.moduleId) targetModules.add(targetModuleId);
    }
    for (const issue of step.issues) for (const brickId of issue.brickIds) {
      const dependencyIndex = stepIndexByBrickId.get(brickId);
      if (dependencyIndex !== undefined && dependencyIndex < stepIndex) dependencyIndexes.add(dependencyIndex);
    }
    const explicitDependencies = uniqueStrings(sourceStep.dependencies ?? [], `Plan step ${step.id}.dependencies`, new Set(steps.map(({ id: stepId }) => stepId)));
    for (const dependencyId of explicitDependencies) {
      const dependencyIndex = steps.findIndex(({ id: stepId }) => stepId === dependencyId);
      if (dependencyIndex >= stepIndex) throw new RangeError(`Plan step ${step.id} dependencies must reference earlier steps.`);
      dependencyIndexes.add(dependencyIndex);
    }
    const explicitTargets = uniqueStrings(sourceStep.joinTargetModuleIds ?? [], `Plan step ${step.id}.joinTargetModuleIds`, new Set(modulesById.keys()));
    for (const moduleId of explicitTargets) targetModules.add(moduleId);
    return {
      dependencies: [...dependencyIndexes].sort((a, b) => a - b).map((index) => steps[index].id),
      joinTargetModuleIds: [...targetModules].sort(),
    };
  });
}

function protectedRepeatRanges(plan, guide) {
  const presentation = deriveGuidePresentation({ plan, guide });
  const sectionsById = new Map(guide.sections.map((section) => [section.id, section]));
  const stepIndexById = new Map(plan.steps.map((step, index) => [step.id, index]));
  return presentation.sections
    .filter(({ repeatCount }) => repeatCount > 1)
    .flatMap((entry) => entry.sectionIds.map((sectionId) => {
      const section = sectionsById.get(sectionId);
      if (!section?.stepIds?.length) throw new RangeError(`Repeated guide section ${sectionId} has no steps.`);
      return {
        startStepId: section.stepIds[0],
        endStepId: section.stepIds.at(-1),
        repeatGroupId: entry.id,
      };
    }))
    .sort((a, b) => stepIndexById.get(a.startStepId) - stepIndexById.get(b.startStepId));
}

function canonicalInputWithoutFingerprint({ subject, bricks, steps, modules, graph, protectedRanges }) {
  return { version: 1, subject, bricks, steps, modules, graph, protectedRanges };
}

function validateProtectedRangeFeasibility(protectedRanges, steps, stepIndexById) {
  let cursor = 0;
  let minimumSectionCount = protectedRanges.length;
  const requireBrickInSpan = (start, end, name) => {
    if (!steps.slice(start, end).some((step) => step.newBrickIds.length > 0)) {
      throw new RangeError(`${name} contains only join operations and cannot form a valid annotation section.`);
    }
  };

  for (let index = 0; index < protectedRanges.length; index += 1) {
    const range = protectedRanges[index];
    const start = stepIndexById.get(range.startStepId);
    const end = stepIndexById.get(range.endStepId) + 1;
    if (start < cursor) throw new RangeError('protectedRanges must not overlap.');
    if (start > cursor) {
      requireBrickInSpan(cursor, start, `Gap before protectedRanges[${index}]`);
      minimumSectionCount += 1;
    }
    requireBrickInSpan(start, end, `protectedRanges[${index}]`);
    cursor = end;
  }
  if (cursor < steps.length) {
    requireBrickInSpan(cursor, steps.length, 'Gap after protectedRanges');
    minimumSectionCount += 1;
  }
  if (minimumSectionCount > MAX_SECTIONS) {
    throw new RangeError(`Protected ranges require at least ${minimumSectionCount} annotation sections; maximum is ${MAX_SECTIONS}.`);
  }
}

export function createSemanticGuideInput({ plan, guide = createGuideSections(plan), subject = '' } = {}) {
  object(plan, 'plan');
  object(guide, 'guide');
  if (!Array.isArray(plan.bricks) || plan.bricks.length === 0 || plan.bricks.length > MAX_BRICKS) {
    throw new RangeError(`Semantic input requires 1-${MAX_BRICKS} plan bricks.`);
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > MAX_STEPS) {
    throw new RangeError(`Semantic input requires 1-${MAX_STEPS} plan steps.`);
  }
  if (!Array.isArray(plan.modules) || plan.modules.length === 0 || plan.modules.length > MAX_MODULES) {
    throw new RangeError(`Semantic input requires 1-${MAX_MODULES} plan modules.`);
  }
  const planBricksById = uniqueMap(plan.bricks, 'Plan brick');
  const planModulesById = uniqueMap(plan.modules, 'Plan module');
  const planStepsById = uniqueMap(plan.steps, 'Plan step');
  const brickIds = new Set(planBricksById.keys());
  const modules = plan.modules.map((module, index) => ({
    id: id(module.id, `Plan module ${index + 1}.id`),
    kind: boundedString(module.kind, `Plan module ${index + 1}.kind`, MAX_KIND_LENGTH),
  }));
  const bricks = plan.bricks.map((brick, index) => [
    id(brick.id, `Plan brick ${index + 1}.id`),
    integer(brick.x, `Plan brick ${index + 1}.x`),
    integer(brick.y, `Plan brick ${index + 1}.y`, { minimum: 0 }),
    integer(brick.z, `Plan brick ${index + 1}.z`),
    integer(brick.w, `Plan brick ${index + 1}.w`, { minimum: 1, maximum: 64 }),
    integer(brick.d, `Plan brick ${index + 1}.d`, { minimum: 1, maximum: 64 }),
    boundedString(brick.color, `Plan brick ${index + 1}.color`, MAX_COLOR_LENGTH),
  ]);
  const graph = canonicalGraph(plan.graph, brickIds);
  let operationCount = 0;
  let referenceCount = 0;
  const sourceStepIds = new Set();
  const preliminarySteps = plan.steps.map((step, index) => {
    object(step, `Plan step ${index + 1}`);
    const stepId = id(step.id, `Plan step ${index + 1}.id`);
    const moduleId = id(step.moduleId, `Plan step ${index + 1}.moduleId`);
    if (!planModulesById.has(moduleId)) throw new RangeError(`Plan step ${stepId} references an unknown module.`);
    const newBrickIds = uniqueStrings(step.newBrickIds, `Plan step ${stepId}.newBrickIds`, brickIds);
    const issues = sourceIssues(step.issues ?? [], brickIds, `Plan step ${stepId}.issues`);
    const sources = uniqueStrings(step.sourceStepIds ?? [stepId], `Plan step ${stepId}.sourceStepIds`);
    for (const sourceStepId of sources) {
      if (sourceStepIds.has(sourceStepId)) throw new RangeError(`Source step ${sourceStepId} is represented more than once.`);
      sourceStepIds.add(sourceStepId);
    }
    const operations = (step.orderedOperations ?? [step]).map((operation, operationIndex) => sourceOperation(
      operation,
      brickIds,
      `Plan step ${stepId}.orderedOperations[${operationIndex}]`,
    ));
    if (operations.map(({ id: operationId }) => operationId).join('\u0000') !== sources.join('\u0000')) {
      throw new RangeError(`Plan step ${stepId} sourceStepIds and orderedOperations must match in order.`);
    }
    if (operations.flatMap(({ newBrickIds: operationBrickIds }) => operationBrickIds).join('\u0000') !== newBrickIds.join('\u0000')) {
      throw new RangeError(`Plan step ${stepId} orderedOperations must preserve newBrickIds in order.`);
    }
    operationCount += operations.length;
    referenceCount += newBrickIds.length + sources.length + operations.reduce((sum, operation) => sum
      + operation.newBrickIds.length + operation.highlightBrickIds.length
      + operation.issues.reduce((issueSum, issue) => issueSum + issue.brickIds.length, 0), 0)
      + issues.reduce((sum, issue) => sum + issue.brickIds.length, 0);
    return {
      id: stepId,
      moduleId,
      kind: boundedString(step.kind, `Plan step ${stepId}.kind`, MAX_KIND_LENGTH),
      newBrickIds,
      sourceStepIds: sources,
      insertionDirection: boundedString(step.insertionDirection ?? 'down', `Plan step ${stepId}.insertionDirection`, MAX_KIND_LENGTH),
      issueCodes: [...new Set(issues.map(({ code }) => code))].sort(),
      orderedOperations: operations,
      issues,
    };
  });
  if (operationCount > MAX_SOURCE_OPERATIONS) throw new RangeError(`Semantic input is limited to ${MAX_SOURCE_OPERATIONS} source operations.`);
  if (referenceCount > MAX_REFERENCES) throw new RangeError(`Semantic input is limited to ${MAX_REFERENCES} ID references.`);
  const introduced = preliminarySteps.flatMap(({ newBrickIds }) => newBrickIds);
  if (introduced.length !== brickIds.size || new Set(introduced).size !== brickIds.size) {
    throw new RangeError('Semantic input requires every plan brick to be introduced exactly once.');
  }
  const dependencies = dependencyEvidence(plan, preliminarySteps, graph, planModulesById);
  const steps = preliminarySteps.map((step, index) => ({
    id: step.id,
    moduleId: step.moduleId,
    kind: step.kind,
    newBrickIds: step.newBrickIds,
    sourceStepIds: step.sourceStepIds,
    insertionDirection: step.insertionDirection,
    issueCodes: step.issueCodes,
    dependencies: dependencies[index].dependencies,
    joinTargetModuleIds: dependencies[index].joinTargetModuleIds,
    orderedOperations: step.orderedOperations,
    issues: step.issues,
  }));
  const normalizedSubject = boundedString(subject, 'subject', MAX_SUBJECT_LENGTH, { empty: true, controls: true }).replace(/\s+/gu, ' ');
  const protectedRanges = protectedRepeatRanges(plan, guide);
  const payload = canonicalInputWithoutFingerprint({
    subject: normalizedSubject, bricks, steps, modules, graph, protectedRanges,
  });
  const input = { version: 1, fingerprint: '', ...payload };
  input.fingerprint = hashPayload(fingerprintPayload(input));
  return validateSemanticGuideInput(input);
}

export function validateSemanticGuideInput(input) {
  object(input, 'Semantic guide input');
  exactKeys(input, INPUT_KEYS, 'Semantic guide input');
  if (input.version !== 1) throw new TypeError('Semantic guide input must use version 1.');
  const fingerprint = boundedString(input.fingerprint, 'fingerprint', 64);
  if (!/^[0-9a-f]{64}$/u.test(fingerprint)) throw new RangeError('fingerprint must be 64 lowercase hexadecimal characters.');
  const subject = boundedString(input.subject, 'subject', MAX_SUBJECT_LENGTH, { empty: true, controls: true }).replace(/\s+/gu, ' ');
  if (!Array.isArray(input.bricks) || input.bricks.length === 0 || input.bricks.length > MAX_BRICKS) {
    throw new RangeError(`Semantic input requires 1-${MAX_BRICKS} bricks.`);
  }
  const bricks = input.bricks.map((brick, index) => {
    if (!Array.isArray(brick) || brick.length !== 7) throw new TypeError(`bricks[${index}] must contain seven fields.`);
    return [
      id(brick[0], `bricks[${index}][0]`),
      integer(brick[1], `bricks[${index}][1]`),
      integer(brick[2], `bricks[${index}][2]`, { minimum: 0 }),
      integer(brick[3], `bricks[${index}][3]`),
      integer(brick[4], `bricks[${index}][4]`, { minimum: 1, maximum: 64 }),
      integer(brick[5], `bricks[${index}][5]`, { minimum: 1, maximum: 64 }),
      boundedString(brick[6], `bricks[${index}][6]`, MAX_COLOR_LENGTH),
    ];
  });
  const brickIds = new Set(bricks.map(([brickId]) => brickId));
  if (brickIds.size !== bricks.length) throw new RangeError('Brick IDs must be unique.');
  if (!Array.isArray(input.modules) || input.modules.length === 0 || input.modules.length > MAX_MODULES) {
    throw new RangeError(`Semantic input requires 1-${MAX_MODULES} modules.`);
  }
  const modules = input.modules.map((module, index) => {
    object(module, `modules[${index}]`);
    exactKeys(module, ['id', 'kind'], `modules[${index}]`);
    return {
      id: id(module.id, `modules[${index}].id`),
      kind: boundedString(module.kind, `modules[${index}].kind`, MAX_KIND_LENGTH),
    };
  });
  const moduleIds = new Set(modules.map(({ id: moduleId }) => moduleId));
  if (moduleIds.size !== modules.length) throw new RangeError('Module IDs must be unique.');
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > MAX_STEPS) {
    throw new RangeError(`Semantic input requires 1-${MAX_STEPS} steps.`);
  }
  const stepIds = new Set(input.steps.map((step, index) => id(step?.id, `steps[${index}].id`)));
  if (stepIds.size !== input.steps.length) throw new RangeError('Step IDs must be unique.');
  let operationCount = 0;
  let referenceCount = 0;
  const representedSourceSteps = new Set();
  const steps = input.steps.map((step, index) => {
    object(step, `steps[${index}]`);
    exactKeys(step, STEP_KEYS, `steps[${index}]`);
    const stepId = id(step.id, `steps[${index}].id`);
    const moduleId = id(step.moduleId, `steps[${index}].moduleId`);
    if (!moduleIds.has(moduleId)) throw new RangeError(`Step ${stepId} references an unknown module.`);
    const newBrickIds = uniqueStrings(step.newBrickIds, `Step ${stepId}.newBrickIds`, brickIds);
    const sourceIds = uniqueStrings(step.sourceStepIds, `Step ${stepId}.sourceStepIds`);
    for (const sourceId of sourceIds) {
      if (representedSourceSteps.has(sourceId)) throw new RangeError(`Source step ${sourceId} is represented more than once.`);
      representedSourceSteps.add(sourceId);
    }
    const issues = step.issues.map((issue, issueIndex) => canonicalIssue(issue, `Step ${stepId}.issues[${issueIndex}]`, brickIds)).sort(compareIssues);
    const issueCodes = uniqueStrings(step.issueCodes, `Step ${stepId}.issueCodes`).sort();
    if (issueCodes.join('\u0000') !== [...new Set(issues.map(({ code }) => code))].sort().join('\u0000')) {
      throw new RangeError(`Step ${stepId} issueCodes do not match issues.`);
    }
    const operations = step.orderedOperations.map((operation, operationIndex) => canonicalOperation(
      operation, `Step ${stepId}.orderedOperations[${operationIndex}]`, brickIds,
    ));
    if (operations.map(({ id: operationId }) => operationId).join('\u0000') !== sourceIds.join('\u0000')) {
      throw new RangeError(`Step ${stepId} sourceStepIds and orderedOperations must match in order.`);
    }
    if (operations.flatMap(({ newBrickIds: operationBrickIds }) => operationBrickIds).join('\u0000') !== newBrickIds.join('\u0000')) {
      throw new RangeError(`Step ${stepId} orderedOperations must preserve newBrickIds in order.`);
    }
    const dependencies = uniqueStrings(step.dependencies, `Step ${stepId}.dependencies`, stepIds);
    const priorIds = new Set(input.steps.slice(0, index).map(({ id: priorId }) => priorId));
    if (dependencies.some((dependencyId) => !priorIds.has(dependencyId))) {
      throw new RangeError(`Step ${stepId} dependencies must reference earlier steps.`);
    }
    const joinTargetModuleIds = uniqueStrings(step.joinTargetModuleIds, `Step ${stepId}.joinTargetModuleIds`, moduleIds).sort();
    operationCount += operations.length;
    referenceCount += newBrickIds.length + sourceIds.length + dependencies.length + joinTargetModuleIds.length
      + operations.reduce((sum, operation) => sum + operation.newBrickIds.length + operation.highlightBrickIds.length
        + operation.issues.reduce((issueSum, issue) => issueSum + issue.brickIds.length, 0), 0)
      + issues.reduce((sum, issue) => sum + issue.brickIds.length, 0);
    return {
      id: stepId,
      moduleId,
      kind: boundedString(step.kind, `Step ${stepId}.kind`, MAX_KIND_LENGTH),
      newBrickIds,
      sourceStepIds: sourceIds,
      insertionDirection: boundedString(step.insertionDirection, `Step ${stepId}.insertionDirection`, MAX_KIND_LENGTH),
      issueCodes,
      dependencies,
      joinTargetModuleIds,
      orderedOperations: operations,
      issues,
    };
  });
  if (operationCount > MAX_SOURCE_OPERATIONS) throw new RangeError(`Semantic input is limited to ${MAX_SOURCE_OPERATIONS} source operations.`);
  if (referenceCount > MAX_REFERENCES) throw new RangeError(`Semantic input is limited to ${MAX_REFERENCES} ID references.`);
  const introduced = steps.flatMap(({ newBrickIds }) => newBrickIds);
  if (introduced.length !== bricks.length || new Set(introduced).size !== bricks.length) {
    throw new RangeError('Every input brick must be introduced exactly once.');
  }
  object(input.graph, 'graph');
  exactKeys(input.graph, ['edges'], 'graph');
  const graph = canonicalGraph(input.graph, brickIds);
  if (!Array.isArray(input.protectedRanges)) throw new TypeError('protectedRanges must be an array.');
  const stepIndexById = new Map(steps.map((step, index) => [step.id, index]));
  const protectedRanges = input.protectedRanges.map((range, index) => {
    object(range, `protectedRanges[${index}]`);
    exactKeys(range, ['startStepId', 'endStepId', 'repeatGroupId'], `protectedRanges[${index}]`);
    const startStepId = id(range.startStepId, `protectedRanges[${index}].startStepId`);
    const endStepId = id(range.endStepId, `protectedRanges[${index}].endStepId`);
    if (!stepIndexById.has(startStepId) || !stepIndexById.has(endStepId)
      || stepIndexById.get(startStepId) > stepIndexById.get(endStepId)) {
      throw new RangeError(`protectedRanges[${index}] has an invalid range.`);
    }
    return {
      startStepId,
      endStepId,
      repeatGroupId: id(range.repeatGroupId, `protectedRanges[${index}].repeatGroupId`),
    };
  });
  const protectedSignatures = protectedRanges.map(({ startStepId, endStepId }) => `${startStepId}\u0000${endStepId}`);
  if (new Set(protectedSignatures).size !== protectedSignatures.length) throw new RangeError('protectedRanges must be unique.');
  for (let index = 1; index < protectedRanges.length; index += 1) {
    if (stepIndexById.get(protectedRanges[index - 1].startStepId) >= stepIndexById.get(protectedRanges[index].startStepId)) {
      throw new RangeError('protectedRanges must follow plan step order.');
    }
  }
  validateProtectedRangeFeasibility(protectedRanges, steps, stepIndexById);
  const payload = canonicalInputWithoutFingerprint({ subject, bricks, steps, modules, graph, protectedRanges });
  const canonical = { version: 1, fingerprint, ...payload };
  if (hashPayload(fingerprintPayload(canonical)) !== fingerprint) throw new RangeError('Semantic guide input fingerprint is stale.');
  return canonical;
}

export function validateSemanticGuideAnnotation(input, annotation) {
  const canonicalInput = validateSemanticGuideInput(input);
  object(annotation, 'Semantic guide annotation');
  exactKeys(annotation, ['version', 'fingerprint', 'sections'], 'Semantic guide annotation');
  if (annotation.version !== 1) throw new TypeError('Semantic guide annotation must use version 1.');
  if (annotation.fingerprint !== canonicalInput.fingerprint) throw new RangeError('Semantic guide annotation fingerprint is stale.');
  if (!Array.isArray(annotation.sections) || annotation.sections.length === 0 || annotation.sections.length > MAX_SECTIONS) {
    throw new RangeError(`Semantic guide annotation requires 1-${MAX_SECTIONS} sections.`);
  }
  const stepIndexById = new Map(canonicalInput.steps.map((step, index) => [step.id, index]));
  let expectedStart = 0;
  const sections = annotation.sections.map((section, index) => {
    object(section, `Annotation section ${index + 1}`);
    exactKeys(section, ['startStepId', 'endStepId', 'label', 'confidence', 'evidence'], `Annotation section ${index + 1}`);
    const startStepId = id(section.startStepId, `Annotation section ${index + 1}.startStepId`);
    const endStepId = id(section.endStepId, `Annotation section ${index + 1}.endStepId`);
    const start = stepIndexById.get(startStepId);
    const end = stepIndexById.get(endStepId);
    if (start === undefined || end === undefined) throw new RangeError(`Annotation section ${index + 1} references an unknown step.`);
    if (start !== expectedStart || end < start) {
      throw new RangeError('Annotation sections must cover every step exactly once in order.');
    }
    const confidence = section.confidence;
    if (confidence !== 'high' && confidence !== 'uncertain') {
      throw new RangeError(`Annotation section ${index + 1} has invalid confidence.`);
    }
    let label = null;
    if (section.label !== null) label = boundedString(section.label, `Annotation section ${index + 1}.label`, MAX_LABEL_LENGTH);
    if (confidence === 'high' && label === null) throw new RangeError('High-confidence annotation sections require a label.');
    const evidence = boundedString(section.evidence, `Annotation section ${index + 1}.evidence`, MAX_EVIDENCE_LENGTH);
    const hasBrick = canonicalInput.steps.slice(start, end + 1).some((step) => step.newBrickIds.length > 0);
    if (!hasBrick) throw new RangeError(`Annotation section ${index + 1} must introduce at least one brick.`);
    expectedStart = end + 1;
    return { startStepId, endStepId, label, confidence, evidence };
  });
  if (expectedStart !== canonicalInput.steps.length) throw new RangeError('Annotation sections must cover every input step.');
  const sectionRanges = new Set(sections.map(({ startStepId, endStepId }) => `${startStepId}\u0000${endStepId}`));
  for (const range of canonicalInput.protectedRanges) {
    if (!sectionRanges.has(`${range.startStepId}\u0000${range.endStepId}`)) {
      throw new RangeError(`Protected repeated range ${range.startStepId}-${range.endStepId} must remain an exact section.`);
    }
  }
  return { version: 1, fingerprint: canonicalInput.fingerprint, sections };
}

export function applySemanticGuide({ plan, guide = createGuideSections(plan), subject = '', annotation } = {}) {
  const input = createSemanticGuideInput({ plan, guide, subject });
  const normalized = validateSemanticGuideAnnotation(input, annotation);
  const result = createGuideSectionsFromRanges(plan, normalized.sections);
  return {
    ...result,
    semantics: {
      version: 1,
      source: 'semantic-annotation',
      fingerprint: normalized.fingerprint,
      subject: input.subject,
      sections: structuredClone(normalized.sections),
    },
  };
}
