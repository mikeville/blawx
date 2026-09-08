import { FOOTPRINTS, PALETTE } from './geometry.js';
import { createAssemblyPlan } from './assembly.js';
import { validateVoxels } from './voxels.js';

const MAX_EXPANDED_CELLS = 1_500_000;
const MAX_BRICKS = 200_000;
const MAX_COLLISION_PAIR_VISITS = 200_000;
const INSPECTION_COORDINATE_LIMIT = 10_000;
const COMPACT_SCALE = Object.freeze({ mode: 'compact', studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 });
const COLORS = Object.freeze(Object.keys(PALETTE));
const COLOR_INDEX = new Map(COLORS.map((color, index) => [color, index + 1]));
const FOOTPRINT_KEYS = new Set(FOOTPRINTS.map(({ w, d }) => `${w}x${d}`));
const CONVERSION_FOOTPRINT_KEYS = new Set(['1x1', '1x2', '2x1', '1x3', '3x1', '1x4', '4x1', '2x2', '2x3', '3x2', '2x4', '4x2']);
const CONVERSION_FOOTPRINTS = Object.freeze(FOOTPRINTS.filter(({ w, d }) => CONVERSION_FOOTPRINT_KEYS.has(`${w}x${d}`)));
const MAX_ADJUSTMENT_TRIALS = 96;
const MAX_ASSEMBLY_FEEDBACK_EVALUATIONS = 24;
const PACKING_VARIANTS = Object.freeze([
  Object.freeze({ name: 'column-major', scanOrder: 'columns', orientationPhase: 0 }),
  Object.freeze({ name: 'flipped-bond', scanOrder: 'rows', orientationPhase: 1 }),
  Object.freeze({ name: 'column-major-flipped', scanOrder: 'columns', orientationPhase: 1 }),
]);

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function cellKey(x, y, z) {
  return x + z * 64 + y * 4096;
}

class DisjointSet {
  constructor(size) {
    this.parent = Int32Array.from({ length: size }, (_, index) => index);
    this.rank = new Uint8Array(size);
  }

  find(value) {
    let root = value;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[value] !== value) {
      const next = this.parent[value];
      this.parent[value] = root;
      value = next;
    }
    return root;
  }

  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return false;
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA] += 1;
    return true;
  }
}

class LowerBridgeTracker {
  constructor() {
    this.parent = new Map();
  }

