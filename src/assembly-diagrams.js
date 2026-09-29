import {orientedCourseRejections} from './oriented-course-diagrams.js';
import { chooseInstructionView, evaluateInstructionVisibility } from './instruction-visibility.js';
import {spatialRegions, placementFootprint} from './placement-groups.js';
import {recipeDiagramGroups} from './recipe-diagram-groups.js';
import {nestedRecipeScopes} from './nested-recipe-references.js';

const MAX_DIAGRAM_BRICKS = 12;
const MAX_MIXED_COURSE_BRICKS = 6;
const MAX_DIAGRAM_COLORS = 3;
const MAX_COURSE_SPAN = 2;
const MAX_HORIZONTAL_SPAN = 12;
const MAX_FOOTPRINT_GAP = 2;

function uniqueMap(items, name) {
  const result = new Map();
  for (const item of items) {
    if (typeof item?.id !== 'string' || result.has(item.id)) throw new RangeError(`${name} IDs must be unique strings.`);
    result.set(item.id, item);
  }
  return result;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('plan must be an object.');
  if (!Array.isArray(plan.bricks) || !Array.isArray(plan.modules) || !Array.isArray(plan.steps)) {
    throw new TypeError('plan must contain bricks, modules, and steps arrays.');
  }
  const bricksById = uniqueMap(plan.bricks, 'Plan brick');
  const modulesById = uniqueMap(plan.modules, 'Plan module');
  const stepsById = uniqueMap(plan.steps, 'Plan step');
  const introduced = new Set();
  for (const step of plan.steps) {
    if (!Array.isArray(step.newBrickIds) || !Array.isArray(step.visibleBrickIds)
      || !Array.isArray(step.highlightBrickIds) || !Array.isArray(step.issues)) {
      throw new TypeError(`Plan step ${step.id} must contain brick ID and issue arrays.`);
    }
    for (const brickId of step.newBrickIds) {
      if (!bricksById.has(brickId)) throw new RangeError(`Plan step ${step.id} introduces an unknown brick.`);
      if (introduced.has(brickId)) throw new RangeError(`Plan brick ${brickId} is introduced more than once.`);
      introduced.add(brickId);
    }
  }
  if (introduced.size !== bricksById.size) throw new RangeError('Instruction compaction requires complete plan brick coverage.');
  return { bricksById, modulesById, stepsById };
}

function orderedUnique(values) {
  return [...new Set(values)];
}

function footprintGap(a, b) {
  const xGap = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const zGap = Math.max(0, a.z - (b.z + b.d), b.z - (a.z + a.d));
  return xGap + zGap;
}

function bodyCellKey(x, y, z) {
  return `${x},${y},${z}`;
}

