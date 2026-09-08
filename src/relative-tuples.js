import { expandRelativeProgram, resolveRelativeProgram } from './relative-program.js';

const MAX_OPS = 256;

function toRelativeProgram(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).length !== 1 || !Object.hasOwn(source, 'ops')) {
    throw new TypeError('Relative tuple program must contain exactly the ops field.');
  }
  if (!Array.isArray(source.ops) || source.ops.length === 0 || source.ops.length > MAX_OPS) {
    throw new RangeError(`ops must be a nonempty array with at most ${MAX_OPS} entries.`);
  }

  return {
    nodes: source.ops.map((operation, index) => {
      if (!Array.isArray(operation) || operation.length === 0) {
        throw new TypeError(`Operation ${index} must be a nonempty tuple.`);
      }
      if (operation[0] !== '@') return { id: `n${index}`, shape: operation };
      if (operation.length !== 5) throw new TypeError(`Operation ${index} relative wrapper must contain exactly 5 fields.`);
      const [, referenceIndex, anchor, offset, shape] = operation;
      if (!Number.isSafeInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= source.ops.length) {
        throw new RangeError(`Operation ${index} reference index must identify an operation in ops.`);
      }
      if (!Array.isArray(shape) || shape.length === 0 || shape[0] === '@') {
        throw new TypeError(`Operation ${index} relative local shape must be a non-nested shape tuple.`);
      }
      return {
        id: `n${index}`,
        relativeTo: { id: `n${referenceIndex}`, anchor, offset },
        shape,
      };
    }),
  };
}

export function resolveRelativeTuples(source) {
  return resolveRelativeProgram(toRelativeProgram(source));
}

export function expandRelativeTuples(source, meta = {}) {
  return expandRelativeProgram(toRelativeProgram(source), meta);
}
