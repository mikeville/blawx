const LIMITS = Object.freeze({
  minCourses: 2,
  maxCourses: 4,
  minLayerFillRatio: 0.9,
  minCommonFootprintRatio: 0.9,
  maxHorizontalSpanStuds: 32,
  maxBandBricks: 120,
  maxOccupiedCells: 4096,
});

function cellKey(x, z) {
  return `${x},${z}`;
}

function validateBrick(brick, index, ids) {
  if (!brick || typeof brick !== 'object' || Array.isArray(brick)) throw new TypeError(`Brick ${index} must be an object.`);
  for (const field of ['x', 'y', 'z', 'w', 'd']) {
    if (!Number.isSafeInteger(brick[field])) throw new TypeError(`Brick ${index} ${field} must be a safe integer.`);
  }
  if (brick.y < 0 || brick.w <= 0 || brick.d <= 0) throw new RangeError(`Brick ${index} must have nonnegative y and positive dimensions.`);
  if (Object.hasOwn(brick, 'id')) {
    if (typeof brick.id !== 'string' || !brick.id || ids.has(brick.id)) throw new RangeError('Brick IDs must be unique nonempty strings.');
    ids.add(brick.id);
  }
}

function boundsFor(bricks) {
  if (!bricks.length) return null;
  const minX = Math.min(...bricks.map(({ x }) => x));
  const maxX = Math.max(...bricks.map(({ x, w }) => x + w));
  const minZ = Math.min(...bricks.map(({ z }) => z));
  const maxZ = Math.max(...bricks.map(({ z, d }) => z + d));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

function cellsFor(bricks, label) {
  const cells = new Set();
  for (const brick of bricks) for (let z = brick.z; z < brick.z + brick.d; z += 1) {
    for (let x = brick.x; x < brick.x + brick.w; x += 1) {
      const key = cellKey(x, z);
      if (cells.has(key)) throw new RangeError(`${label} contains overlapping brick footprints.`);
      cells.add(key);
    }
  }
  return cells;
}

function boundedGeometry(bricks, name) {
  if (bricks.length > LIMITS.maxBandBricks) throw new RangeError(`${name} exceeds the ${LIMITS.maxBandBricks}-brick band limit.`);
  const bounds = boundsFor(bricks);
  if (bounds && (bounds.width > LIMITS.maxHorizontalSpanStuds || bounds.depth > LIMITS.maxHorizontalSpanStuds)) {
    throw new RangeError(`${name} exceeds the ${LIMITS.maxHorizontalSpanStuds}-stud horizontal span limit.`);
  }
  const visits = bricks.reduce((sum, { w, d }) => sum + w * d, 0);
  if (!Number.isSafeInteger(visits) || visits > LIMITS.maxOccupiedCells) {
    throw new RangeError(`${name} exceeds the ${LIMITS.maxOccupiedCells}-cell band limit.`);
  }
  return bounds;
}

function layerRecord(course, bricks) {
  const bounds = boundsFor(bricks);
  const cells = cellsFor(bricks, `Course ${course}`);
  const boundingArea = bounds.width * bounds.depth;
  return {
    record: { course, area: cells.size, bounds, fillRatio: cells.size / boundingArea },
    cells,
  };
}

export function assessBandRegularity(bricks) {
  if (!Array.isArray(bricks)) throw new TypeError('bricks must be an array.');
  const ids = new Set();
  bricks.forEach((brick, index) => validateBrick(brick, index, ids));
  boundedGeometry(bricks, 'Band');

  const byCourse = new Map();
  for (const brick of bricks) {
    if (!byCourse.has(brick.y)) byCourse.set(brick.y, []);
    byCourse.get(brick.y).push(brick);
  }
  const courses = [...byCourse.keys()].sort((a, b) => a - b);
  const layerData = courses.map((course) => layerRecord(course, byCourse.get(course)));
  const layers = layerData.map(({ record }) => record);
  const minFillRatio = layers.length ? Math.min(...layers.map(({ fillRatio }) => fillRatio)) : 0;
  const union = new Set(layerData.flatMap(({ cells }) => [...cells]));
  const common = layerData.length ? new Set(layerData[0].cells) : new Set();
  for (const { cells } of layerData.slice(1)) {
    for (const key of common) if (!cells.has(key)) common.delete(key);
  }
  const commonFootprintRatio = union.size ? common.size / union.size : 0;
  const rejectionReasons = [];
  if (courses.length < LIMITS.minCourses || courses.length > LIMITS.maxCourses) {
    rejectionReasons.push(`Band must span ${LIMITS.minCourses}–${LIMITS.maxCourses} courses`);
  }
  if (courses.some((course, index) => index > 0 && course !== courses[index - 1] + 1)) {
    rejectionReasons.push('Band courses must be consecutive');
  }
  if (minFillRatio < LIMITS.minLayerFillRatio) {
    rejectionReasons.push(`A layer fills less than ${LIMITS.minLayerFillRatio} of its bounding rectangle`);
  }
  if (commonFootprintRatio < LIMITS.minCommonFootprintRatio) {
    rejectionReasons.push(`Common layer footprint is less than ${LIMITS.minCommonFootprintRatio}`);
  }
  return {
    eligible: rejectionReasons.length === 0,
    limits: { ...LIMITS },
    layers,
    minFillRatio,
    commonFootprintRatio,
    rejectionReasons,
  };
}

function validatePlan(plan, moduleId) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('plan must be an object.');
  if (!Array.isArray(plan.bricks) || !Array.isArray(plan.modules) || !Array.isArray(plan.steps)) {
    throw new TypeError('plan must contain bricks, modules, and steps arrays.');
  }
  if (typeof moduleId !== 'string' || !moduleId) throw new TypeError('moduleId must be a nonempty string.');
  const brickIds = new Set();
  const bricksById = new Map();
  plan.bricks.forEach((brick, index) => {
    validateBrick(brick, index, brickIds);
    if (!Object.hasOwn(brick, 'id')) throw new TypeError('Plan bricks must have IDs.');
    bricksById.set(brick.id, brick);
  });
  const moduleIds = new Set();
  const ownerByBrickId = new Map();
  let target = null;
  for (const module of plan.modules) {
    if (typeof module?.id !== 'string' || !module.id || moduleIds.has(module.id)) throw new RangeError('Plan module IDs must be unique nonempty strings.');
    moduleIds.add(module.id);
    if (!Array.isArray(module.brickIds) || new Set(module.brickIds).size !== module.brickIds.length) {
      throw new TypeError(`Plan module ${module.id} must have unique brickIds.`);
    }
    if (module.brickIds.some((id) => !bricksById.has(id))) throw new RangeError(`Plan module ${module.id} references an unknown brick.`);
    for (const id of module.brickIds) {
      if (ownerByBrickId.has(id)) throw new RangeError(`Plan brick ${id} belongs to multiple modules.`);
      ownerByBrickId.set(id, module.id);
    }
    if (module.id === moduleId) target = module;
  }
  if (!target) throw new RangeError(`Unknown module ${moduleId}.`);
  if (ownerByBrickId.size !== bricksById.size) throw new RangeError('Every plan brick must belong to exactly one module.');
  const targetBricks = target.brickIds.map((id) => bricksById.get(id));
  boundedGeometry(targetBricks, `Module ${moduleId}`);
  for (const course of new Set(targetBricks.map(({ y }) => y))) {
    cellsFor(targetBricks.filter((brick) => brick.y === course), `Module ${moduleId} course ${course}`);
  }

  const introduced = new Set();
  const stepIds = new Set();
  for (const step of plan.steps) {
    if (typeof step?.id !== 'string' || !step.id || stepIds.has(step.id)) throw new RangeError('Plan step IDs must be unique nonempty strings.');
    stepIds.add(step.id);
    if (!moduleIds.has(step.moduleId)) throw new RangeError(`Plan step ${step.id} references unknown module ${step.moduleId}.`);
    if (!Array.isArray(step.newBrickIds) || new Set(step.newBrickIds).size !== step.newBrickIds.length) {
      throw new TypeError(`Plan step ${step.id} must have unique newBrickIds.`);
    }
    for (const id of step.newBrickIds) {
      if (!bricksById.has(id)) throw new RangeError(`Plan step ${step.id} introduces unknown brick ${id}.`);
      if (ownerByBrickId.get(id) !== step.moduleId) throw new RangeError(`Plan step ${step.id} introduces a brick owned by another module.`);
      if (introduced.has(id)) throw new RangeError(`Plan brick ${id} is introduced more than once.`);
      introduced.add(id);
    }
  }
  if (target.brickIds.some((id) => !introduced.has(id))) throw new RangeError(`Module ${moduleId} has incomplete step coverage.`);
  return { bricksById };
}