  find(value) {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      this.parent.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  benefit(owners) {
    return Math.max(0, new Set([...owners].map((owner) => this.find(owner))).size - 1);
  }

  connect(owners) {
    const values = [...owners];
    if (values.length < 2) return;
    const root = this.find(values[0]);
    for (let index = 1; index < values.length; index += 1) this.parent.set(this.find(values[index]), root);
  }
}

function candidateScore({ w, d }, x, z, y, width, lowerOwners, bridgeTracker, orientationPhase) {
  const area = w * d;
  const short = Math.min(w, d);
  const long = Math.max(w, d);
  const partPreference = short === 2 && long === 4 ? 12_000
    : short === 2 && long === 2 ? 10_000
      : short === 2 && long === 3 ? 8_000
        : short === 1 && long === 4 ? 7_000
          : short === 1 && long === 3 ? 5_000
            : short === 1 && long === 2 ? 4_000 : 2_000;
  const orientationBias = w === d || area < 6 ? 0 : ((y + orientationPhase) % 2 === 0 ? w > d : d > w) ? 1_000 : -4_000;
  if (!lowerOwners) return partPreference + orientationBias + area * 10;
  const lower = new Set();
  let supported = 0;
  for (let dz = 0; dz < d; dz += 1) for (let dx = 0; dx < w; dx += 1) {
    const owner = lowerOwners[(z + dz) * width + x + dx];
    if (owner) {
      supported += 1;
      lower.add(owner);
    }
  }
  let alignedLowerSeams = 0;
  if (x + w < width) for (let dz = 0; dz < d; dz += 1) {
    const inside = lowerOwners[(z + dz) * width + x + w - 1];
    const outside = lowerOwners[(z + dz) * width + x + w];
    if (inside && outside && inside !== outside) alignedLowerSeams += 1;
  }
  const depth = lowerOwners.length / width;
  if (z + d < depth) for (let dx = 0; dx < w; dx += 1) {
    const inside = lowerOwners[(z + d - 1) * width + x + dx];
    const outside = lowerOwners[(z + d) * width + x + dx];
    if (inside && outside && inside !== outside) alignedLowerSeams += 1;
  }
  return partPreference + orientationBias + area * 10 + Math.max(0, lower.size - 1) * 160
    + bridgeTracker.benefit(lower) * 15_000 + supported * 4 - alignedLowerSeams * (y % 2 === 1 ? 1_500 : 0);
}

function mappedLayers(cells) {
  const layers = new Map();
  let mappedCellCount = 0;
  for (const cell of cells) {
    const startY = Math.round(cell.y * 5 / 6);
    const endY = Math.round((cell.y + 1) * 5 / 6);
    for (let y = startY; y < endY; y += 1) {
      if (!layers.has(y)) layers.set(y, []);
      layers.get(y).push(cell);
      mappedCellCount += 1;
    }
  }
  for (const layer of layers.values()) layer.sort((a, b) => a.z - b.z || a.x - b.x || a.color.localeCompare(b.color));
  return { layers, mappedCellCount };
}

function packCells(cells, { scanOrder = 'rows', orientationPhase = 0 } = {}) {
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  for (const cell of cells) {
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
    maxZ = Math.max(maxZ, cell.z);
  }
  const mapped = mappedLayers(cells);

  const width = maxX + 1;
  const depth = maxZ + 1;
  const planeSize = width * depth;
  const bricks = [];
  let lowerOwners = null;
  const lastCourse = Math.round((maxY + 1) * 5 / 6);

  for (let y = 0; y < lastCourse; y += 1) {
    const rawLayer = mapped.layers.get(y) ?? [];
    const colors = new Uint8Array(planeSize);
    for (const cell of rawLayer) {
      const color = COLOR_INDEX.get(cell.color);
      colors[cell.z * width + cell.x] = color;
    }

    const consumed = new Uint8Array(planeSize);
    const owners = new Int32Array(planeSize);
    const bridgeTracker = lowerOwners ? new LowerBridgeTracker() : null;
    const anchors = [];
    if (scanOrder === 'columns') {
      for (let x = 0; x < width; x += 1) for (let z = 0; z < depth; z += 1) anchors.push([x, z]);
    } else {
      for (let z = 0; z < depth; z += 1) for (let x = 0; x < width; x += 1) anchors.push([x, z]);
    }
    for (const [x, z] of anchors) {
      const anchorOffset = z * width + x;
      const color = colors[anchorOffset];
      if (!color || consumed[anchorOffset]) continue;
      let best = null;
      for (const footprint of CONVERSION_FOOTPRINTS) {
          const originX = x;
          const originZ = z;
          if (originX < 0 || originZ < 0 || originX + footprint.w > width || originZ + footprint.d > depth) continue;
          let fits = true;
          for (let dz = 0; dz < footprint.d && fits; dz += 1) for (let dx = 0; dx < footprint.w; dx += 1) {
            const offset = (originZ + dz) * width + originX + dx;
            if (colors[offset] !== color || consumed[offset]) { fits = false; break; }
          }
          if (!fits) continue;
          const score = candidateScore(footprint, originX, originZ, y, width, lowerOwners, bridgeTracker, orientationPhase);
          if (!best || score > best.score
            || score === best.score && (originZ < best.z || originZ === best.z && originX < best.x)
            || score === best.score && originZ === best.z && originX === best.x && (footprint.d < best.d || footprint.d === best.d && footprint.w < best.w)) {
            best = { x: originX, z: originZ, w: footprint.w, d: footprint.d, score };
          }
      }
      if (!best) throw new Error('Internal packing failure: legal 1x1 footprint was not found.');
      const brickIndex = bricks.length;
      bricks.push({ x: best.x, y, z: best.z, w: best.w, d: best.d, color: COLORS[color - 1] });
      if (bricks.length > MAX_BRICKS) throw new RangeError(`Packed model exceeds the ${MAX_BRICKS}-brick limit.`);
      for (let dz = 0; dz < best.d; dz += 1) for (let dx = 0; dx < best.w; dx += 1) {
        const offset = (best.z + dz) * width + best.x + dx;
        consumed[offset] = 1;
        owners[offset] = brickIndex + 1;
      }
      if (bridgeTracker) {
        const lower = new Set();
        for (let dz = 0; dz < best.d; dz += 1) for (let dx = 0; dx < best.w; dx += 1) {
          const owner = lowerOwners[(best.z + dz) * width + best.x + dx];
          if (owner) lower.add(owner);
        }
        bridgeTracker.connect(lower);
      }
    }
    lowerOwners = owners;
  }
  return { bricks, mappedCellCount: mapped.mappedCellCount };
}

function studKey(x, y, z) {
  return `${x},${y},${z}`;
}

function buildStudGraph(bricks) {
  const occupancy = new Map();
  for (let index = 0; index < bricks.length; index += 1) {
    const brick = bricks[index];
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      occupancy.set(studKey(brick.x + dx, brick.y, brick.z + dz), index);
    }
  }

  const dsu = new DisjointSet(bricks.length);
  const unsupported = new Set();
  for (let index = 0; index < bricks.length; index += 1) {
    const brick = bricks[index];
    let hasSupport = brick.y === 0;
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const below = occupancy.get(studKey(brick.x + dx, brick.y - 1, brick.z + dz));
      if (below !== undefined) {
        hasSupport = true;
        dsu.union(index, below);
      }
    }
    if (!hasSupport) unsupported.add(index);
  }

  const roots = Int32Array.from({ length: bricks.length }, (_, index) => dsu.find(index));
  const groundedRoots = new Set();
  for (let index = 0; index < bricks.length; index += 1) if (bricks[index].y === 0) groundedRoots.add(roots[index]);
  return { occupancy, roots, groundedRoots, unsupported };
}

