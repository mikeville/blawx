const DEFAULT_AZIMUTH = Math.PI * 0.75;
const DEFAULT_ELEVATION = Math.atan(1 / Math.sqrt(2));
const DEFAULT_MAX_RAY_TESTS = 250_000;
const SAMPLES_PER_BRICK = 9;

const DEFAULT_SCALE = Object.freeze({
  studsPerVoxel: 1,
  coursesPerVoxel: 5 / 6,
  voxelMm: 8,
});

function bodyBox(brick, scale) {
  const width = (brick.w * 8 - 0.2) / scale.voxelMm;
  const height = (9.6 - 0.08) / scale.voxelMm;
  const depth = (brick.d * 8 - 0.2) / scale.voxelMm;
  const center = {
    x: (brick.x + brick.w / 2) / scale.studsPerVoxel,
    y: (brick.y + 0.5) / scale.coursesPerVoxel,
    z: (brick.z + brick.d / 2) / scale.studsPerVoxel,
  };
  return {
    id: brick.id,
    min: { x: center.x - width / 2, y: center.y - height / 2, z: center.z - depth / 2 },
    max: { x: center.x + width / 2, y: center.y + height / 2, z: center.z + depth / 2 },
  };
}

function bodyVisibilitySamples(box) {
  const samples = [{
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
    weight: 4,
  }];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) samples.push({ x, y, z, weight: 1 });
    }
  }
  return samples;
}

function rayHitsBox(origin, direction, box) {
  let near = -Infinity;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return false;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (box.min[axis] - origin[axis]) * inverse;
    let second = (box.max[axis] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return far > 1e-5;
}

function roundRobin(groups, limit) {
  const selected = [];
  let index = 0;
  while (selected.length < limit) {
    let added = false;
    for (const group of groups) {
      if (group.boxes[index]) {
        selected.push({ group, box: group.boxes[index] });
        added = true;
        if (selected.length === limit) return selected;
      }
    }
    if (!added) return selected;
    index += 1;
  }
  return selected;
}

function validateScale(scale) {
  for (const key of ['studsPerVoxel', 'coursesPerVoxel', 'voxelMm']) {
    if (!Number.isFinite(scale[key]) || scale[key] <= 0) throw new RangeError(`${key} must be positive.`);
  }
}

/**
 * Checks whether every source operation contributes visible highlighted geometry
 * in the ordinary instruction camera. This is a bounded presentation heuristic,
 * not a claim that the represented attachment is physically possible.
 */
export function evaluateInstructionVisibility({
  visibleBricks,
  highlightGroups,
  azimuth = DEFAULT_AZIMUTH,
  elevation = DEFAULT_ELEVATION,
  maxRayTests = DEFAULT_MAX_RAY_TESTS,
  scale = DEFAULT_SCALE,
}) {
  if (!Array.isArray(visibleBricks) || !Array.isArray(highlightGroups)) {
    throw new TypeError('visibleBricks and highlightGroups must be arrays.');
  }
  if (!Number.isFinite(azimuth) || !Number.isFinite(elevation)) throw new TypeError('Camera angles must be finite.');
  if (!Number.isInteger(maxRayTests) || maxRayTests < 0) throw new RangeError('maxRayTests must be a nonnegative integer.');
  validateScale(scale);

  const visibleIds = new Set();
  const boxes = visibleBricks.map((brick) => {
    if (typeof brick?.id !== 'string' || visibleIds.has(brick.id)) {
      throw new RangeError('Visible brick IDs must be unique strings.');
    }
    visibleIds.add(brick.id);
    return bodyBox(brick, scale);
  });
  const boxesById = new Map(boxes.map((box) => [box.id, box]));
  const groupIds = new Set();
  const highlightedIds = new Set();
  const groups = highlightGroups.map((group) => {
    if (typeof group?.id !== 'string' || groupIds.has(group.id) || !Array.isArray(group.bricks)) {
      throw new RangeError('Highlight groups require unique string IDs and brick arrays.');
    }
    groupIds.add(group.id);
    const eligible = [];
    let missingBrickCount = 0;
    for (const brick of group.bricks) {
      if (typeof brick?.id !== 'string' || highlightedIds.has(brick.id)) {
        throw new RangeError('Highlighted brick IDs must be unique strings across groups.');
      }
      highlightedIds.add(brick.id);
      const box = boxesById.get(brick.id);
      if (box) eligible.push(box);
      else missingBrickCount += 1;
    }
    return {
      id: group.id,
      totalBrickCount: group.bricks.length,
      eligibleBrickCount: eligible.length,
      missingBrickCount,
      testedBrickCount: 0,
      visibleBrickCount: 0,
      visibleSampleWeight: 0,
      boxes: eligible,
    };
  });

  const testsPerBrick = SAMPLES_PER_BRICK * Math.max(0, boxes.length - 1);
  const brickBudget = testsPerBrick === 0
    ? highlightedIds.size
    : Math.floor(maxRayTests / testsPerBrick);
  const eligibleCount = groups.reduce((sum, group) => sum + group.eligibleBrickCount, 0);
  const coversEveryGroup = groups.every((group) => group.eligibleBrickCount > 0)
    && brickBudget >= groups.length;
  const selected = coversEveryGroup ? roundRobin(groups, Math.min(brickBudget, eligibleCount)) : [];
  const horizontal = Math.cos(elevation);
  const direction = {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(elevation),
    z: Math.cos(azimuth) * horizontal,
  };
  let rayTests = 0;

  for (const { group, box } of selected) {
    group.testedBrickCount += 1;
    let visibleWeight = 0;
    for (const point of bodyVisibilitySamples(box)) {
      const origin = {
        x: point.x + direction.x * 1e-4,
        y: point.y + direction.y * 1e-4,
        z: point.z + direction.z * 1e-4,
      };
      let hidden = false;
      for (const candidate of boxes) {
        if (candidate === box) continue;
        rayTests += 1;
        if (rayHitsBox(origin, direction, candidate)) {
          hidden = true;
          break;
        }
      }
      if (!hidden) visibleWeight += point.weight;
    }
    if (visibleWeight > 0) group.visibleBrickCount += 1;
    group.visibleSampleWeight += visibleWeight;
  }

  const reports = groups.map(({ boxes: unused, ...group }) => group);
  const truncated = selected.length < eligibleCount;
  const passes = coversEveryGroup
    && reports.every((group) => group.missingBrickCount === 0 && group.visibleBrickCount > 0);
  return {
    passes,
    truncated,
    azimuth,
    elevation,
    rayTests,
    eligibleHighlightBrickCount: eligibleCount,
    testedHighlightBrickCount: selected.length,
    visibleHighlightBrickCount: reports.reduce((sum, group) => sum + group.visibleBrickCount, 0),
    groups: reports,
  };
}