function stepGeometry(step, bricksById) {
  const byCourse = new Map();
  for (const id of step.newBrickIds) {
    const brick = bricksById.get(id);
    if (!byCourse.has(brick.y)) byCourse.set(brick.y, []);
    byCourse.get(brick.y).push(brick);
  }
  const courses = [...byCourse.keys()].sort((a, b) => a - b);
  let area = 0;
  let boundingArea = 0;
  for (const course of courses) {
    const bricks = byCourse.get(course);
    const cells = cellsFor(bricks, `Step ${step.id} course ${course}`);
    const bounds = boundsFor(bricks);
    area += cells.size;
    boundingArea += bounds.width * bounds.depth;
  }
  return { stepId: step.id, courses, area, boundingArea, fillRatio: area / boundingArea };
}

function lineMap(bricks, orientation) {
  const lines = new Map();
  for (const brick of bricks) for (let z = brick.z; z < brick.z + brick.d; z += 1) {
    for (let x = brick.x; x < brick.x + brick.w; x += 1) {
      const line = orientation === 'x' ? z : x;
      if (!lines.has(line)) lines.set(line, new Set());
      lines.get(line).add(cellKey(x, z));
    }
  }
  return lines;
}

function partialLines(lines, introduced) {
  let partial = 0;
  for (const cells of lines.values()) {
    let count = 0;
    for (const key of cells) if (introduced.has(key)) count += 1;
    if (count > 0 && count < cells.size) partial += 1;
  }
  return partial;
}

