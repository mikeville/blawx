import { PALETTE } from './geometry.js';

const RAW_TICKS_PER_VOXEL = 5;
const BRICK_TICKS_PER_COURSE = 6;
const MAX_AXIS_CELLS = 64;
const MAX_MAPPED_CELLS = 1_500_000;
const PRACTICAL_SCALE = Object.freeze({
  mode: 'compact',
  studsPerVoxel: 1,
  coursesPerVoxel: RAW_TICKS_PER_VOXEL / BRICK_TICKS_PER_COURSE,
  voxelMm: 8,
});

function positionKey(x, y, z) {
  return `${x},${y},${z}`;
}

function validateColor(color, label) {
  if (typeof color !== 'string' || !Object.hasOwn(PALETTE, color)) {
    throw new RangeError(`${label} uses unknown color ${String(color)}.`);
  }
}

function validateRawModel(rawModel) {
  if (!rawModel || rawModel.kind !== 'voxels' || !Array.isArray(rawModel.cells) || rawModel.cells.length === 0) {
    throw new TypeError('rawModel must be a nonempty voxel model.');
  }
  const indexed = new Map();
  const colorTicks = new Map();
  rawModel.cells.forEach((cell, index) => {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) throw new TypeError(`Raw cell ${index} must be an object.`);
    for (const field of ['x', 'y', 'z']) {
      if (!Number.isSafeInteger(cell[field]) || cell[field] < 0 || cell[field] >= MAX_AXIS_CELLS) {
        throw new RangeError(`Raw cell ${index} ${field} must be an integer from 0 through ${MAX_AXIS_CELLS - 1}.`);
      }
    }
    validateColor(cell.color, `Raw cell ${index}`);
    const key = positionKey(cell.x, cell.y, cell.z);
    if (indexed.has(key)) throw new RangeError(`Raw cells duplicate position (${cell.x}, ${cell.y}, ${cell.z}).`);
    indexed.set(key, cell.color);
    colorTicks.set(cell.color, (colorTicks.get(cell.color) ?? 0) + RAW_TICKS_PER_VOXEL);
  });
  return { indexed, colorTicks };
}

function validateScale(brickModel) {
  const scale = brickModel?.meta?.scale;
  const supported = scale?.mode === PRACTICAL_SCALE.mode
    && scale.studsPerVoxel === PRACTICAL_SCALE.studsPerVoxel
    && Math.abs(scale.coursesPerVoxel - PRACTICAL_SCALE.coursesPerVoxel) < Number.EPSILON * 4
    && scale.voxelMm === PRACTICAL_SCALE.voxelMm;
  if (!supported) {
    throw new RangeError('measureBrickDifference supports only compact scale: 1 stud per voxel and 5 courses per 6 voxels.');
  }
}

function validateBrick(brick, index) {
  if (!brick || typeof brick !== 'object' || Array.isArray(brick)) throw new TypeError(`Brick ${index} must be an object.`);
  for (const field of ['x', 'y', 'z', 'w', 'd']) {
    if (!Number.isSafeInteger(brick[field])) throw new RangeError(`Brick ${index} ${field} must be a safe integer.`);
  }
  if (brick.x < 0 || brick.y < 0 || brick.z < 0 || brick.w <= 0 || brick.d <= 0
    || brick.x + brick.w > MAX_AXIS_CELLS || brick.z + brick.d > MAX_AXIS_CELLS) {
    throw new RangeError(`Brick ${index} exceeds the current nonnegative ${MAX_AXIS_CELLS}×${MAX_AXIS_CELLS} stud boundary.`);
  }
  if (!Number.isSafeInteger(brick.y * BRICK_TICKS_PER_COURSE + BRICK_TICKS_PER_COURSE - 1)) {
    throw new RangeError(`Brick ${index} y exceeds the safe practical-scale tick range.`);
  }
  validateColor(brick.color, `Brick ${index}`);
}

function ratios({ rawCellCount, addedTicks, removedTicks, recoloredTicks }) {
  const addedVolumeVoxelEquivalent = addedTicks / RAW_TICKS_PER_VOXEL;
  const removedVolumeVoxelEquivalent = removedTicks / RAW_TICKS_PER_VOXEL;
  const recoloredVolumeVoxelEquivalent = recoloredTicks / RAW_TICKS_PER_VOXEL;
  return {
    addedVolumeVoxelEquivalent,
    removedVolumeVoxelEquivalent,
    recoloredVolumeVoxelEquivalent,
    relativeVolumeChange: (addedVolumeVoxelEquivalent - removedVolumeVoxelEquivalent) / rawCellCount,
    geometryDifferenceRatio: (addedVolumeVoxelEquivalent + removedVolumeVoxelEquivalent) / rawCellCount,
    colorDifferenceRatio: recoloredVolumeVoxelEquivalent / rawCellCount,
  };
}

/**
 * Measures the final packed model directly against its source voxels on the
 * current common 5:6 vertical tick lattice. Brick footprints are expanded one
 * stud-course cell at a time, but no full per-tick occupancy map is allocated.
 */
export function measureBrickDifference(rawModel, brickModel) {
  const raw = validateRawModel(rawModel);
  if (!brickModel || brickModel.kind !== 'bricks' || !Array.isArray(brickModel.bricks)) {
    throw new TypeError('brickModel must be a brick model.');
  }
  validateScale(brickModel);

  const occupiedStudCourses = new Set();
  const brickColorTicks = new Map();
  let mappedCellCount = 0;
  let intersectedTicks = 0;
  let addedTicks = 0;
  let recoloredTicks = 0;

  brickModel.bricks.forEach((brick, index) => {
    validateBrick(brick, index);
    const footprintCells = brick.w * brick.d;
    if (mappedCellCount + footprintCells > MAX_MAPPED_CELLS) {
      throw new RangeError(`Brick footprint expansion exceeds the ${MAX_MAPPED_CELLS}-cell measurement limit.`);
    }
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const x = brick.x + dx;
      const z = brick.z + dz;
      const occupiedKey = positionKey(x, brick.y, z);
      if (occupiedStudCourses.has(occupiedKey)) {
        throw new RangeError(`Brick footprints overlap at stud-course cell (${x}, ${brick.y}, ${z}).`);
      }
      occupiedStudCourses.add(occupiedKey);
      mappedCellCount += 1;
      brickColorTicks.set(brick.color, (brickColorTicks.get(brick.color) ?? 0) + BRICK_TICKS_PER_COURSE);

      const firstTick = brick.y * BRICK_TICKS_PER_COURSE;
      for (let tick = firstTick; tick < firstTick + BRICK_TICKS_PER_COURSE; tick += 1) {
        const sourceColor = raw.indexed.get(positionKey(x, Math.floor(tick / RAW_TICKS_PER_VOXEL), z));
        if (sourceColor === undefined) addedTicks += 1;
        else {
          intersectedTicks += 1;
          if (sourceColor !== brick.color) recoloredTicks += 1;
        }
      }
    }
  });

  const rawCellCount = rawModel.cells.length;
  const removedTicks = rawCellCount * RAW_TICKS_PER_VOXEL - intersectedTicks;
  const colors = [...new Set([...raw.colorTicks.keys(), ...brickColorTicks.keys()])].sort();
  const colorVolumeDeltas = Object.fromEntries(colors.map((color) => [
    color,
    ((brickColorTicks.get(color) ?? 0) - (raw.colorTicks.get(color) ?? 0)) / RAW_TICKS_PER_VOXEL,
  ]));

  return {
    mappedCellCount,
    ...ratios({ rawCellCount, addedTicks, removedTicks, recoloredTicks }),
    colorVolumeDeltas,
  };
}
