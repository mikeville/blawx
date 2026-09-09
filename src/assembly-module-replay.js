const brickKey = ({ x, y, z, w, d, color }) => `${x},${y},${z}:${w}x${d}:${color}`;
const cellKey = (x, y, z) => `${x},${y},${z}`;

function compareBricks(a, b) {
  return a.y - b.y || a.z - b.z || a.x - b.x || a.w - b.w || a.d - b.d
    || a.color.localeCompare(b.color) || a.inputIndex - b.inputIndex;
}

function cellsOf(brick) {
  const cells = [];
  for (let z = brick.z; z < brick.z + brick.d; z += 1) {
    for (let x = brick.x; x < brick.x + brick.w; x += 1) cells.push(cellKey(x, brick.y, z));
  }
  return cells;
}

function identified(bricks) {
  const sorted = bricks.map((brick, inputIndex) => ({ ...brick, inputIndex })).sort(compareBricks);
  const duplicates = new Map();
  return sorted.map((brick) => {
    const key = brickKey(brick);
    const duplicate = duplicates.get(key) ?? 0;
    duplicates.set(key, duplicate + 1);
    const { inputIndex: _inputIndex, id: _oldId, ...fields } = brick;
    return { ...fields, id: `b@${key}${duplicate ? `#${duplicate + 1}` : ''}` };
  });
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.bricks) || !Array.isArray(plan.modules)) {
    throw new TypeError('beforePlan must contain bricks and modules arrays.');
  }
  const bricksById = new Map();
  for (const brick of plan.bricks) {
    if (typeof brick?.id !== 'string' || !brick.id || bricksById.has(brick.id)) {
      throw new RangeError('beforePlan brick IDs must be unique nonempty strings.');
    }
    bricksById.set(brick.id, brick);
  }
  const ownerById = new Map();
  const moduleIds = new Set();
  for (const module of plan.modules) {
    if (typeof module?.id !== 'string' || !module.id || moduleIds.has(module.id)) {
      throw new RangeError('beforePlan module IDs must be unique nonempty strings.');
    }
    moduleIds.add(module.id);
    if (!Array.isArray(module.brickIds) || !module.brickIds.length
      || new Set(module.brickIds).size !== module.brickIds.length) {
      throw new RangeError(`beforePlan module ${module.id} must contain unique brick IDs.`);
    }
    for (const id of module.brickIds) {
      if (!bricksById.has(id)) throw new RangeError(`beforePlan module ${module.id} references unknown brick ${id}.`);
      if (ownerById.has(id)) throw new RangeError(`beforePlan brick ${id} belongs to multiple modules.`);
      ownerById.set(id, module.id);
    }
  }
  if (ownerById.size !== bricksById.size) throw new RangeError('Every beforePlan brick must belong to exactly one module.');
  return { bricksById, ownerById };
}

function matchRemovedBricks(beforeBricks, requested) {
  const available = new Map();
  for (const brick of beforeBricks) {
    const key = brickKey(brick);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(brick);
  }
  const removed = [];
  const removedIds = new Set();
  for (const item of requested) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('proposal.before entries must be bricks.');
    const exact = typeof item.id === 'string' ? beforeBricks.find((brick) => brick.id === item.id) : null;
    const match = exact ?? available.get(brickKey(item))?.find((brick) => !removedIds.has(brick.id));
    if (!match || brickKey(match) !== brickKey(item) || removedIds.has(match.id)) {
      throw new RangeError(`proposal.before references an unknown or duplicate brick ${brickKey(item)}.`);
    }
    removed.push(match);
    removedIds.add(match.id);
  }
  return { removed, removedIds };
}

/**
 * Preserve assembly-module ownership across one exact local brick replacement.
 * The returned descriptors contain no derived status, graph, or issue data.
 */