// Each compaction pass owns a fresh brick map. Cache its fixed geometry,
// then traverse only the current visible scene; future pieces cannot connect it.
const geometryGraphs=new WeakMap();
function visibleGeometryGraph(bricksById) {
  if(geometryGraphs.has(bricksById))return geometryGraphs.get(bricksById);
  const owners=new Map(),adjacency=new Map([...bricksById.keys()].map(id=>[id,new Set()]));
  for(const brick of bricksById.values())for(let dz=0;dz<brick.d;dz++)for(let dx=0;dx<brick.w;dx++){
    const key=bodyCellKey(brick.x+dx,brick.y,brick.z+dz);
    // Preserve the original visible-scene behavior even for overlapping input.
    if(owners.has(key)){geometryGraphs.set(bricksById,null);return null;}
    owners.set(key,brick.id);
  }
  const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for(const brick of bricksById.values())for(let dz=0;dz<brick.d;dz++)for(let dx=0;dx<brick.w;dx++)for(const [x,y,z]of directions){
    const other=owners.get(bodyCellKey(brick.x+dx+x,brick.y+y,brick.z+dz+z));
    if(other&&other!==brick.id)adjacency.get(brick.id).add(other);
  }
  geometryGraphs.set(bricksById,adjacency);return adjacency;
}
function additionsConnectThroughVisibleGeometry(steps,bricksById){
  const last=steps.at(-1),visible=new Set(last.visibleBrickIds.filter(id=>bricksById.has(id)));
  const prior=new Set(steps.slice(0,-1).flatMap(s=>s.highlightBrickIds).filter(id=>visible.has(id)));
  const appended=new Set(last.highlightBrickIds.filter(id=>visible.has(id)));
  if(!prior.size||!appended.size)return false;
  const adjacency=visibleGeometryGraph(bricksById);
  if(!adjacency)return uncachedAdditionsConnectThroughVisibleGeometry(steps,bricksById);
  const highlighted=new Set([...prior,...appended]),first=highlighted.values().next().value,reached=new Set([first]),pending=[first];
  while(pending.length)for(const id of adjacency.get(pending.pop())??[])if(visible.has(id)&&!reached.has(id)){reached.add(id);pending.push(id);}
  return [...highlighted].every(id=>reached.has(id));
}
function uncachedAdditionsConnectThroughVisibleGeometry(steps, bricksById) {
  const finalStep = steps.at(-1);
  const visibleBricks = finalStep.visibleBrickIds.map((brickId) => bricksById.get(brickId)).filter(Boolean);
  const visibleIds = new Set(visibleBricks.map(({ id }) => id));
  const priorHighlightIds = new Set(steps.slice(0, -1)
    .flatMap((step) => step.highlightBrickIds)
    .filter((brickId) => visibleIds.has(brickId)));
  const appendedHighlightIds = new Set(finalStep.highlightBrickIds.filter((brickId) => visibleIds.has(brickId)));
  if (!priorHighlightIds.size || !appendedHighlightIds.size) return false;

  const owners = new Map();
  const adjacency = new Map(visibleBricks.map(({ id }) => [id, new Set()]));
  for (const brick of visibleBricks) {
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      owners.set(bodyCellKey(brick.x + dx, brick.y, brick.z + dz), brick.id);
    }
  }
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const brick of visibleBricks) {
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const x = brick.x + dx;
      const z = brick.z + dz;
      for (const [xOffset, yOffset, zOffset] of directions) {
        const neighborId = owners.get(bodyCellKey(x + xOffset, brick.y + yOffset, z + zOffset));
        if (neighborId && neighborId !== brick.id) adjacency.get(brick.id).add(neighborId);
      }
    }
  }

  const highlightedIds = new Set([...priorHighlightIds, ...appendedHighlightIds]);
  const firstHighlightId = highlightedIds.values().next().value;
  const reached = new Set([firstHighlightId]);
  const pending = [firstHighlightId];
  while (pending.length) {
    const brickId = pending.pop();
    for (const neighborId of adjacency.get(brickId) ?? []) if (!reached.has(neighborId)) {
      reached.add(neighborId);
      pending.push(neighborId);
    }
  }
  return [...highlightedIds].every((brickId) => reached.has(brickId));
}

function sourceOperation(step) {
  return {
    id: step.id,
    kind: step.kind,
    insertionDirection: step.insertionDirection ?? 'down',
    ...(step.workingOrientation ? {workingOrientation:structuredClone(step.workingOrientation)} : {}),
    newBrickIds: [...step.newBrickIds],
    highlightBrickIds: [...step.highlightBrickIds],
    issues: structuredClone(step.issues),
  };
}

function isSingleBrickPlacementPair(buildStep, joinStep, modulesById) {
  if (!buildStep || !joinStep || buildStep.moduleId !== joinStep.moduleId) return false;
  const module = modulesById.get(buildStep.moduleId);
  const nested = joinStep.nestedRecipe;
  const standalone = Array.isArray(module?.brickIds) && module.brickIds.length === 1;
  const singleChild = nested?.separate && joinStep.kind === 'join' && !joinStep.issues.length
    && nested.firstStepId === buildStep.id && nested.attachmentStepId === joinStep.id
    && nestedRecipeScopes(buildStep).some(scope => scope.id === nested.id)
    && buildStep.visibleBrickIds.length === 1;
  if (!standalone && !singleChild) return false;
  const brickId = standalone ? module.brickIds[0] : buildStep.visibleBrickIds[0];
  return buildStep.kind === 'build'
    && buildStep.newBrickIds.length === 1
    && buildStep.newBrickIds[0] === brickId
    && buildStep.highlightBrickIds.length === 1
    && buildStep.highlightBrickIds[0] === brickId
    && buildStep.issues.every(({ code, severity }) => code === 'temporary-hold' && severity === 'warning')
    && (joinStep.kind === 'join' || joinStep.kind === 'unresolved')
    && joinStep.newBrickIds.length === 0
    && joinStep.highlightBrickIds.length === 1
    && joinStep.highlightBrickIds[0] === brickId;
}

