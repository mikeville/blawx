function emptyAggregate() {
  return {
    introducedBrickCount: 0,
    peakComponentCount: 0,
    peakDetachedBrickCount: 0,
    peakStepDetachedBrickCount: 0,
    detachedBrickExposure: 0,
    peakLooseBrickCount: 0,
    firstBondAtAddition: null,
    finalComponentCount: 0,
  };
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('plan must be an object.');
  if (!Array.isArray(plan.bricks) || !Array.isArray(plan.modules) || !Array.isArray(plan.steps)) {
    throw new TypeError('plan must contain bricks, modules, and steps arrays.');
  }
  if (!Array.isArray(plan.graph?.edges)) {
    throw new TypeError('plan.graph.edges must be an array of stud-engagement edges.');
  }

  const bricksById = new Map();
  for (const brick of plan.bricks) {
    if (typeof brick?.id !== 'string' || !brick.id || bricksById.has(brick.id)) {
      throw new RangeError('Plan brick IDs must be unique nonempty strings.');
    }
    bricksById.set(brick.id, brick);
  }
  const modulesById = new Map();
  const ownerByBrickId = new Map();
  for (const module of plan.modules) {
    if (typeof module?.id !== 'string' || !module.id || modulesById.has(module.id)) {
      throw new RangeError('Plan module IDs must be unique nonempty strings.');
    }
    if (!Array.isArray(module.brickIds) || new Set(module.brickIds).size !== module.brickIds.length) {
      throw new TypeError(`Plan module ${module.id} must contain unique brickIds.`);
    }
    modulesById.set(module.id, module);
    for (const brickId of module.brickIds) {
      if (!bricksById.has(brickId)) throw new RangeError(`Plan module ${module.id} references unknown brick ${brickId}.`);
      if (ownerByBrickId.has(brickId)) throw new RangeError(`Plan brick ${brickId} belongs to multiple modules.`);
      ownerByBrickId.set(brickId, module.id);
    }
  }
  if (ownerByBrickId.size !== bricksById.size) throw new RangeError('Every plan brick must belong to exactly one module.');

  const adjacency = new Map(plan.bricks.map(({ id }) => [id, new Set()]));
  const edgePairs = new Set();
  for (const edge of plan.graph.edges) {
    if (!edge || typeof edge !== 'object' || typeof edge.a !== 'string' || typeof edge.b !== 'string'
      || edge.a === edge.b || !Number.isSafeInteger(edge.studs) || edge.studs <= 0) {
      throw new TypeError('Each stud-engagement edge must have distinct brick IDs and a positive integer studs count.');
    }
    if (!bricksById.has(edge.a) || !bricksById.has(edge.b)) {
      throw new RangeError('Stud-engagement edges must reference known plan bricks.');
    }
    const a = bricksById.get(edge.a);
    const b = bricksById.get(edge.b);
    const lower = a.y < b.y ? a : b;
    const upper = a.y < b.y ? b : a;
    const xOverlap = Math.min(lower.x + lower.w, upper.x + upper.w) - Math.max(lower.x, upper.x);
    const zOverlap = Math.min(lower.z + lower.d, upper.z + upper.d) - Math.max(lower.z, upper.z);
    if (upper.y !== lower.y + 1 || xOverlap <= 0 || zOverlap <= 0 || edge.studs !== xOverlap * zOverlap) {
      throw new RangeError(`Stud-engagement edge ${edge.a}|${edge.b} does not match adjacent brick footprints.`);
    }
    const pair = [edge.a, edge.b].sort().join('|');
    if (edgePairs.has(pair)) throw new RangeError(`Duplicate stud-engagement edge ${pair}.`);
    edgePairs.add(pair);
    adjacency.get(edge.a).add(edge.b);
    adjacency.get(edge.b).add(edge.a);
  }
  return { modulesById, ownerByBrickId, adjacency };
}

function operationsForStep(step, operationIds) {
  if (!step || typeof step !== 'object' || typeof step.id !== 'string' || !step.id) {
    throw new TypeError('Plan steps must have nonempty string IDs.');
  }
  const operations = Object.hasOwn(step, 'orderedOperations') ? step.orderedOperations : [step];
  if (!Array.isArray(operations) || !operations.length) {
    throw new TypeError(`Plan step ${step.id} orderedOperations must be a nonempty array when present.`);
  }
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object' || typeof operation.id !== 'string' || !operation.id
      || !Array.isArray(operation.newBrickIds)) {
      throw new TypeError(`Plan step ${step.id} contains an invalid ordered operation.`);
    }
    if (operationIds.has(operation.id)) throw new RangeError(`Repeated operation ID ${operation.id}.`);
    operationIds.add(operation.id);
  }
  return operations;
}

function createModuleState(module) {
  return {
    module,
    introduced: new Set(),
    parent: new Map(),
    sizes: new Map(),
    componentCount: 0,
    looseBrickCount: 0,
    largestComponentSize: 0,
    introducedBrickCount: 0,
    peakComponentCount: 0,
    peakDetachedBrickCount: 0,
    peakStepDetachedBrickCount: 0,
    detachedBrickExposure: 0,
    peakLooseBrickCount: 0,
    firstBondAtAddition: null,
    stepStates: [],
  };
}

function find(state, id) {
  let root = id;
  while (state.parent.get(root) !== root) root = state.parent.get(root);
  let current = id;
  while (state.parent.get(current) !== current) {
    const next = state.parent.get(current);
    state.parent.set(current, root);
    current = next;
  }
  return root;
}