function candidateContactProfile(candidate, bricks, graph) {
  const roots = new Set();
  const unsupportedTargets = new Set();
  let reachesGround = false;
  let occupied = false;
  let sideColorContact = false;
  const mapped = mappedLayers([candidate]);
  for (const [y] of mapped.layers) {
    reachesGround ||= y === 0;
    const same = graph.occupancy.get(studKey(candidate.x, y, candidate.z));
    occupied ||= same !== undefined;
    for (const neighborY of [y - 1, y + 1]) {
      const owner = graph.occupancy.get(studKey(candidate.x, neighborY, candidate.z));
      if (owner === undefined) continue;
      roots.add(graph.roots[owner]);
      if (neighborY === y + 1 && graph.unsupported.has(owner)) unsupportedTargets.add(owner);
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const owner = graph.occupancy.get(studKey(candidate.x + dx, y, candidate.z + dz));
      if (owner !== undefined && bricks[owner].color === candidate.color) {
        roots.add(graph.roots[owner]);
        sideColorContact = true;
      }
    }
  }
  const groundedRootCount = [...roots].filter((root) => graph.groundedRoots.has(root)).length;
  const groundlessRootCount = roots.size - groundedRootCount;
  return {
    occupied,
    mappedCellCount: mapped.mappedCellCount,
    roots,
    reachesGround,
    groundedRootCount,
    groundlessRootCount,
    unsupportedTargetCount: unsupportedTargets.size,
    sideColorContact,
  };
}

function adjustmentCandidates(cells, originalBounds, bricks, attempted) {
  const byKey = new Set(cells.map((cell) => cellKey(cell.x, cell.y, cell.z)));
  const graph = buildStudGraph(bricks);
  const candidates = new Map();
  for (const source of cells) for (const [dx, dy, dz] of [
    [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1],
  ]) {
    const x = source.x + dx;
    const y = source.y + dy;
    const z = source.z + dz;
    if (x < originalBounds.minX || x > originalBounds.maxX || y < originalBounds.minY || y > originalBounds.maxY
      || z < originalBounds.minZ || z > originalBounds.maxZ || byKey.has(cellKey(x, y, z))) continue;
    const candidate = { x, y, z, color: source.color };
    const identity = `${x},${y},${z},${source.color}`;
    if (attempted.has(identity) || candidates.has(identity)) continue;
    const profile = candidateContactProfile(candidate, bricks, graph);
    if (profile.occupied || profile.mappedCellCount === 0 || profile.roots.size === 0) continue;
    const connectsGroundless = profile.groundlessRootCount > 0
      && (profile.groundedRootCount > 0 || profile.roots.size > 1);
    const supportsDeficit = profile.unsupportedTargetCount > 0
      && (profile.groundedRootCount > 0 || profile.roots.size > 1 || profile.sideColorContact);
    if (!connectsGroundless && !supportsDeficit) continue;
    if (profile.roots.size > 1 && profile.groundlessRootCount === 0) continue;
    const priority = profile.groundlessRootCount * 10_000 + profile.groundedRootCount * 2_000
      + profile.unsupportedTargetCount * 500 + profile.roots.size * 100 + (profile.reachesGround ? 50 : 0);
    const reason = connectsGroundless
      ? `Local ${profile.groundedRootCount ? 'grounded-to-groundless' : 'groundless-to-groundless'} stud connection candidate.`
      : 'Local support extension below an unsupported brick.';
    candidates.set(identity, { ...candidate, identity, priority, reason });
  }
  return [...candidates.values()].sort((a, b) => b.priority - a.priority
    || a.y - b.y || a.z - b.z || a.x - b.x || a.color.localeCompare(b.color));
}

function structuralSnapshot(diagnostics) {
  const stats = diagnostics.stats;
  return {
    groundlessComponentCount: stats.groundlessComponentCount,
    componentCount: stats.componentCount,
    unsupportedBrickCount: stats.unsupportedBrickCount,
    weakSupportBrickCount: stats.weakSupportBrickCount,
    bridgingBrickCount: stats.bridgingBrickCount,
  };
}