function isCompleteLayerLayout(steps, bricks, bricksById, module) {
  const action=steps[0].instructionAction, destination=action?.destination;
  if(module?.buildContext?.kind!=='work-surface'||destination?.kind!=='layer'
    ||!steps.every(s=>s.instructionAction?.id===action.id)
    ||!bricks.length||bricks.some(b=>b.y!==destination.course))return false;
  const bounds=placementFootprint(bricks),axis=destination.axis,span=axis==='x'?'w':'d';
  if(!['x','z'].includes(axis)||bricks.length>18||bounds.width>16||bounds.depth>16
    ||Math.min(bounds.width,bounds.depth)>12||bounds.fill<.8
    ||bricks.reduce((n,b)=>n+b.w*b.d,0)>192)return false;
  const ids=new Set(bricks.map(b=>b.id));
  const expected=module.brickIds.map(id=>bricksById.get(id)).filter(b=>b.y===destination.course
    &&b[axis]<destination.end&&b[axis]+b[span]>destination.start);
  return expected.length===ids.size&&expected.every(b=>ids.has(b.id));
}

function staticRejectionReasons(steps, bricksById, module, { preserveSupportAdvisory = false } = {}) {
  const reasons = [];
  const first = steps[0];
  const introduced = steps.flatMap(step => step.newBrickIds);
  const completeSmallAssembly = module?.buildContext?.kind === 'work-surface'
    && module.brickIds.length <= MAX_MIXED_COURSE_BRICKS
    && introduced.length === module.brickIds.length
    && module.brickIds.every(id => introduced.includes(id));
  if (!completeSmallAssembly && steps.some(step=>step.instructionAction) && steps.some(step=>step.instructionAction?.id!==first.instructionAction?.id)) reasons.push('action-boundary');
  if (steps.some((step) => step.moduleId !== first.moduleId)) reasons.push('module-boundary');
  if (steps.some(step => step.nestedRecipe?.id !== first.nestedRecipe?.id)) reasons.push('nested-recipe-boundary');
  if (steps.some((step) => step.kind !== 'build' || step.newBrickIds.length === 0)) reasons.push('non-build-step');
  if (steps.some((step) => (step.insertionDirection ?? 'down') !== 'down')) reasons.push('insertion-direction');
  if (steps.some(step => step.issues.some(issue => !(preserveSupportAdvisory && completeSmallAssembly
    && issue.code === 'limited-support' && issue.severity === 'warning')))) reasons.push('reported-issue');

  const brickIds = steps.flatMap((step) => step.newBrickIds);
  const bricks = brickIds.map((brickId) => bricksById.get(brickId));
  const completeLayout=isCompleteLayerLayout(steps,bricks,bricksById,module);
  if (steps.some(step => step.placementGroupId)) {
    if (spatialRegions(bricks).length > 1) reasons.push('scattered-additions');
    const courses = new Set(bricks.map(b => b.y));
    const wholeLayer = courses.size === 1 && module?.brickIds.filter(id => bricksById.get(id).y === bricks[0].y).length === bricks.length;
    if (courses.size === 1 && !wholeLayer && !completeLayout && bricks.length > 4 && placementFootprint(bricks).fill < 0.9) reasons.push('ragged-placement-patch');
    const sameGroup = steps.every(step => step.placementGroupId === first.placementGroupId);
    const bonds = steps.every(step => step.placementGroupId?.startsWith(`${step.moduleId}-bond-`));
    if (!completeSmallAssembly && !sameGroup && !bonds && courses.size > 1) reasons.push('placement-group-boundary');
  }
  if (bricks.length > (completeLayout?18:MAX_DIAGRAM_BRICKS)) reasons.push('brick-limit');
  if (!bricks.length) return reasons;
  if (Math.max(...bricks.map(({ y }) => y)) - Math.min(...bricks.map(({ y }) => y)) > MAX_COURSE_SPAN) {
    reasons.push('course-span');
  }
  if (new Set(bricks.map(({ color }) => color)).size > MAX_DIAGRAM_COLORS) reasons.push('color-limit');
  // A dozen pieces on one exposed layer can be read as a layout. Spanning
  // layers also asks the reader to infer which new pieces support the others;
  // retain smaller placement groups instead of hiding that build sequence.
  if (new Set(bricks.map(({ y }) => y)).size > 1 && bricks.length > MAX_MIXED_COURSE_BRICKS) {
    reasons.push('mixed-course-piece-limit');
  }
  if (Math.max(...bricks.map(({ x, w }) => x + w)) - Math.min(...bricks.map(({ x }) => x)) > (completeLayout?16:MAX_HORIZONTAL_SPAN)) {
    reasons.push('x-span');
  }
  if (Math.max(...bricks.map(({ z, d }) => z + d)) - Math.min(...bricks.map(({ z }) => z)) > (completeLayout?16:MAX_HORIZONTAL_SPAN)) {
    reasons.push('z-span');
  }

  if (steps.length > 1) {
    const priorBricks = steps.slice(0, -1).flatMap((step) => step.newBrickIds.map((brickId) => bricksById.get(brickId)));
    const appendedBricks = steps.at(-1).newBrickIds.map((brickId) => bricksById.get(brickId));
    if (!priorBricks.length || !appendedBricks.length
      || Math.min(...priorBricks.flatMap((prior) => appendedBricks.map((added) => footprintGap(prior, added)))) > MAX_FOOTPRINT_GAP) {
      reasons.push('not-local');
    }
    if (!additionsConnectThroughVisibleGeometry(steps, bricksById)) reasons.push('not-face-connected');
  }
  return reasons;
}

