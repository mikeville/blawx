const cellKey = (x, y, z) => `${x},${y},${z}`;
const brickKey = ({ x, y, z, w, d, color }) => `${x},${y},${z}:${w}x${d}:${color}`;

function cellsOf(brick) {
  const cells = [];
  for (let x = brick.x; x < brick.x + brick.w; x += 1) for (let z = brick.z; z < brick.z + brick.d; z += 1) {
    cells.push(cellKey(x, brick.y, z));
  }
  return cells;
}

function validate(result, name) {
  const plan = result?.assemblyPlan;
  if (!plan || !Array.isArray(plan.bricks) || !Array.isArray(plan.modules)
    || !Array.isArray(plan.steps) || !Array.isArray(plan.graph?.edges)) {
    throw new TypeError(`${name}.assemblyPlan is incomplete.`);
  }
}

function unresolvedCells(plan, byId) {
  const cells = new Set();
  for (const step of plan.steps) {
    if (step.kind !== 'unresolved') continue;
    const ids = step.newBrickIds?.length ? step.newBrickIds : step.highlightBrickIds ?? [];
    for (const id of ids) {
      const brick = byId.get(id);
      if (brick) for (const key of cellsOf(brick)) cells.add(key);
    }
  }
  return cells;
}

function overlapMapper(oldBricks, nextBricks) {
  const oldCellOwners = new Map();
  for (const brick of oldBricks) for (const cell of cellsOf(brick)) oldCellOwners.set(`${cell}:${brick.color}`, brick.id);
  const mapped = new Map();
  for (const brick of nextBricks) {
    const owners = new Set();
    for (const cell of cellsOf(brick)) {
      const owner = oldCellOwners.get(`${cell}:${brick.color}`);
      if (owner) owners.add(owner);
    }
    mapped.set(brick.id, [...owners].sort());
  }
  return mapped;
}

function edgeDetails(plan, byId, mapper = null) {
  return plan.graph.edges.map((edge) => {
    const first = byId.get(edge.a);
    const second = byId.get(edge.b);
    if (!first || !second) return null;
    const lower = first.y < second.y ? first : second;
    const upper = lower === first ? second : first;
    const contacts = [];
    if (upper.y === lower.y + 1) for (let x = Math.max(lower.x, upper.x); x < Math.min(lower.x + lower.w, upper.x + upper.w); x += 1) {
      for (let z = Math.max(lower.z, upper.z); z < Math.min(lower.z + lower.d, upper.z + upper.d); z += 1) {
        contacts.push(cellKey(x, lower.y, z));
      }
    }
    const lowerOwners = mapper ? mapper.get(lower.id) ?? [] : [lower.id];
    const upperOwners = mapper ? mapper.get(upper.id) ?? [] : [upper.id];
    contacts.sort();
    return {
      lowerId: lower.id, upperId: upper.id, lowerOwners, upperOwners, contacts,
      signature: `${lowerOwners.join('+')}>${upperOwners.join('+')}@${contacts.join('+')}`,
    };
  }).filter(Boolean);
}

function ownerMap(plan) {
  const owners = new Map();
  for (const module of plan.modules) for (const id of module.brickIds ?? []) owners.set(id, module.id);
  return owners;
}

function mappedBrickKeys(ids, byId, mapper = null, oldById = null, { sort = true } = {}) {
  const keys = [];
  for (const id of ids ?? []) {
    if (!mapper) {
      const brick = byId.get(id);
      if (brick) keys.push(brickKey(brick));
    } else for (const oldId of mapper.get(id) ?? []) {
      const brick = oldById.get(oldId);
      if (brick) keys.push(brickKey(brick));
    }
  }
  const unique = [...new Set(keys)];
  return sort ? unique.sort() : unique;
}

function operationKeys(plan, module, byId, mapper = null, oldById = null) {
  return plan.steps.filter(({ moduleId }) => moduleId === module.id).map((step) => JSON.stringify({
    kind: step.kind,
    newBrickKeys: mappedBrickKeys(step.newBrickIds, byId, mapper, oldById, { sort: false }),
    highlightBrickKeys: mappedBrickKeys(step.highlightBrickIds, byId, mapper, oldById),
    issues: (step.issues ?? []).map((issue) => ({
      code: issue.code, severity: issue.severity ?? null,
      brickKeys: mappedBrickKeys(issue.brickIds, byId, mapper, oldById),
    })),
    insertionDirection: step.insertionDirection ?? null,
    joinContext: step.joinContext ?? null,
  }));
}

function heldCells(plan, byId) {
  const held = new Set();
  for (const step of plan.steps) for (const issue of step.issues ?? []) if (issue.code === 'temporary-hold') {
    for (const id of issue.brickIds ?? []) {
      const brick = byId.get(id);
      if (brick) for (const key of cellsOf(brick)) held.add(key);
    }
  }
  return held;
}

