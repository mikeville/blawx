import { expandVoxelTuples, VOXEL_PALETTE } from './voxels.js';

const MAX_SOURCE_OPS = 256;
const MAX_CELLS = 50_000;
const MAX_LATTICE_WORK = 262_144;
const MAX_AXIS = 64;
const AXES = Object.freeze({
  x: ['x', 'y', 'z'],
  y: ['y', 'x', 'z'],
  z: ['z', 'x', 'y'],
});

const key = (x, y, z) => `${x},${y},${z}`;
const isHalfStep = (value) => Number.isFinite(value) && Number.isInteger(value * 2);

function assertSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Loft program must be an object.');
  const fields = Object.keys(source);
  if (fields.length !== 1 || fields[0] !== 'ops') throw new TypeError('Loft program must contain exactly the ops field.');
  if (!Array.isArray(source.ops) || source.ops.length === 0) throw new TypeError('ops must be a nonempty array.');
  if (source.ops.length > MAX_SOURCE_OPS) throw new RangeError(`Loft program exceeds the ${MAX_SOURCE_OPS}-source-operation limit.`);
}

function parseLoft(tuple, index) {
  if (tuple.length !== 5) throw new TypeError(`Loft ${index} must contain exactly 5 values.`);
  const [, axis, profile, symbol, sections] = tuple;
  if (!Object.hasOwn(AXES, axis)) throw new TypeError(`Loft ${index} axis must be x, y, or z.`);
  if (!['box', 'ellipse'].includes(profile)) throw new TypeError(`Loft ${index} profile must be box or ellipse.`);
  if (typeof symbol !== 'string' || symbol === '.' || !Object.hasOwn(VOXEL_PALETTE, symbol)) {
    throw new TypeError(`Loft ${index} uses unknown palette symbol ${String(symbol)}.`);
  }
  if (!Array.isArray(sections) || sections.length < 2 || sections.length > 16) {
    throw new TypeError(`Loft ${index} sections must contain between 2 and 16 sections.`);
  }

  let previous = -Infinity;
  for (const [sectionIndex, section] of sections.entries()) {
    if (!Array.isArray(section) || section.length !== 5) throw new TypeError(`Loft ${index} section ${sectionIndex} must contain exactly 5 values.`);
    const [axial, centerU, centerV, widthU, widthV] = section;
    if (![axial, centerU, centerV, widthU, widthV].every(isHalfStep)) {
      throw new TypeError(`Loft ${index} section ${sectionIndex} values must be finite multiples of 0.5.`);
    }
    if (axial <= previous) throw new RangeError(`Loft ${index} section coordinates must be strictly increasing.`);
    if (widthU <= 0 || widthV <= 0) throw new RangeError(`Loft ${index} section widths must be positive.`);
    if (axial < 0 || axial > MAX_AXIS || centerU - widthU / 2 < 0 || centerU + widthU / 2 > MAX_AXIS ||
        centerV - widthV / 2 < 0 || centerV + widthV / 2 > MAX_AXIS) {
      throw new RangeError(`Loft ${index} section exceeds the ${MAX_AXIS}-voxel axis bounds.`);
    }
    previous = axial;
  }
  return { axis, profile, color: VOXEL_PALETTE[symbol], sections };
}

function interpolate(sections, axialCenter) {
  let upper = 1;
  while (sections[upper][0] < axialCenter) upper += 1;
  const lower = sections[upper - 1];
  const next = sections[upper];
  const t = (axialCenter - lower[0]) / (next[0] - lower[0]);
  return lower.slice(1).map((value, i) => value + (next[i + 1] - value) * t);
}

function candidateRange(center, width, inclusiveUpper) {
  const lower = center - width / 2;
  const upper = center + width / 2;
  return [Math.ceil(lower - 0.5), inclusiveUpper ? Math.floor(upper - 0.5) + 1 : Math.ceil(upper - 0.5)];
}