function visibilityResult(steps, bricksById) {
  const finalStep = steps.at(-1);
  const visibleBricks = finalStep.visibleBrickIds.map(id => bricksById.get(id)).filter(Boolean);
  const highlightedIds = steps.flatMap(step => step.newBrickIds);
  const primary = chooseInstructionView({ visibleBricks, highlightedIds });
  if (primary.passes || primary.truncated || primary.alternateAzimuth === null) return primary;
  const alternate = evaluateInstructionVisibility({
    visibleBricks,
    highlightGroups: highlightedIds.map(id => ({ id, bricks: [bricksById.get(id)] })),
    azimuth: primary.alternateAzimuth,
  });
  const visibleInAlternate = new Set(alternate.groups.filter(group => group.visibleBrickCount).map(group => group.id));
  // The reader offers exactly these two views. A piece hidden in both must be
  // introduced before the covering pieces, even if its source operation has
  // other visible additions.
  return {
    passes: !alternate.truncated && primary.groups.every(group => group.visibleBrickCount || visibleInAlternate.has(group.id)),
    truncated: alternate.truncated,
  };
}

function rectangularLayerMergeRejections(steps, bricksById) {
  const groups = steps.map(step => step.newBrickIds.map(id => bricksById.get(id)));
  const bricks = groups.flat();
  if (new Set(bricks.map(brick => brick.y)).size > 1) return ['rectangular-layer-boundary'];
  const fillRatio = items => {
    const width = Math.max(...items.map(b => b.x + b.w)) - Math.min(...items.map(b => b.x));
    const depth = Math.max(...items.map(b => b.z + b.d)) - Math.min(...items.map(b => b.z));
    return items.reduce((area,b) => area + b.w*b.d,0) / (width*depth);
  };
  return fillRatio(bricks) + 1e-9 < Math.min(...groups.map(fillRatio)) ? ['rectangular-group-boundary'] : [];
}

function isConnectedPatchModule(module) {
  return module?.buildContext?.kind === 'work-surface'
    && module.buildContext.orderPolicy === 'connected-patches';
}

function studAdjacencyForModule(plan, module) {
  const moduleIds = new Set(module.brickIds);
  const adjacency = new Map(module.brickIds.map((brickId) => [brickId, new Set()]));
  for (const edge of plan.graph?.edges ?? []) {
    if (!moduleIds.has(edge.a) || !moduleIds.has(edge.b)) continue;
    adjacency.get(edge.a).add(edge.b);
    adjacency.get(edge.b).add(edge.a);
  }
  return adjacency;
}

function projectedModuleIsStudConnected(steps, previouslyPlaced, adjacency) {
  const placed = new Set(previouslyPlaced);
  for (const step of steps) for (const brickId of step.newBrickIds) {
    if (adjacency.has(brickId)) placed.add(brickId);
  }
  if (!placed.size) return false;
  const first = placed.values().next().value;
  const reached = new Set([first]);
  const pending = [first];
  while (pending.length) {
    const brickId = pending.pop();
    for (const neighborId of adjacency.get(brickId) ?? []) {
      if (!placed.has(neighborId) || reached.has(neighborId)) continue;
      reached.add(neighborId);
      pending.push(neighborId);
    }
  }
  return reached.size === placed.size;
}