export function assessAttachmentReplay(beforeResult, candidateResult, proposal) {
  validate(beforeResult, 'beforeResult');
  validate(candidateResult, 'candidateResult');
  if (!proposal || !Array.isArray(proposal.before) || !Array.isArray(proposal.after)
    || !Array.isArray(proposal.targetIds) || !Array.isArray(proposal.anchorIds)) {
    throw new TypeError('proposal is incomplete.');
  }
  const before = beforeResult.assemblyPlan;
  const candidate = candidateResult.assemblyPlan;
  const beforeById = new Map(before.bricks.map((brick) => [brick.id, brick]));
  const candidateById = new Map(candidate.bricks.map((brick) => [brick.id, brick]));
  const mapper = overlapMapper(before.bricks, candidate.bricks);
  const beforeOwners = ownerMap(before);
  const oldOccupied = new Set(before.bricks.flatMap(cellsOf));
  const rejectionReasons = [];

  const beforeEdges = edgeDetails(before, beforeById);
  const candidateEdges = edgeDetails(candidate, candidateById, mapper);
  const beforeContactLocations = new Set(beforeEdges.flatMap(({ contacts }) => contacts));
  const replacementCandidateIds = new Set(candidate.bricks.filter((brick) => proposal.after
    .some((replacement) => brickKey(replacement) === brickKey(brick))).map(({ id }) => id));
  const targetSet = new Set(proposal.targetIds);
  const anchorSet = new Set(proposal.anchorIds);
  const contactEdges = candidateEdges.filter((edge) => {
    if (!replacementCandidateIds.has(edge.lowerId) && !replacementCandidateIds.has(edge.upperId)) return false;
    const owners = new Set([...edge.lowerOwners, ...edge.upperOwners]);
    return [...targetSet].some((id) => owners.has(id)) && [...anchorSet].some((id) => owners.has(id))
      && edge.contacts.some((cell) => !beforeContactLocations.has(cell));
  });
  if (!contactEdges.length) rejectionReasons.push('No fresh proposed target-anchor stud edge');

  const beforeUnresolved = unresolvedCells(before, beforeById);
  const candidateUnresolved = unresolvedCells(candidate, candidateById);
  const resolvedTargetOldCells = [];
  for (const targetId of proposal.targetIds) {
    const brick = beforeById.get(targetId);
    if (brick) for (const key of cellsOf(brick)) {
      if (beforeUnresolved.has(key) && !candidateUnresolved.has(key)) resolvedTargetOldCells.push(key);
    }
  }
  resolvedTargetOldCells.sort();
  if (!resolvedTargetOldCells.length) rejectionReasons.push('No proposed target old cell became resolved');

  const beforeEdgeSignatures = new Set(beforeEdges.map(({ signature }) => signature));
  const candidateEdgeSignatures = new Set(candidateEdges.map(({ signature }) => signature));
  const changedEdges = [
    ...beforeEdges.filter(({ signature }) => !candidateEdgeSignatures.has(signature)),
    ...candidateEdges.filter(({ signature }) => !beforeEdgeSignatures.has(signature)),
  ];
  const affectedModuleIds = new Set();
  for (const replaced of proposal.before) {
    const old = before.bricks.find((brick) => brickKey(brick) === brickKey(replaced));
    const owner = old && beforeOwners.get(old.id);
    if (owner) affectedModuleIds.add(owner);
  }
  for (const edge of changedEdges) for (const id of [...edge.lowerOwners, ...edge.upperOwners]) {
    const owner = beforeOwners.get(id);
    if (owner) affectedModuleIds.add(owner);
  }

  if (candidate.modules.length !== before.modules.length) rejectionReasons.push('Module count changed');
  const modules = [];
  for (let index = 0; index < Math.min(before.modules.length, candidate.modules.length); index += 1) {
    const oldModule = before.modules[index];
    const nextModule = candidate.modules[index];
    const oldMembership = mappedBrickKeys(oldModule.brickIds, beforeById);
    const nextMembership = mappedBrickKeys(nextModule.brickIds, candidateById, mapper, beforeById);
    const mappedOwnerIds = new Set((nextModule.brickIds ?? []).flatMap((id) => mapper.get(id) ?? [])
      .map((id) => beforeOwners.get(id)).filter(Boolean));
    const beforeOperationKeys = operationKeys(before, oldModule, beforeById);
    const afterOperationKeys = operationKeys(candidate, nextModule, candidateById, mapper, beforeById);
    const affected = affectedModuleIds.has(oldModule.id);
    modules.push({
      beforeModuleId: oldModule.id,
      afterModuleId: nextModule.id,
      affected,
      beforeMembership: oldMembership,
      afterMembership: nextMembership,
      beforeOperationKeys,
      afterOperationKeys,
    });
    if (nextModule.id !== oldModule.id || !mappedOwnerIds.has(oldModule.id)) {
      rejectionReasons.push(`Module order changed at: ${oldModule.id}`);
    }
    if (JSON.stringify(oldMembership) !== JSON.stringify(nextMembership)) {
      rejectionReasons.push(`Module membership changed: ${oldModule.id}`);
    }
    if (!affected && JSON.stringify(beforeOperationKeys) !== JSON.stringify(afterOperationKeys)) {
      rejectionReasons.push(`Unrelated module changed: ${oldModule.id}`);
    }
  }

  const beforeHeld = heldCells(before, beforeById);
  const candidateHeld = heldCells(candidate, candidateById);
  const beforeHeldOld = new Set([...beforeHeld].filter((key) => oldOccupied.has(key)));
  const candidateHeldOld = new Set([...candidateHeld].filter((key) => oldOccupied.has(key)));
  const newlyHeldOldCells = [...candidateHeldOld].filter((key) => !beforeHeldOld.has(key)).sort();
  if (newlyHeldOldCells.length) rejectionReasons.push('New old occupied cells require temporary holding');
  if (candidateHeld.size > beforeHeld.size) rejectionReasons.push('Total temporary-held cell count increased');

  return {
    rejectionReasons: [...new Set(rejectionReasons)],
    evidence: {
      contactEdges, resolvedTargetOldCells, affectedModuleIds: [...affectedModuleIds].sort(), modules,
      beforeHeldOldCellCount: beforeHeldOld.size,
      candidateHeldOldCellCount: candidateHeldOld.size,
      beforeHeldCellCount: beforeHeld.size,
      candidateHeldCellCount: candidateHeld.size,
      newlyHeldOldCells,
    },
  };
}