export function mapAssemblyModules(beforePlan, proposal) {
  const { ownerById } = validatePlan(beforePlan);
  if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.before) || !Array.isArray(proposal.after)) {
    throw new TypeError('proposal must contain before and after brick arrays.');
  }
  if (!proposal.before.length || !proposal.after.length) {
    throw new RangeError('proposal.before and proposal.after must be nonempty.');
  }
  const { removed, removedIds } = matchRemovedBricks(beforePlan.bricks, proposal.before);
  const replacedOwners = new Set(removed.map((brick) => ownerById.get(brick.id)));
  if (replacedOwners.size !== 1) throw new RangeError('A replay replacement cannot cross module boundaries.');
  const replacementOwner = replacedOwners.values().next().value;

  const oldCells = new Map();
  for (const brick of beforePlan.bricks) for (const cell of cellsOf(brick)) {
    if (oldCells.has(cell)) throw new RangeError(`beforePlan contains overlapping occupied cell ${cell}.`);
    oldCells.set(cell, { color: brick.color, moduleId: ownerById.get(brick.id), removed: removedIds.has(brick.id) });
  }
  const replacedCells = new Set(removed.flatMap(cellsOf));
  const afterCells = new Map();
  for (const brick of proposal.after) {
    if (!brick || typeof brick !== 'object' || Array.isArray(brick)) throw new TypeError('proposal.after entries must be bricks.');
    const owners = new Set();
    for (const cell of cellsOf(brick)) {
      if (afterCells.has(cell)) throw new RangeError(`proposal.after contains overlapping occupied cell ${cell}.`);
      const old = oldCells.get(cell);
      if (old) {
        if (old.color !== brick.color) throw new RangeError(`A replay replacement recolors occupied cell ${cell}.`);
        if (!old.removed) throw new RangeError(`A replay replacement overlaps unchanged occupied cell ${cell}.`);
        owners.add(old.moduleId);
      }
      afterCells.set(cell, brick.color);
    }
    if (owners.size !== 1 || !owners.has(replacementOwner)) {
      throw new RangeError('Every replay replacement brick must overlap old cells from exactly one replaced module.');
    }
  }
  for (const cell of replacedCells) {
    const old = oldCells.get(cell);
    if (afterCells.get(cell) !== old.color) throw new RangeError(`A replay replacement removes or recolors occupied cell ${cell}.`);
  }

  const kept = beforePlan.bricks.filter((brick) => !removedIds.has(brick.id));
  const expectedCandidate = identified([...kept, ...proposal.after]);
  if (proposal.bricks !== undefined) {
    if (!Array.isArray(proposal.bricks)) throw new TypeError('proposal.bricks must be an array when provided.');
    const supplied = identified(proposal.bricks);
    if (JSON.stringify(supplied.map(brickKey)) !== JSON.stringify(expectedCandidate.map(brickKey))) {
      throw new RangeError('proposal.bricks does not match the declared before/after replacement.');
    }
  }

  const oldOwnerByKey = new Map(kept.map((brick) => [brickKey(brick), ownerById.get(brick.id)]));
  const afterKeys = new Set(proposal.after.map(brickKey));
  const replacementIds = expectedCandidate.filter((brick) => afterKeys.has(brickKey(brick))).map((brick) => brick.id);
  const brickIdsByModule = new Map(beforePlan.modules.map((module) => [module.id, []]));
  for (const brick of expectedCandidate) {
    const owner = afterKeys.has(brickKey(brick)) ? replacementOwner : oldOwnerByKey.get(brickKey(brick));
    if (!brickIdsByModule.has(owner)) throw new RangeError(`Candidate brick ${brick.id} has no replay module owner.`);
    brickIdsByModule.get(owner).push(brick.id);
  }

  return beforePlan.modules.map((module) => {
    const brickIds = brickIdsByModule.get(module.id);
    if (!brickIds.length) throw new RangeError(`Replay would leave module ${module.id} empty.`);
    const oldBrickOrder = (beforePlan.steps ?? []).filter((step) => step.moduleId === module.id)
      .flatMap((step) => step.newBrickIds ?? []);
    if (oldBrickOrder.length !== module.brickIds.length
      || new Set(oldBrickOrder).size !== oldBrickOrder.length
      || oldBrickOrder.some((id) => !module.brickIds.includes(id))) {
      throw new RangeError(`beforePlan module ${module.id} does not have exact unique step coverage.`);
    }
    let insertedReplacement = false;
    const brickOrder = [];
    for (const id of oldBrickOrder) {
      if (removedIds.has(id)) {
        if (!insertedReplacement) {
          brickOrder.push(...replacementIds);
          insertedReplacement = true;
        }
      } else {
        brickOrder.push(id);
      }
    }
    const disconnectedReview = module.kind === 'floating' && (module.componentIds?.length > 1
      || beforePlan.steps?.some((step) => step.moduleId === module.id
        && step.issues?.some((entry) => entry.code === 'disconnected-clusters')));
    const groupType = module.groupType ?? (disconnectedReview ? 'detached-parts' : undefined);
    return {
      id: module.id,
      label: module.label,
      kind: module.kind,
      brickIds,
      brickOrder,
      ...(groupType ? { groupType } : {}),
      ...(module.buildContext ? { buildContext: structuredClone(module.buildContext) } : {}),
    };
  });
}