function connectedPatchBoundaryStats(plan) {
  const modules = new Map(plan.modules
    .filter((module) => isConnectedPatchModule(module))
    .map((module) => [module.id, {
      brickIds: new Set(module.brickIds),
      adjacency: studAdjacencyForModule(plan, module),
      placed: new Set(),
    }]));
  let detachedBrickExposure = 0;
  let peakDetachedBrickCount = 0;
  let buildDiagramCount = 0;
  for (const step of plan.steps) {
    const state = modules.get(step.moduleId);
    if (!state || step.kind !== 'build') continue;
    buildDiagramCount += 1;
    for (const brickId of step.newBrickIds) if (state.brickIds.has(brickId)) state.placed.add(brickId);
    let largestComponentSize = 0;
    const reached = new Set();
    for (const start of state.placed) {
      if (reached.has(start)) continue;
      let componentSize = 0;
      reached.add(start);
      const pending = [start];
      while (pending.length) {
        const brickId = pending.pop();
        componentSize += 1;
        for (const neighborId of state.adjacency.get(brickId) ?? []) {
          if (!state.placed.has(neighborId) || reached.has(neighborId)) continue;
          reached.add(neighborId);
          pending.push(neighborId);
        }
      }
      largestComponentSize = Math.max(largestComponentSize, componentSize);
    }
    const detachedBrickCount = state.placed.size - largestComponentSize;
    detachedBrickExposure += detachedBrickCount;
    peakDetachedBrickCount = Math.max(peakDetachedBrickCount, detachedBrickCount);
  }
  return { buildDiagramCount, detachedBrickExposure, peakDetachedBrickCount };
}

function compactedStep(steps, diagramNumber, { singleBrickPlacement = false } = {}) {
  const first = steps[0];
  const final = steps.at(-1);
  const newBrickIds = orderedUnique(steps.flatMap((step) => step.newBrickIds));
  const highlightBrickIds = orderedUnique(steps.flatMap((step) => step.highlightBrickIds));
  const labelPrefix = first.label.includes(' · add ') ? first.label.slice(0, first.label.indexOf(' · add ')) : first.label;
  return {
    ...structuredClone(final),
    id: `instruction-step-${diagramNumber}`,
    moduleId: first.moduleId,
    label: singleBrickPlacement ? final.label : steps.length === 1 ? first.label
      : `${labelPrefix} · add ${newBrickIds.length} ${newBrickIds.length === 1 ? 'brick' : 'bricks'}`,
    kind: singleBrickPlacement ? final.kind
      : steps.some(({ kind }) => kind === 'unresolved') ? 'unresolved' : first.kind,
    newBrickIds,
    visibleBrickIds: [...final.visibleBrickIds],
    highlightBrickIds,
    issues: structuredClone(steps.flatMap((step) => step.issues)),
    sourceStepIds: steps.map(({ id }) => id),
    orderedOperations: steps.map(sourceOperation),
  };
}

function countReferences(steps) {
  return steps.reduce((sum, step) => sum
    + step.newBrickIds.length + step.visibleBrickIds.length + step.highlightBrickIds.length, 0);
}

