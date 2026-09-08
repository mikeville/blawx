import { expandLoftProgram } from './loft-program.js';
import { VOXEL_PALETTE } from './voxels.js';

const MAX_NODES = 256;
const LOCAL_LIMIT = 128;
const MAX_EXTENT = 64;
const AXES = Object.freeze({ x: [0, 1, 2], y: [1, 0, 2], z: [2, 0, 1] });
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const isHalfStep = (value) => Number.isFinite(value) && Number.isInteger(value * 2);
const exactFields = (value, allowed) => Object.keys(value).every((field) => allowed.includes(field));

function assertPalette(symbol, label) {
  if (typeof symbol !== 'string' || symbol === '.' || !Object.hasOwn(VOXEL_PALETTE, symbol)) {
    throw new TypeError(`${label} uses unknown palette symbol ${String(symbol)}.`);
  }
}

function assertLocal(value, label) {
  if (!isHalfStep(value)) throw new TypeError(`${label} must be a finite multiple of 0.5.`);
  if (value < -LOCAL_LIMIT || value > LOCAL_LIMIT) throw new RangeError(`${label} must be within ±${LOCAL_LIMIT}.`);
}

function primitiveBounds(tuple, index) {
  const opcode = tuple[0];
  const arity = opcode === 't' ? 10 : 8;
  if (!['b', 'e', 't'].includes(opcode) || tuple.length !== arity) {
    throw new TypeError(`Node ${index} primitive must be an exact b/e/t tuple.`);
  }
  const [, x, y, z, w, h, d, symbol, topW, topD] = tuple;
  assertPalette(symbol, `Node ${index}`);
  for (const [name, value] of Object.entries({ x, y, z })) {
    assertLocal(value, `Node ${index} ${name}`);
  }
  for (const [name, value] of Object.entries({ w, h, d })) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_EXTENT) {
      throw new RangeError(`Node ${index} ${name} must be a positive safe integer no greater than ${MAX_EXTENT}.`);
    }
  }
  const max = [x + w, y + h, z + d];
  if (max.some((value) => value < -LOCAL_LIMIT || value > LOCAL_LIMIT)) throw new RangeError(`Node ${index} primitive extrema must be within ±${LOCAL_LIMIT}.`);
  if (opcode === 't' && (!Number.isSafeInteger(topW) || !Number.isSafeInteger(topD) || topW <= 0 || topD <= 0 || topW > w || topD > d)) {
    throw new RangeError(`Node ${index} taper top must contain positive safe integers within its base.`);
  }
  return { min: [x, y, z], max };
}

function loftBounds(tuple, index) {
  if (tuple.length !== 5) throw new TypeError(`Node ${index} loft must contain exactly 5 values.`);
  const [, axis, profile, symbol, sections] = tuple;
  if (!Object.hasOwn(AXES, axis)) throw new TypeError(`Node ${index} loft axis must be x, y, or z.`);
  if (!['box', 'ellipse'].includes(profile)) throw new TypeError(`Node ${index} loft profile must be box or ellipse.`);
  assertPalette(symbol, `Node ${index}`);
  if (!Array.isArray(sections) || sections.length < 2 || sections.length > 16) throw new RangeError(`Node ${index} loft must have 2..16 sections.`);
  const [a, u, v] = AXES[axis];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let previous = -Infinity;
  sections.forEach((section, sectionIndex) => {
    if (!Array.isArray(section) || section.length !== 5) throw new TypeError(`Node ${index} loft section ${sectionIndex} must contain exactly 5 values.`);
    const [axial, centerU, centerV, widthU, widthV] = section;
    [axial, centerU, centerV, widthU, widthV].forEach((value, field) => assertLocal(value, `Node ${index} loft section ${sectionIndex} field ${field}`));
    if (axial <= previous) throw new RangeError(`Node ${index} loft axial coordinates must increase.`);
    if (widthU <= 0 || widthV <= 0 || widthU > MAX_EXTENT || widthV > MAX_EXTENT) throw new RangeError(`Node ${index} loft widths must be positive and no greater than ${MAX_EXTENT}.`);
    const lowerU = centerU - widthU / 2;
    const upperU = centerU + widthU / 2;
    const lowerV = centerV - widthV / 2;
    const upperV = centerV + widthV / 2;
    [lowerU, upperU, lowerV, upperV].forEach((value) => {
      if (!Number.isFinite(value) || value < -LOCAL_LIMIT || value > LOCAL_LIMIT) throw new RangeError(`Node ${index} loft outer extrema must be within ±${LOCAL_LIMIT}.`);
    });
    min[a] = Math.min(min[a], axial); max[a] = Math.max(max[a], axial);
    min[u] = Math.min(min[u], lowerU); max[u] = Math.max(max[u], upperU);
    min[v] = Math.min(min[v], lowerV); max[v] = Math.max(max[v], upperV);
    previous = axial;
  });
  return { min, max };
}