function improves(actual, baseline, { allowBridgingOnly = true } = {}) {
  const a = structuralSnapshot(actual);
  const b = structuralSnapshot(baseline);
  const noCoreRegression = a.groundlessComponentCount <= b.groundlessComponentCount
    && a.componentCount <= b.componentCount
    && a.unsupportedBrickCount <= b.unsupportedBrickCount
    && a.weakSupportBrickCount <= b.weakSupportBrickCount;
  if (!noCoreRegression) return false;
  const fixesDeficit = a.groundlessComponentCount < b.groundlessComponentCount
    || a.componentCount < b.componentCount
    || a.unsupportedBrickCount < b.unsupportedBrickCount
    || a.weakSupportBrickCount < b.weakSupportBrickCount;
  return fixesDeficit || allowBridgingOnly && a.bridgingBrickCount > b.bridgingBrickCount;
}

function assemblyFeedbackStats(plan) {
  return {
    rootFailureCount: plan.stats.rootFailureCount,
    unresolvedBrickCount: plan.stats.unresolvedBrickCount,
    brickCount: plan.stats.brickCount,
    blockedJoinCount: plan.stats.blockedJoinCount,
  };
}

function assemblyDoesNotWorsen(candidate, accepted) {
  return candidate.rootFailureCount <= accepted.rootFailureCount
    && candidate.blockedJoinCount <= accepted.blockedJoinCount
    && candidate.unresolvedBrickCount * accepted.brickCount <= accepted.unresolvedBrickCount * candidate.brickCount;
}

function createPlanFor(bricks, rawModel, sourceProgram) {
  return createAssemblyPlan({
    brickModel: { version: 1, kind: 'bricks', bricks },
    rawModel,
    sourceProgram,
  });
}

function compactDifference(originalCells, mappedCells) {
  const originalTicks = new Map();
  const mappedTicks = new Map();
  for (const cell of originalCells) for (let tick = cell.y * 5; tick < (cell.y + 1) * 5; tick += 1) {
    originalTicks.set(cell.x + cell.z * 64 + tick * 4096, cell.color);
  }
  const { layers } = mappedLayers(mappedCells);
  for (const [course, cells] of layers) for (const cell of cells) for (let tick = course * 6; tick < (course + 1) * 6; tick += 1) {
    mappedTicks.set(cell.x + cell.z * 64 + tick * 4096, cell.color);
  }
  let addedTicks = 0;
  let removedTicks = 0;
  let recoloredTicks = 0;
  for (const [key, color] of originalTicks) {
    const mappedColor = mappedTicks.get(key);
    if (mappedColor === undefined) removedTicks += 1;
    else if (mappedColor !== color) recoloredTicks += 1;
  }
  for (const key of mappedTicks.keys()) if (!originalTicks.has(key)) addedTicks += 1;
  return {
    addedVolumeVoxelEquivalent: addedTicks / 5,
    removedVolumeVoxelEquivalent: removedTicks / 5,
    recoloredVolumeVoxelEquivalent: recoloredTicks / 5,
  };
}

function inspectionResult(errors, warnings, stats, schemaValid, assessed = true) {
  const checks = {
    schema: schemaValid,
    legalFootprints: stats.illegalFootprintCount === 0,
    noCollisions: assessed ? stats.collisionPairCount === 0 : null,
    allComponentsGrounded: assessed ? stats.componentCount === stats.groundedComponentCount : null,
    directSupport: assessed ? stats.unsupportedBrickCount === 0 : null,
    exactPartColorCatalog: false,
    physicalStability: false,
    assemblySequence: false,
  };
  return { valid: assessed && checks.schema && checks.legalFootprints && checks.noCollisions && checks.allComponentsGrounded, errors, warnings, stats, checks };
}