function compactAssemblyPlanPass(plan, { connectedPatchEndpoints = false } = {}) {
  const { bricksById, modulesById } = validatePlan(plan);
  const connectedPatchAdjacency = connectedPatchEndpoints
    ? new Map([...modulesById]
      .filter(([, module]) => isConnectedPatchModule(module))
      .map(([moduleId, module]) => [moduleId, studAdjacencyForModule(plan, module)]))
    : new Map();
  const placedConnectedPatchBricks = new Map([...connectedPatchAdjacency.keys()]
    .map((moduleId) => [moduleId, new Set()]));
  const instructionSteps = [];
  const rejectedMerges = [];
  const rejectedMergeCounts = {};
  let visibilityCheckCount = 0;
  let visibilityTruncationCount = 0;
  let cursor = 0;

  const reject = (current, next, reasons) => {
    rejectedMerges.push({
      sourceStepIds: current.map(({ id }) => id),
      nextSourceStepId: next.id,
      reasons,
    });
    for (const reason of reasons) rejectedMergeCounts[reason] = (rejectedMergeCounts[reason] ?? 0) + 1;
  };

  while (cursor < plan.steps.length) {
    if (isSingleBrickPlacementPair(plan.steps[cursor], plan.steps[cursor + 1], modulesById)) {
      instructionSteps.push(compactedStep(
        [plan.steps[cursor], plan.steps[cursor + 1]],
        instructionSteps.length + 1,
        { singleBrickPlacement: true },
      ));
      const placed = placedConnectedPatchBricks.get(plan.steps[cursor].moduleId);
      if (placed) for (const brickId of plan.steps[cursor].newBrickIds) placed.add(brickId);
      cursor += 2;
      continue;
    }
    const start = cursor;
    const candidate = [plan.steps[start]];
    const moduleId = plan.steps[start].moduleId;
    const connectedAdjacency = connectedPatchAdjacency.get(moduleId);
    const previouslyPlaced = placedConnectedPatchBricks.get(moduleId);
    let latestValidEnd = start + 1;
    let latestConnectedEnd = connectedAdjacency
      && projectedModuleIsStudConnected(candidate, previouslyPlaced, connectedAdjacency)
      ? start + 1 : null;
    let probe = start + 1;
    while (probe < plan.steps.length) {
      const next = plan.steps[probe];
      const extended = [...candidate, next];
      const reasons = staticRejectionReasons(extended, bricksById, modulesById.get(moduleId));
      if (!reasons.length && modulesById.get(moduleId)?.buildContext?.orderPolicy === 'rectangular-layers') {
        reasons.push(...rectangularLayerMergeRejections(extended, bricksById));
      }
      const temporarilyDisconnected = reasons.length > 0 && reasons.every(reason => reason === 'not-face-connected' || reason === 'ragged-placement-patch');
      if (temporarilyDisconnected) {
        reject(candidate, next, reasons);
        candidate.push(next);
        probe += 1;
        continue;
      }
      if (!reasons.length) {
        const visibility = visibilityResult(extended, bricksById);
        visibilityCheckCount += 1;
        if (!visibility.passes) {
          reasons.push(visibility.truncated ? 'visibility-budget' : 'visibility');
          if (visibility.truncated) visibilityTruncationCount += 1;
        }
      }
      if (reasons.length) {
        reject(candidate, next, reasons);
        break;
      }
      candidate.push(next);
      probe += 1;
      latestValidEnd = probe;
      if (connectedAdjacency
        && projectedModuleIsStudConnected(candidate, previouslyPlaced, connectedAdjacency)) {
        latestConnectedEnd = probe;
      }
    }
    // Connected-patch source operations deliberately allow a short, detached
    // prerequisite prefix. A display diagram may merge that prefix only when its
    // endpoint shows the whole work-surface band connected by studs. If the next
    // bonding operation would exceed another diagram bound, rewind before the
    // trailing prerequisite so it can be shown with its bond in the next diagram.
    const compactedEnd = connectedAdjacency ? (latestConnectedEnd ?? start + 1) : latestValidEnd;
    const compacted = plan.steps.slice(start, compactedEnd);
    cursor = compactedEnd;
    if (previouslyPlaced) for (const step of compacted) {
      for (const brickId of step.newBrickIds) if (connectedAdjacency.has(brickId)) previouslyPlaced.add(brickId);
    }
    instructionSteps.push(compactedStep(compacted, instructionSteps.length + 1));
  }

  const sourceStepIds = instructionSteps.flatMap(({ sourceStepIds: ids }) => ids);
  const introducedBrickIds = instructionSteps.flatMap(({ newBrickIds }) => newBrickIds);
  const sourceStepCoverageComplete = sourceStepIds.length === plan.steps.length
    && sourceStepIds.every((stepId, index) => stepId === plan.steps[index].id);
  const brickCoverageComplete = introducedBrickIds.length === plan.bricks.length
    && new Set(introducedBrickIds).size === plan.bricks.length;
  const instructionPlan = {
    ...plan,
    steps: instructionSteps,
    stats: {
      ...plan.stats,
      stepCount: instructionSteps.length,
      unresolvedStepCount: instructionSteps.filter(({ kind }) => kind === 'unresolved').length,
      coverageComplete: brickCoverageComplete,
      maxBricksPerStep: Math.max(0, ...instructionSteps.map(({ newBrickIds }) => newBrickIds.length)),
      planReferenceCount: countReferences(instructionSteps),
    },
    limitations: [
      ...(plan.limitations ?? []),
      'Instruction diagrams may combine consecutive validated build operations; sourceStepIds and orderedOperations preserve their internal sequence.',
    ],
  };
  const mergedDiagramCount = instructionSteps.filter(({ sourceStepIds: ids }) => ids.length > 1).length;
  return {
    plan: instructionPlan,
    report: {
      sourceStepCount: plan.steps.length,
      instructionDiagramCount: instructionSteps.length,
      mergedDiagramCount,
      collapsedStepCount: plan.steps.length - instructionSteps.length,
      sourceStepCoverageComplete,
      brickCoverageComplete,
      visibilityCheckCount,
      visibilityTruncationCount,
      rejectedMergeCounts,
      rejectedMerges,
      limits: {
        maxBricks: MAX_DIAGRAM_BRICKS,
        completeLayerMaxBricks: 18,
        completeLayerMaxHorizontalSpan: 16,
        maxMixedCourseBricks: MAX_MIXED_COURSE_BRICKS,
        maxColors: MAX_DIAGRAM_COLORS,
        maxCourseSpan: MAX_COURSE_SPAN,
        maxHorizontalSpan: MAX_HORIZONTAL_SPAN,
        maxFootprintGap: MAX_FOOTPRINT_GAP,
        requiresFaceConnectedAppend: true,
      },
    },
  };
}