function prepareLoft(loft) {
  const slices = [];
  const start = loft.sections[0][0];
  const end = loft.sections.at(-1)[0];
  for (let axial = Math.ceil(start - 0.5); axial + 0.5 < end; axial += 1) {
    const axialCenter = axial + 0.5;
    const [centerU, centerV, widthU, widthV] = interpolate(loft.sections, axialCenter);
    const inclusiveUpper = loft.profile === 'ellipse';
    const [minU, maxU] = candidateRange(centerU, widthU, inclusiveUpper);
    const [minV, maxV] = candidateRange(centerV, widthV, inclusiveUpper);
    slices.push({ axial, centerU, centerV, widthU, widthV, minU, maxU, minV, maxV });
  }
  return slices;
}

function parseRing(tuple, index) {
  if (tuple.length !== 9) throw new TypeError(`Ring ${index} must contain exactly 9 values.`);
  const [, axis, axial, depth, centerU, centerV, outerRadius, innerRadius, symbol] = tuple;
  if (!Object.hasOwn(AXES, axis)) throw new TypeError(`Ring ${index} axis must be x, y, or z.`);
  if (!Number.isSafeInteger(axial) || !Number.isSafeInteger(depth)) {
    throw new TypeError(`Ring ${index} axial coordinate and depth must be safe integers.`);
  }
  if (![centerU, centerV, outerRadius, innerRadius].every(isHalfStep)) {
    throw new TypeError(`Ring ${index} center and radii must be finite multiples of 0.5.`);
  }
  if (depth <= 0 || innerRadius <= 0 || innerRadius >= outerRadius) {
    throw new RangeError(`Ring ${index} depth must be positive and radii must satisfy 0 < innerRadius < outerRadius.`);
  }
  if (axial < 0 || axial + depth > MAX_AXIS || centerU - outerRadius < 0 || centerU + outerRadius > MAX_AXIS ||
      centerV - outerRadius < 0 || centerV + outerRadius > MAX_AXIS) {
    throw new RangeError(`Ring ${index} exceeds the ${MAX_AXIS}-voxel axis bounds.`);
  }
  if (typeof symbol !== 'string' || symbol === '.' || !Object.hasOwn(VOXEL_PALETTE, symbol)) {
    throw new TypeError(`Ring ${index} uses unknown palette symbol ${String(symbol)}.`);
  }
  const [minU, maxU] = candidateRange(centerU, outerRadius * 2, true);
  const [minV, maxV] = candidateRange(centerV, outerRadius * 2, true);
  return { axis, axial, depth, centerU, centerV, outerRadius, innerRadius, color: VOXEL_PALETTE[symbol], minU, maxU, minV, maxV };
}

function primitiveVolume(tuple, index) {
  const opcode = tuple[0];
  if (!['b', 'e', 't'].includes(opcode)) throw new TypeError(`Tuple ${index} has unknown opcode ${String(opcode)}.`);
  const expectedArity = opcode === 't' ? 10 : 8;
  if (tuple.length !== expectedArity) throw new TypeError(`Tuple ${index} must contain exactly ${expectedArity} values.`);
  const [, x, y, z, w, h, d, symbol, topW, topD] = tuple;
  if (typeof symbol !== 'string' || symbol === '.' || !Object.hasOwn(VOXEL_PALETTE, symbol)) {
    throw new TypeError(`Tuple ${index} uses unknown palette symbol ${String(symbol)}.`);
  }
  for (const [field, value] of Object.entries({ x, y, z, w, h, d })) {
    if (!Number.isSafeInteger(value)) throw new TypeError(`Operation ${index} ${field} must be a safe integer.`);
  }
  if (x < 0 || y < 0 || z < 0 || w <= 0 || h <= 0 || d <= 0) {
    throw new RangeError(`Operation ${index} origin must be nonnegative and extents must be positive.`);
  }
  if (x + w > MAX_AXIS || y + h > MAX_AXIS || z + d > MAX_AXIS) {
    throw new RangeError(`Operation ${index} exceeds the ${MAX_AXIS}-voxel axis bounds.`);
  }
  if (opcode === 't') {
    if (!Number.isSafeInteger(topW) || !Number.isSafeInteger(topD) || topW <= 0 || topD <= 0) {
      throw new TypeError(`Operation ${index} taper topW and topD must be positive safe integers.`);
    }
    if (topW > w || topD > d) throw new RangeError(`Operation ${index} taper top must fit within its centered base bounds.`);
  }
  return w * h * d;
}