function union(state, a, b) {
  let rootA = find(state, a);
  let rootB = find(state, b);
  if (rootA === rootB) return false;
  const sizeA = state.sizes.get(rootA);
  const sizeB = state.sizes.get(rootB);
  if (sizeA < sizeB || sizeA === sizeB && rootA.localeCompare(rootB) > 0) [rootA, rootB] = [rootB, rootA];
  const retainedSize = state.sizes.get(rootA);
  const mergedSize = state.sizes.get(rootB);
  state.parent.set(rootB, rootA);
  state.sizes.set(rootA, retainedSize + mergedSize);
  state.sizes.delete(rootB);
  state.componentCount -= 1;
  if (retainedSize === 1) state.looseBrickCount -= 1;
  if (mergedSize === 1) state.looseBrickCount -= 1;
  state.largestComponentSize = Math.max(state.largestComponentSize, retainedSize + mergedSize);
  return true;
}

function addBrick(state, brickId, adjacency, globalAddition) {
  state.introduced.add(brickId);
  state.parent.set(brickId, brickId);
  state.sizes.set(brickId, 1);
  state.introducedBrickCount += 1;
  state.componentCount += 1;
  state.looseBrickCount += 1;
  state.largestComponentSize = Math.max(state.largestComponentSize, 1);
  let bonded = false;
  for (const neighbor of adjacency.get(brickId)) {
    if (state.introduced.has(neighbor)) bonded = union(state, brickId, neighbor) || bonded;
  }
  if (bonded && state.firstBondAtAddition === null) state.firstBondAtAddition = state.introducedBrickCount;
  const detachedBrickCount = state.introducedBrickCount - state.largestComponentSize;
  state.peakComponentCount = Math.max(state.peakComponentCount, state.componentCount);
  state.peakDetachedBrickCount = Math.max(state.peakDetachedBrickCount, detachedBrickCount);
  state.detachedBrickExposure += detachedBrickCount;
  state.peakLooseBrickCount = Math.max(state.peakLooseBrickCount, state.looseBrickCount);
  return bonded ? globalAddition : null;
}

function publicModuleState(state) {
  return {
    moduleId: state.module.id,
    introducedBrickCount: state.introducedBrickCount,
    peakComponentCount: state.peakComponentCount,
    peakDetachedBrickCount: state.peakDetachedBrickCount,
    peakStepDetachedBrickCount: state.peakStepDetachedBrickCount,
    detachedBrickExposure: state.detachedBrickExposure,
    peakLooseBrickCount: state.peakLooseBrickCount,
    firstBondAtAddition: state.firstBondAtAddition,
    finalComponentCount: state.componentCount,
    stepStates: state.stepStates,
  };
}

export function assessWorkSurfaceQuality(plan) {
  const { ownerByBrickId, adjacency } = validatePlan(plan);
  const workSurfaceModules = plan.modules.filter((module) => module.buildContext?.kind === 'work-surface');
  const states = new Map(workSurfaceModules.map((module) => [module.id, createModuleState(module)]));
  const introducedIds = new Set();
  const outerStepIds = new Set();
  const operationIds = new Set();
  let globalAddition = 0;
  let firstGlobalBond = null;

  for (const step of plan.steps) {
    if (outerStepIds.has(step?.id)) throw new RangeError(`Repeated outer step ID ${step?.id}.`);
    outerStepIds.add(step?.id);
    const touched = new Set();
    for (const operation of operationsForStep(step, operationIds)) for (const brickId of operation.newBrickIds) {
      if (!adjacency.has(brickId)) throw new RangeError(`Operation ${operation.id} introduces unknown brick ${brickId}.`);
      if (introducedIds.has(brickId)) throw new RangeError(`Brick ${brickId} is introduced more than once.`);
      introducedIds.add(brickId);
      const state = states.get(ownerByBrickId.get(brickId));
      if (!state) continue;
      globalAddition += 1;
      touched.add(state.module.id);
      const bondAt = addBrick(state, brickId, adjacency, globalAddition);
      if (bondAt !== null && firstGlobalBond === null) firstGlobalBond = bondAt;
    }
    for (const moduleId of touched) {
      const state = states.get(moduleId);
      const detachedBrickCount = state.introducedBrickCount - state.largestComponentSize;
      state.peakStepDetachedBrickCount = Math.max(state.peakStepDetachedBrickCount, detachedBrickCount);
      state.stepStates.push({
        stepId: step.id,
        introducedBrickCount: state.introducedBrickCount,
        componentCount: state.componentCount,
        detachedBrickCount,
        looseBrickCount: state.looseBrickCount,
      });
    }
  }

  const modules = workSurfaceModules.map((module) => publicModuleState(states.get(module.id)));
  const aggregate = modules.reduce((result, module) => ({
    introducedBrickCount: result.introducedBrickCount + module.introducedBrickCount,
    peakComponentCount: Math.max(result.peakComponentCount, module.peakComponentCount),
    peakDetachedBrickCount: Math.max(result.peakDetachedBrickCount, module.peakDetachedBrickCount),
    peakStepDetachedBrickCount: Math.max(result.peakStepDetachedBrickCount, module.peakStepDetachedBrickCount),
    detachedBrickExposure: result.detachedBrickExposure + module.detachedBrickExposure,
    peakLooseBrickCount: Math.max(result.peakLooseBrickCount, module.peakLooseBrickCount),
    firstBondAtAddition: firstGlobalBond,
    finalComponentCount: result.finalComponentCount + module.finalComponentCount,
  }), emptyAggregate());

  return {
    version: 1,
    moduleCount: modules.length,
    modules,
    aggregate,
    limitations: 'These stud-graph component counts are a bounded handling proxy for work-surface order. They do not measure clutch strength, balance, hand access, table stability, or physical buildability.',
  };
}