export function compactAssemblyPlan(plan) {
  const hasConnectedPatchModule = Array.isArray(plan?.modules)
    && plan.modules.some((module) => isConnectedPatchModule(module));
  if (!hasConnectedPatchModule) return compactCompleteSmallRecipes(plan, restoreRecipeDiagrams(plan, compactAssemblyPlanPass(plan)));

  const basic = compactAssemblyPlanPass(plan);
  const connected = compactAssemblyPlanPass(plan, { connectedPatchEndpoints: true });
  const basicBoundaryStats = connectedPatchBoundaryStats(basic.plan);
  const connectedBoundaryStats = connectedPatchBoundaryStats(connected.plan);
  const connectedWithinDiagramBound = connected.plan.steps.length <= basic.plan.steps.length + 1;
  const boundaryHandlingImproves = connectedBoundaryStats.detachedBrickExposure
      < basicBoundaryStats.detachedBrickExposure
    && connectedBoundaryStats.peakDetachedBrickCount <= basicBoundaryStats.peakDetachedBrickCount;
  const useConnected = connectedWithinDiagramBound && boundaryHandlingImproves;
  const selected = useConnected ? connected : basic;
  return compactCompleteSmallRecipes(plan, restoreRecipeDiagrams(plan, {
    ...selected,
    report: {
      ...selected.report,
      connectedPatchCompaction: {
        selected: useConnected ? 'connected-endpoints' : 'basic-bounded',
        basicInstructionDiagramCount: basic.plan.steps.length,
        connectedInstructionDiagramCount: connected.plan.steps.length,
        maxAdditionalDiagramCount: 1,
        basicBoundaryStats,
        connectedBoundaryStats,
      },
    },
  }));
}

// A complete small recipe is one task even when its final bond has a strength
// advisory. Keep the advisory, every operation and the separate real attachment.
// Membership comes from that attachment, not the size of the enclosing model.
function compactCompleteSmallRecipes(source, compacted) {
  const byId=new Map(source.bricks.map(brick=>[brick.id,brick]));
  const sourceById=new Map(source.steps.map(step=>[step.id,step]));
  const modules=new Map(source.modules.map(module=>[module.id,module]));
  const context=step=>{
    if(!step.nestedRecipe)return modules.get(step.moduleId)?.buildContext;
    let prefix=step.moduleId,recipe=source.moduleRecipes?.[prefix],child;
    for(const scope of nestedRecipeScopes(step)){
      child=recipe?.moduleReplay.find(module=>`${prefix}/${module.id}`===scope.id);
      if(!child)return null;
      prefix=scope.id;recipe=recipe.moduleRecipes?.[child.id];
    }
    return child?.buildContext;
  };
  const scope=step=>JSON.stringify(nestedRecipeScopes(step));
  const attempts=[],steps=[...compacted.plan.steps];
  for(let index=0;index<steps.length;index++){
    const join=steps[index],nested=join.nestedRecipe,module=modules.get(join.moduleId);
    if(join.kind!=='join'||join.issues.length||join.newBrickIds.length
      ||(nested?!nested.separate:module?.buildContext?.kind!=='work-surface'))continue;
    const ids=new Set(join.highlightBrickIds);
    if(ids.size<2||ids.size>MAX_MIXED_COURSE_BRICKS)continue;
    let start=index;
    while(start>0&&steps[start-1].kind==='build'&&steps[start-1].moduleId===join.moduleId
      &&scope(steps[start-1])===scope(join))start--;
    if(index-start<2)continue;
    const run=steps.slice(start,index),operations=run.flatMap(step=>step.sourceStepIds.map(id=>sourceById.get(id)));
    const introduced=operations.flatMap(step=>step.newBrickIds);
    if(introduced.length!==ids.size||introduced.some(id=>!ids.has(id))
      ||nested&&(operations[0].id!==nested.firstStepId||!join.sourceStepIds.includes(nested.attachmentStepId)))continue;
    const buildContext=context(join);
    if(buildContext?.kind!=='work-surface')continue;
    const recipeModule={...module,brickIds:[...ids],buildContext:{...buildContext,floorY:nested?.floorY??buildContext.floorY}};
    const reasons=staticRejectionReasons(operations,byId,recipeModule,{preserveSupportAdvisory:true});
    if(buildContext.orderPolicy==='rectangular-layers')reasons.push(...rectangularLayerMergeRejections(operations,byId));
    if(!reasons.length){const view=visibilityResult(operations,byId);if(!view.passes||view.truncated)reasons.push('visibility');}
    attempts.push({sourceStepIds:operations.map(step=>step.id),merged:!reasons.length,reasons});
    if(reasons.length)continue;
    const merged={...compactedStep(operations,0),id:run[0].id};
    steps.splice(start,run.length,merged);index=start+1;
  }
  if(!attempts.length)return compacted;
  return {plan:{...compacted.plan,steps,stats:{...compacted.plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(0,...steps.map(step=>step.newBrickIds.length)),planReferenceCount:countReferences(steps)}},
  report:{...compacted.report,instructionDiagramCount:steps.length,collapsedStepCount:source.steps.length-steps.length,
    mergedDiagramCount:steps.filter(step=>step.sourceStepIds.length>1).length,smallAssemblyDiagrams:attempts}};
}