export function inspectConstruction(brickModel) {
  const errors = [];
  const warnings = [];
  const bricks = Array.isArray(brickModel?.bricks) ? brickModel.bricks : [];
  if (!brickModel || typeof brickModel !== 'object' || Array.isArray(brickModel)) errors.push('Brick model must be an object.');
  if (brickModel?.version !== 1) errors.push('Brick model version must be 1.');
  if (brickModel?.kind !== 'bricks') errors.push('Brick model kind must be "bricks".');
  if (!Array.isArray(brickModel?.bricks)) errors.push('Brick model bricks must be an array.');
  if (Array.isArray(brickModel?.bricks) && brickModel.bricks.length === 0) errors.push('Brick model bricks must not be empty.');
  if (bricks.length > MAX_BRICKS) errors.push(`Brick model exceeds the ${MAX_BRICKS}-brick inspection limit.`);
  if (brickModel?.meta != null && (typeof brickModel.meta !== 'object' || Array.isArray(brickModel.meta))) errors.push('Brick model meta must be an object when provided.');

  let illegalFootprintCount = 0;
  let totalFootprintCells = 0;
  const usable = [];
  if (bricks.length <= MAX_BRICKS) bricks.forEach((brick, index) => {
    if (!brick || typeof brick !== 'object' || Array.isArray(brick)) {
      errors.push(`Brick ${index} must be an object.`);
      return;
    }
    const badFields = ['x', 'y', 'z', 'w', 'd'].filter((field) => !Number.isSafeInteger(brick[field]));
    if (badFields.length) errors.push(`Brick ${index} fields must be safe integers: ${badFields.join(', ')}.`);
    if (Number.isSafeInteger(brick.y) && brick.y < 0) errors.push(`Brick ${index} y must be nonnegative.`);
    if (Number.isSafeInteger(brick.w) && Number.isSafeInteger(brick.d) && !FOOTPRINT_KEYS.has(`${brick.w}x${brick.d}`)) {
      illegalFootprintCount += 1;
      errors.push(`Brick ${index} uses illegal footprint ${brick.w}x${brick.d}.`);
    }
    if (!Object.hasOwn(PALETTE, brick.color)) errors.push(`Brick ${index} uses unknown color ${String(brick.color)}.`);
    if (!badFields.length && (Math.abs(brick.x) > INSPECTION_COORDINATE_LIMIT || Math.abs(brick.z) > INSPECTION_COORDINATE_LIMIT
      || brick.y > INSPECTION_COORDINATE_LIMIT || brick.x + brick.w > INSPECTION_COORDINATE_LIMIT || brick.z + brick.d > INSPECTION_COORDINATE_LIMIT)) {
      errors.push(`Brick ${index} coordinates exceed inspection bounds.`);
    }
    if (!badFields.length && FOOTPRINT_KEYS.has(`${brick.w}x${brick.d}`)) totalFootprintCells += brick.w * brick.d;
    if (!badFields.length && brick.y >= 0 && FOOTPRINT_KEYS.has(`${brick.w}x${brick.d}`) && Object.hasOwn(PALETTE, brick.color)
      && Math.abs(brick.x) <= INSPECTION_COORDINATE_LIMIT && Math.abs(brick.z) <= INSPECTION_COORDINATE_LIMIT
      && brick.y <= INSPECTION_COORDINATE_LIMIT && brick.x + brick.w <= INSPECTION_COORDINATE_LIMIT && brick.z + brick.d <= INSPECTION_COORDINATE_LIMIT) usable.push({ ...brick, index });
  });
  if (totalFootprintCells > MAX_EXPANDED_CELLS) errors.push(`Brick footprint expansion exceeds the ${MAX_EXPANDED_CELLS}-cell inspection limit.`);
  const schemaValid = errors.length === 0;
  if (!schemaValid) {
    warnings.push('Occupancy, collision, support, and connectivity checks were not assessed because schema or safety validation failed.');
    return inspectionResult(errors, warnings, {
      brickCount: bricks.length,
      illegalFootprintCount,
      collisionPairCount: null,
      collisionCountTruncated: false,
      studConnectionCount: null,
      studEngagedBrickCount: null,
      sideTouchPairCount: null,
      componentCount: null,
      groundedComponentCount: null,
      groundlessComponentCount: null,
      unsupportedBrickCount: null,
      weakSupportBrickCount: null,
      bridgingBrickCount: null,
    }, false, false);
  }

  const layers = new Map();
  for (const brick of usable) {
    if (!layers.has(brick.y)) layers.set(brick.y, new Map());
    const grid = layers.get(brick.y);
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const key = (brick.x + dx + INSPECTION_COORDINATE_LIMIT) * 20_001 + brick.z + dz + INSPECTION_COORDINATE_LIMIT;
      const owners = grid.get(key);
      if (owners) owners.push(brick.index);
      else grid.set(key, [brick.index]);
    }
  }

  const collisionPairs = new Set();
  let collisionCountLowerBound = 0;
  let collisionPairVisits = 0;
  let collisionCountTruncated = false;
  for (const grid of layers.values()) for (const owners of grid.values()) {
    const localPairs = owners.length * (owners.length - 1) / 2;
    collisionCountLowerBound = Math.max(collisionCountLowerBound, localPairs);
    if (collisionPairVisits + localPairs > MAX_COLLISION_PAIR_VISITS) {
      collisionCountTruncated = true;
      continue;
    }
    collisionPairVisits += localPairs;
    for (let a = 0; a < owners.length; a += 1) for (let b = a + 1; b < owners.length; b += 1) {
      const low = Math.min(owners[a], owners[b]);
      const high = Math.max(owners[a], owners[b]);
      collisionPairs.add(low * MAX_BRICKS + high);
    }
  }
  const collisionPairCount = Math.max(collisionPairs.size, collisionCountLowerBound);
  if (collisionPairCount) errors.push(`${collisionPairCount}${collisionCountTruncated ? ' or more' : ''} brick pair(s) collide.`);
  if (collisionCountTruncated) warnings.push(`Exact collision-pair counting stopped at the ${MAX_COLLISION_PAIR_VISITS}-visit safety limit.`);
  if (collisionCountTruncated) {
    warnings.push('Support, side-touch, and connectivity checks were not assessed after collision work exceeded its safety limit.');
    return {
      valid: false,
      errors,
      warnings,
      stats: {
        brickCount: bricks.length,
        illegalFootprintCount,
        collisionPairCount,
        collisionCountTruncated,
        studConnectionCount: null,
        studEngagedBrickCount: null,
        sideTouchPairCount: null,
        componentCount: null,
        groundedComponentCount: null,
        groundlessComponentCount: null,
        unsupportedBrickCount: null,
        weakSupportBrickCount: null,
        bridgingBrickCount: null,
      },
      checks: {
        schema: true,
        legalFootprints: true,
        noCollisions: false,
        allComponentsGrounded: null,
        directSupport: null,
        exactPartColorCatalog: false,
        physicalStability: false,
        assemblySequence: false,
      },
    };
  }

  const dsu = new DisjointSet(usable.length);
  const usablePosition = new Map(usable.map((brick, index) => [brick.index, index]));
  const contactPairs = new Set();
  const sidePairs = new Set();
  let unsupportedBrickCount = 0;
  let weakSupportBrickCount = 0;
  let bridgingBrickCount = 0;
  let studEngagedBrickCount = 0;

  for (const brick of usable) {
    const below = layers.get(brick.y - 1);
    const contacts = new Map();
    if (below) for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const key = (brick.x + dx + INSPECTION_COORDINATE_LIMIT) * 20_001 + brick.z + dz + INSPECTION_COORDINATE_LIMIT;
      for (const lower of below.get(key) ?? []) contacts.set(lower, (contacts.get(lower) ?? 0) + 1);
    }
    if (brick.y > 0) {
      const area = [...contacts.values()].reduce((sum, value) => sum + value, 0);
      if (area === 0) unsupportedBrickCount += 1;
      else if (area / (brick.w * brick.d) < 0.25) weakSupportBrickCount += 1;
    }
    if (contacts.size) studEngagedBrickCount += 1;
    if (contacts.size >= 2) bridgingBrickCount += 1;
    for (const lower of contacts.keys()) {
      const low = Math.min(brick.index, lower);
      const high = Math.max(brick.index, lower);
      contactPairs.add(low * MAX_BRICKS + high);
      dsu.union(usablePosition.get(brick.index), usablePosition.get(lower));
    }

    const sameLayer = layers.get(brick.y);
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const x = brick.x + dx;
      const z = brick.z + dz;
      for (const [nx, nz] of [[x + 1, z], [x, z + 1]]) {
        const key = (nx + INSPECTION_COORDINATE_LIMIT) * 20_001 + nz + INSPECTION_COORDINATE_LIMIT;
        for (const neighbor of sameLayer.get(key) ?? []) if (neighbor !== brick.index) {
          const low = Math.min(brick.index, neighbor);
          const high = Math.max(brick.index, neighbor);
          sidePairs.add(low * MAX_BRICKS + high);
        }
      }
    }
  }

  const components = new Map();
  for (let position = 0; position < usable.length; position += 1) {
    const root = dsu.find(position);
    const state = components.get(root) ?? { grounded: false };
    state.grounded ||= usable[position].y === 0;
    components.set(root, state);
  }
  const groundedComponentCount = [...components.values()].filter(({ grounded }) => grounded).length;
  const groundlessComponentCount = components.size - groundedComponentCount;
  if (groundlessComponentCount) errors.push(`${groundlessComponentCount} stud-connected component(s) have no brick at ground course 0.`);
  if (unsupportedBrickCount) warnings.push(`${unsupportedBrickCount} elevated brick(s) have no direct stud support below.`);
  if (weakSupportBrickCount) warnings.push(`${weakSupportBrickCount} brick(s) have direct support under less than 25% of their footprint.`);
  warnings.push('Exact real-world part/color catalog availability has not been verified.');
  warnings.push('Stud connectivity and contact heuristics do not establish physical stability.');
  warnings.push('A complete legal assembly sequence has not been verified.');

  return inspectionResult(errors, warnings, {
    brickCount: bricks.length,
    illegalFootprintCount,
    collisionPairCount,
    collisionCountTruncated,
    studConnectionCount: contactPairs.size,
    studEngagedBrickCount,
    sideTouchPairCount: sidePairs.size,
    componentCount: components.size,
    groundedComponentCount,
    groundlessComponentCount,
    unsupportedBrickCount,
    weakSupportBrickCount,
    bridgingBrickCount,
  }, schemaValid);
}