function ringBounds(tuple, index) {
  if (tuple.length !== 9) throw new TypeError(`Node ${index} ring must contain exactly 9 values.`);
  const [, axis, axial, depth, centerU, centerV, outerRadius, innerRadius, symbol] = tuple;
  if (!Object.hasOwn(AXES, axis)) throw new TypeError(`Node ${index} ring axis must be x, y, or z.`);
  assertLocal(axial, `Node ${index} ring axial coordinate`);
  if (!Number.isSafeInteger(depth) || depth <= 0 || depth > MAX_EXTENT) throw new RangeError(`Node ${index} ring depth must be a positive safe integer no greater than ${MAX_EXTENT}.`);
  [centerU, centerV, outerRadius, innerRadius].forEach((value, field) => assertLocal(value, `Node ${index} ring field ${field}`));
  if (innerRadius <= 0 || innerRadius >= outerRadius || outerRadius * 2 > MAX_EXTENT) throw new RangeError(`Node ${index} ring radii must satisfy 0 < inner < outer with diameter at most ${MAX_EXTENT}.`);
  assertPalette(symbol, `Node ${index}`);
  const [a, u, v] = AXES[axis];
  const min = []; const max = [];
  min[a] = axial; max[a] = axial + depth;
  min[u] = centerU - outerRadius; max[u] = centerU + outerRadius;
  min[v] = centerV - outerRadius; max[v] = centerV + outerRadius;
  if ([...min, ...max].some((value) => !isHalfStep(value) || value < -LOCAL_LIMIT || value > LOCAL_LIMIT)) throw new RangeError(`Node ${index} ring extrema must be halfsteps within ±${LOCAL_LIMIT}.`);
  return { min, max };
}

function localBounds(shape, index) {
  if (!Array.isArray(shape) || shape.length === 0) throw new TypeError(`Node ${index} shape must be a nonempty tuple.`);
  if (shape[0] === 'l') return loftBounds(shape, index);
  if (shape[0] === 'r') return ringBounds(shape, index);
  return primitiveBounds(shape, index);
}

function translate(shape, delta) {
  const result = structuredClone(shape);
  if (['b', 'e', 't'].includes(result[0])) {
    result[1] += delta[0]; result[2] += delta[1]; result[3] += delta[2];
  } else {
    const [a, u, v] = AXES[result[1]];
    if (result[0] === 'l') for (const section of result[4]) {
      section[0] += delta[a]; section[1] += delta[u]; section[2] += delta[v];
    } else {
      result[2] += delta[a]; result[4] += delta[u]; result[5] += delta[v];
    }
  }
  return result;
}

function resolveRaw(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).length !== 1 || !Object.hasOwn(source, 'nodes')) throw new TypeError('Relative program must contain exactly the nodes field.');
  if (!Array.isArray(source.nodes) || source.nodes.length === 0 || source.nodes.length > MAX_NODES) throw new RangeError(`nodes must be a nonempty array with at most ${MAX_NODES} entries.`);
  const byId = new Map();
  const parsed = source.nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !exactFields(node, ['id', 'shape', 'relativeTo']) || !Object.hasOwn(node, 'id') || !Object.hasOwn(node, 'shape')) throw new TypeError(`Node ${index} has invalid fields.`);
    if (typeof node.id !== 'string' || node.id.length > 64 || !ID_PATTERN.test(node.id)) throw new TypeError(`Node ${index} id is invalid.`);
    if (byId.has(node.id)) throw new TypeError(`Duplicate node id: ${node.id}.`);
    const bounds = localBounds(node.shape, index);
    if (node.relativeTo !== undefined) {
      const ref = node.relativeTo;
      if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).length !== 3 || !exactFields(ref, ['id', 'anchor', 'offset'])) throw new TypeError(`Node ${index} relativeTo must contain exactly id, anchor, and offset.`);
      if (typeof ref.id !== 'string' || ref.id.length > 64 || !ID_PATTERN.test(ref.id)) throw new TypeError(`Node ${index} relativeTo id is invalid.`);
      if (!Array.isArray(ref.anchor) || ref.anchor.length !== 3 || !ref.anchor.every((value) => [0, 0.5, 1].includes(value))) throw new TypeError(`Node ${index} relativeTo anchor is invalid.`);
      if (!Array.isArray(ref.offset) || ref.offset.length !== 3) throw new TypeError(`Node ${index} relativeTo offset must contain three finite halfsteps.`);
      ref.offset.forEach((value, axis) => assertLocal(value, `Node ${index} relativeTo offset ${axis}`));
    }
    const item = { node, bounds, index };
    byId.set(node.id, item);
    return item;
  });
  const state = new Map();
  function resolve(item) {
    if (state.get(item.node.id) === 2) return item;
    if (state.get(item.node.id) === 1) throw new RangeError(`Relative dependency cycle includes ${item.node.id}.`);
    state.set(item.node.id, 1);
    let delta = [0, 0, 0];
    if (item.node.relativeTo) {
      const reference = byId.get(item.node.relativeTo.id);
      if (!reference) throw new RangeError(`Missing relative node id: ${item.node.relativeTo.id}.`);
      resolve(reference);
      delta = reference.resolvedBounds.min.map((minimum, axis) => minimum
        + (reference.resolvedBounds.max[axis] - minimum) * item.node.relativeTo.anchor[axis]
        + item.node.relativeTo.offset[axis] - item.bounds.min[axis]);
      if (!delta.every(isHalfStep)) throw new RangeError(`Node ${item.node.id} translation must resolve to halfsteps.`);
    }
    item.resolvedShape = translate(item.node.shape, delta);
    item.resolvedBounds = { min: item.bounds.min.map((value, i) => value + delta[i]), max: item.bounds.max.map((value, i) => value + delta[i]) };
    state.set(item.node.id, 2);
    return item;
  }
  parsed.forEach(resolve);
  return { ops: parsed.map((item) => item.resolvedShape) };
}

export function resolveRelativeProgram(source) {
  const resolved = resolveRaw(source);
  expandLoftProgram(resolved);
  return resolved;
}

export function expandRelativeProgram(source, meta = {}) {
  return expandLoftProgram(resolveRaw(source), meta);
}