function restoreRecipeDiagrams(source, compacted) {
  const proposals = recipeDiagramGroups(source);
  if (!proposals.length) return compacted;
  const byId = new Map(source.bricks.map(brick => [brick.id, brick]));
  const sourceById = new Map(source.steps.map(step => [step.id, step]));
  let steps = [...compacted.plan.steps];
  const attempts = [];
  for (const proposal of proposals) {
    const wanted = new Set(proposal.brickIds);
    const indexes = steps.flatMap((step, index) => step.newBrickIds.some(id => wanted.has(id)) ? [index] : []);
    if (indexes.length < 2) continue;
    const first = indexes[0], last = indexes.at(-1), run = steps.slice(first, last+1);
    const operations = run.flatMap(step => step.sourceStepIds.map(id => sourceById.get(id)));
    const ids = operations.flatMap(step => step.newBrickIds);
    const scope = step => JSON.stringify(nestedRecipeScopes(step));
    if (ids.length !== wanted.size || ids.some(id => !wanted.has(id))
      || operations.some(step => step.moduleId !== proposal.moduleId || scope(step) !== scope(operations[0]))) continue;
    // Placement groups preserve physical ordering. A complete local diagram may
    // span them, but no other geometric, semantic or insertion boundary is waived.
    const oriented=operations.some(step=>step.workingOrientation);
    const reasons = oriented ? orientedCourseRejections(operations,byId,{feature:proposal.kind==='supported-feature',allowMixedMaterials:proposal.allowMixedMaterials})
      : staticRejectionReasons(operations, byId, source.modules.find(m => m.id === proposal.moduleId))
        .filter(reason => reason !== 'placement-group-boundary');
    if (!reasons.length && !oriented) {
      const view = visibilityResult(operations, byId);
      if (!view.passes || view.truncated) reasons.push('visibility');
    }
    attempts.push({brickIds:proposal.brickIds, merged:!reasons.length, reasons});
    if (reasons.length) continue;
    const merged = compactedStep(operations, 0);
    steps.splice(first, run.length, {...merged, id:run[0].id,
      ...(oriented&&proposal.kind==='supported-feature'?{workingFeature:true}:{})});
  }
  if (!attempts.some(attempt => attempt.merged)) return {...compacted, report:{...compacted.report, recipeDiagrams:attempts}};
  return {
    plan:{...compacted.plan, steps, stats:{...compacted.plan.stats, stepCount:steps.length,
      maxBricksPerStep:Math.max(0,...steps.map(step=>step.newBrickIds.length)), planReferenceCount:countReferences(steps)}},
    report:{...compacted.report, instructionDiagramCount:steps.length,
      mergedDiagramCount:steps.filter(step=>step.sourceStepIds.length>1).length,
      collapsedStepCount:source.steps.length-steps.length, recipeDiagrams:attempts},
  };
}
