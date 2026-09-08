import { expandLoftProgram } from './loft-program.js';

const MAX_SOURCE_OPS = 256;

function assertSourceEnvelope(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('Bidirectional loft program must be an object.');
  }
  const fields = Object.keys(source);
  if (fields.length !== 1 || fields[0] !== 'ops') {
    throw new TypeError('Bidirectional loft program must contain exactly the ops field.');
  }
  if (!Array.isArray(source.ops) || source.ops.length === 0) {
    throw new TypeError('ops must be a nonempty array.');
  }
  if (source.ops.length > MAX_SOURCE_OPS) {
    throw new RangeError(`Bidirectional loft program exceeds the ${MAX_SOURCE_OPS}-source-operation limit.`);
  }
}

function normalizeOperation(tuple, index) {
  if (!Array.isArray(tuple)) throw new TypeError(`Operation ${index} must be an array.`);
  if (tuple[0] !== 'l') return tuple;
  if (tuple.length !== 5) throw new TypeError(`Loft ${index} must contain exactly 5 values.`);

  const sections = tuple[4];
  if (!Array.isArray(sections) || sections.length < 2 || sections.length > 16) {
    throw new TypeError(`Loft ${index} sections must contain between 2 and 16 sections.`);
  }

  const axial = sections.map((section, sectionIndex) => {
    if (!Array.isArray(section) || section.length !== 5) {
      throw new TypeError(`Loft ${index} section ${sectionIndex} must contain exactly 5 values.`);
    }
    if (!Number.isFinite(section[0])) {
      throw new TypeError(`Loft ${index} section ${sectionIndex} axial coordinate must be finite.`);
    }
    return section[0];
  });
  const increasing = axial.every((value, i) => i === 0 || value > axial[i - 1]);
  const decreasing = axial.every((value, i) => i === 0 || value < axial[i - 1]);
  if (!increasing && !decreasing) {
    throw new RangeError(`Loft ${index} section coordinates must be strictly increasing or strictly decreasing.`);
  }
  if (increasing) return tuple;
  return [tuple[0], tuple[1], tuple[2], tuple[3], [...sections].reverse()];
}

export function expandBidirectionalLoftProgram(source, meta = {}) {
  assertSourceEnvelope(source);
  const normalized = { ops: source.ops.map(normalizeOperation) };
  return expandLoftProgram(normalized, meta);
}