export function convertToBricks(options = {}) {
  const started = now();
  const { rawModel, sourceProgram = null, adjustments = false, scaleMode } = options;
  if (typeof adjustments !== 'boolean') throw new TypeError('adjustments must be a boolean.');
  if (scaleMode != null && scaleMode !== 'compact') throw new TypeError('scaleMode is no longer supported; compact conversion is the only mode.');
  const validation = validateVoxels(rawModel);
  if (!validation.valid) throw new TypeError(`Invalid raw voxel model: ${validation.errors.join(' ')}`);
  const rawCellCount = validation.stats.cellCount;
  const initialMapping = mappedLayers(rawModel.cells);
  const expandedVolume = initialMapping.mappedCellCount;
  if (expandedVolume > MAX_EXPANDED_CELLS) throw new RangeError(`Expanded construction volume exceeds the ${MAX_EXPANDED_CELLS} stud-course-cell limit.`);
  if (expandedVolume === 0) throw new RangeError('Compact vertical resampling removed every source cell; raw geometry remains available.');

  const baselinePackStarted = now();
  let cells = rawModel.cells;
  let packed = packCells(cells);
  let bricks = packed.bricks;
  let mappedCellCount = packed.mappedCellCount;
  let packingMs = now() - baselinePackStarted;
  let diagnostics = inspectConstruction({ version: 1, kind: 'bricks', bricks });
  const adjustmentRecords = [];
  let packingStrategy = { name: 'baseline', scanOrder: 'rows', orientationPhase: 0 };
  const adjustmentSearch = {
    budget: Math.min(32, Math.floor(rawCellCount * 0.01)),
    candidateCount: 0,
    trialCount: 0,
    acceptedCount: 0,
    packingVariantsTried: 0,
    packingRetiled: false,
    before: structuralSnapshot(diagnostics),
    after: null,
  };
  let assemblyPlan = null;
  let assemblyFeedback = null;

  if (adjustments) {
    const adjustmentStarted = now();
    assemblyFeedback = {
      baseline: null,
      final: null,
      evaluations: 0,
      rejected: 0,
      regressionRejections: 0,
      plannerErrorRejections: 0,
      limit: MAX_ASSEMBLY_FEEDBACK_EVALUATIONS,
      limitReached: false,
      status: 'completed',
    };
    try {
      assemblyPlan = createPlanFor(bricks, rawModel, sourceProgram);
      assemblyFeedback.baseline = assemblyFeedbackStats(assemblyPlan);
      assemblyFeedback.final = { ...assemblyFeedback.baseline };
    } catch (error) {
      assemblyFeedback.status = 'baseline-planner-failed';
      assemblyFeedback.reason = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
    }

    const evaluateCandidatePlan = (candidateBricks) => {
      if (assemblyFeedback.evaluations >= assemblyFeedback.limit) {
        assemblyFeedback.limitReached = true;
        assemblyFeedback.status = 'limit-reached';
        assemblyFeedback.reason = `Stopped after ${assemblyFeedback.limit} graph-improving candidate assembly evaluations.`;
        return null;
      }
      assemblyFeedback.evaluations += 1;
      let candidatePlan;
      try {
        candidatePlan = createPlanFor(candidateBricks, rawModel, sourceProgram);
      } catch {
        assemblyFeedback.rejected += 1;
        assemblyFeedback.plannerErrorRejections += 1;
        return null;
      }
      const candidateStats = assemblyFeedbackStats(candidatePlan);
      if (!assemblyDoesNotWorsen(candidateStats, assemblyFeedback.final)) {
        assemblyFeedback.rejected += 1;
        assemblyFeedback.regressionRejections += 1;
        return null;
      }
      return candidatePlan;
    };

    if (assemblyPlan) {
      for (const variant of PACKING_VARIANTS) {
        const repackStarted = now();
        const variantPacked = packCells(cells, variant);
        packingMs += now() - repackStarted;
        adjustmentSearch.packingVariantsTried += 1;
        const variantDiagnostics = inspectConstruction({ version: 1, kind: 'bricks', bricks: variantPacked.bricks });
        if (!improves(variantDiagnostics, diagnostics)) continue;
        const variantPlan = evaluateCandidatePlan(variantPacked.bricks);
        if (!variantPlan) {
          if (assemblyFeedback.limitReached) break;
          continue;
        }
        bricks = variantPacked.bricks;
        mappedCellCount = variantPacked.mappedCellCount;
        diagnostics = variantDiagnostics;
        assemblyPlan = variantPlan;
        assemblyFeedback.final = assemblyFeedbackStats(assemblyPlan);
        packingStrategy = variant;
        adjustmentSearch.packingRetiled = true;
      }

      const originalBounds = rawModel.cells.reduce((bounds, cell) => ({
        minX: Math.min(bounds.minX, cell.x), maxX: Math.max(bounds.maxX, cell.x),
        minY: Math.min(bounds.minY, cell.y), maxY: Math.max(bounds.maxY, cell.y),
        minZ: Math.min(bounds.minZ, cell.z), maxZ: Math.max(bounds.maxZ, cell.z),
      }), { minX: 64, maxX: 0, minY: 64, maxY: 0, minZ: 64, maxZ: 0 });
      const attempted = new Set();
      while (!assemblyFeedback.limitReached && adjustmentRecords.length < adjustmentSearch.budget
        && adjustmentSearch.trialCount < MAX_ADJUSTMENT_TRIALS) {
        const candidates = adjustmentCandidates(cells, originalBounds, bricks, attempted);
        adjustmentSearch.candidateCount += candidates.length;
        let accepted = false;
        for (const candidate of candidates) {
          if (adjustmentSearch.trialCount >= MAX_ADJUSTMENT_TRIALS || assemblyFeedback.limitReached) break;
          attempted.add(candidate.identity);
          adjustmentSearch.trialCount += 1;
          const adjustedCells = [...cells, { x: candidate.x, y: candidate.y, z: candidate.z, color: candidate.color }];
          const adjustedVolume = mappedLayers(adjustedCells).mappedCellCount;
          if (adjustedVolume <= 0 || adjustedVolume > MAX_EXPANDED_CELLS) continue;
          const repackStarted = now();
          const adjustedPacked = packCells(adjustedCells, packingStrategy);
          packingMs += now() - repackStarted;
          const adjustedDiagnostics = inspectConstruction({ version: 1, kind: 'bricks', bricks: adjustedPacked.bricks });
          if (!improves(adjustedDiagnostics, diagnostics, { allowBridgingOnly: false })) continue;
          const adjustedPlan = evaluateCandidatePlan(adjustedPacked.bricks);
          if (!adjustedPlan) continue;
          const before = structuralSnapshot(diagnostics);
          const assemblyBefore = { ...assemblyFeedback.final };
          cells = adjustedCells;
          bricks = adjustedPacked.bricks;
          mappedCellCount = adjustedPacked.mappedCellCount;
          diagnostics = adjustedDiagnostics;
          assemblyPlan = adjustedPlan;
          assemblyFeedback.final = assemblyFeedbackStats(assemblyPlan);
          adjustmentRecords.push({
            type: 'add-voxel-assembly-support',
            cell: { x: candidate.x, y: candidate.y, z: candidate.z, color: candidate.color },
            addedStudCourseCells: mappedLayers([candidate]).mappedCellCount,
            reason: `${candidate.reason} Accepted only after both graph diagnostics and assembly feedback passed.`,
            before,
            after: structuralSnapshot(diagnostics),
            assemblyBefore,
            assemblyAfter: { ...assemblyFeedback.final },
          });
          accepted = true;
          break;
        }
        if (!accepted && !assemblyFeedback.limitReached) break;
      }
    }
    adjustmentSearch.acceptedCount = adjustmentRecords.length;
    diagnostics.adjustmentEvaluationMs = now() - adjustmentStarted;
  }
  adjustmentSearch.after = structuralSnapshot(diagnostics);

  const addedVoxelCount = cells.length - rawCellCount;
  const differences = compactDifference(rawModel.cells, cells);
  const baselineResampling = compactDifference(rawModel.cells, rawModel.cells);
  const conversionMs = now() - started;
  const metrics = {
    conversionMs,
    rawCellCount,
    brickCount: bricks.length,
    mappedCellCount,
    addedVolumeVoxelEquivalent: differences.addedVolumeVoxelEquivalent,
    removedVolumeVoxelEquivalent: differences.removedVolumeVoxelEquivalent,
    recoloredVolumeVoxelEquivalent: differences.recoloredVolumeVoxelEquivalent,
    relativeVolumeChange: (differences.addedVolumeVoxelEquivalent - differences.removedVolumeVoxelEquivalent) / rawCellCount,
    geometryDifferenceRatio: (differences.addedVolumeVoxelEquivalent + differences.removedVolumeVoxelEquivalent) / rawCellCount,
    colorDifferenceRatio: differences.recoloredVolumeVoxelEquivalent / rawCellCount,
    structuralAddedVoxelCount: addedVoxelCount,
    structuralAddedMappedCellCount: mappedCellCount - initialMapping.mappedCellCount,
    adjustmentSearch,
    assemblyFeedback,
    packingStrategy: packingStrategy.name,
    resampling: baselineResampling,
    scale: { ...COMPACT_SCALE },
    partHistogram: Object.fromEntries([...bricks.reduce((counts, brick) => {
      const key = `${Math.min(brick.w, brick.d)}x${Math.max(brick.w, brick.d)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map())].sort(([a], [b]) => a.localeCompare(b))),
    stageTiming: { packingMs, inspectionAndAdjustmentMs: Math.max(0, conversionMs - packingMs) },
  };
  const brickModel = {
    version: 1,
    kind: 'bricks',
    bricks,
    meta: {
      converter: 'deterministic-construction-v1',
      scale: { ...COMPACT_SCALE },
      sourceMeta: { ...(rawModel.meta ?? {}) },
      sourceProgramAvailable: sourceProgram != null,
      adjustmentsEnabled: adjustments,
      adjustmentGranularity: 'whole source voxels before scale mapping',
      allowedFootprints: [...CONVERSION_FOOTPRINT_KEYS],
    },
  };
  return { brickModel, diagnostics, metrics, adjustments: adjustmentRecords, ...(adjustments ? { assemblyPlan } : {}) };
}