export function expandLoftProgram(source, meta = {}) {
  assertSource(source);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new TypeError('meta must be an object.');

  const prepared = [];
  let latticeWork = 0;
  for (const [index, tuple] of source.ops.entries()) {
    if (!Array.isArray(tuple)) throw new TypeError(`Operation ${index} must be an array.`);
    if (tuple[0] === 'l') {
      const loft = parseLoft(tuple, index);
      const slices = prepareLoft(loft);
      const work = slices.reduce((sum, slice) => sum + (slice.maxU - slice.minU) * (slice.maxV - slice.minV), 0);
      latticeWork += work;
      prepared.push({ kind: 'loft', loft, slices });
    } else if (tuple[0] === 'r') {
      const ring = parseRing(tuple, index);
      latticeWork += ring.depth * (ring.maxU - ring.minU) * (ring.maxV - ring.minV);
      prepared.push({ kind: 'ring', ring });
    } else {
      latticeWork += primitiveVolume(tuple, index);
      prepared.push({ kind: 'primitive', tuple });
    }
    if (!Number.isSafeInteger(latticeWork) || latticeWork > MAX_LATTICE_WORK) {
      throw new RangeError(`Loft program expansion exceeds the ${MAX_LATTICE_WORK}-cell lattice-work limit.`);
    }
  }

  const occupied = new Map();
  for (const operation of prepared) {
    if (operation.kind === 'primitive') {
      const model = expandVoxelTuples({ ops: [operation.tuple] });
      for (const cell of model.cells) {
        occupied.set(key(cell.x, cell.y, cell.z), cell);
        if (occupied.size > MAX_CELLS) throw new RangeError(`Occupied voxel count exceeds the ${MAX_CELLS}-cell limit.`);
      }
    } else if (operation.kind === 'loft') {
      const [aField, uField, vField] = AXES[operation.loft.axis];
      for (const slice of operation.slices) for (let v = slice.minV; v < slice.maxV; v += 1) for (let u = slice.minU; u < slice.maxU; u += 1) {
        const du = (u + 0.5 - slice.centerU) / (slice.widthU / 2);
        const dv = (v + 0.5 - slice.centerV) / (slice.widthV / 2);
        if (operation.loft.profile === 'ellipse' && du * du + dv * dv > 1) continue;
        const cell = { [aField]: slice.axial, [uField]: u, [vField]: v, color: operation.loft.color };
        occupied.set(key(cell.x, cell.y, cell.z), cell);
        if (occupied.size > MAX_CELLS) throw new RangeError(`Occupied voxel count exceeds the ${MAX_CELLS}-cell limit.`);
      }
    } else {
      const [aField, uField, vField] = AXES[operation.ring.axis];
      const outerSquared = operation.ring.outerRadius ** 2;
      const innerSquared = operation.ring.innerRadius ** 2;
      for (let axial = operation.ring.axial; axial < operation.ring.axial + operation.ring.depth; axial += 1) {
        for (let v = operation.ring.minV; v < operation.ring.maxV; v += 1) for (let u = operation.ring.minU; u < operation.ring.maxU; u += 1) {
          const du = u + 0.5 - operation.ring.centerU;
          const dv = v + 0.5 - operation.ring.centerV;
          const distanceSquared = du * du + dv * dv;
          if (distanceSquared < innerSquared || distanceSquared > outerSquared) continue;
          const cell = { [aField]: axial, [uField]: u, [vField]: v, color: operation.ring.color };
          occupied.set(key(cell.x, cell.y, cell.z), cell);
          if (occupied.size > MAX_CELLS) throw new RangeError(`Occupied voxel count exceeds the ${MAX_CELLS}-cell limit.`);
        }
      }
    }
  }
  if (occupied.size === 0) throw new RangeError('Expanded voxel model must contain at least one occupied cell.');
  return { version: 1, kind: 'voxels', cells: [...occupied.values()], meta: { ...meta } };
}