function lineExposure(buildSteps, targetBricks, bricksById) {
  const courses = [...new Set(targetBricks.map(({ y }) => y))].sort((a, b) => a - b);
  const state = new Map(courses.map((course) => {
    const bricks = targetBricks.filter(({ y }) => y === course);
    return [course, {
      introduced: new Set(),
      xLines: lineMap(bricks, 'x'),
      zLines: lineMap(bricks, 'z'),
      xLineExposure: 0,
      zLineExposure: 0,
    }];
  }));
  for (const step of buildSteps) {
    for (const id of step.newBrickIds) {
      const brick = bricksById.get(id);
      const course = state.get(brick.y);
      for (let z = brick.z; z < brick.z + brick.d; z += 1) {
        for (let x = brick.x; x < brick.x + brick.w; x += 1) course.introduced.add(cellKey(x, z));
      }
    }
    // Empty and already completed lines contribute zero. Revisit every course
    // at each boundary so unfinished lower layers remain perceptually exposed.
    for (const course of state.values()) {
      course.xLineExposure += partialLines(course.xLines, course.introduced);
      course.zLineExposure += partialLines(course.zLines, course.introduced);
    }
  }
  const byCourse = courses.map((course) => {
    const { xLineExposure, zLineExposure } = state.get(course);
    const selectedOrientation = xLineExposure <= zLineExposure ? 'x' : 'z';
    return {
      course,
      xLineExposure,
      zLineExposure,
      selectedOrientation,
      partialLineExposure: Math.min(xLineExposure, zLineExposure),
    };
  });
  return {
    partialLineExposure: byCourse.reduce((sum, course) => sum + course.partialLineExposure, 0),
    partialLineExposureByCourse: byCourse,
  };
}

export function assessLayerGrouping(plan, moduleId) {
  const { bricksById } = validatePlan(plan, moduleId);
  const buildSteps = plan.steps.filter((step) => step.moduleId === moduleId && step.newBrickIds.length > 0);
  const steps = buildSteps.map((step) => stepGeometry(step, bricksById));
  const target = plan.modules.find((module) => module.id === moduleId);
  const exposure = lineExposure(buildSteps, target.brickIds.map((id) => bricksById.get(id)), bricksById);
  let highestCourse = -Infinity;
  let courseReturnCount = 0;
  for (const step of steps) {
    const low = step.courses[0];
    if (low < highestCourse) courseReturnCount += 1;
    highestCourse = Math.max(highestCourse, ...step.courses);
  }
  const totalArea = steps.reduce((sum, step) => sum + step.area, 0);
  const totalBoundingArea = steps.reduce((sum, step) => sum + step.boundingArea, 0);
  return {
    buildDiagramCount: steps.length,
    mixedCourseDiagramCount: steps.filter(({ courses }) => courses.length > 1).length,
    courseReturnCount,
    rectangleEmptyCellCount: totalBoundingArea - totalArea,
    rectangularCoverageRatio: totalBoundingArea ? totalArea / totalBoundingArea : 1,
    ...exposure,
    steps,
  };
}
