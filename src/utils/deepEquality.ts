/**
 * Structural equality for query semantics.
 *
 * Filter values that are objects or arrays match records by deep document
 * equality (aligned with Mongo document equality) instead of reference
 * identity, which can never hold for deserialized records. Depth is bounded to
 * mirror QueryEngine's MAX_FILTER_DEPTH so cyclic values fail closed instead
 * of overflowing the stack.
 */
const MAX_EQUALITY_DEPTH = 10;

export const deepEquals = (left: unknown, right: unknown, depth = 0): boolean => {
  if (left === right) {
    return true;
  }
  if (depth > MAX_EQUALITY_DEPTH) {
    return false;
  }
  if (typeof left === 'number' && typeof right === 'number' && Number.isNaN(left) && Number.isNaN(right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => deepEquals(entry, right[index], depth + 1));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }
  return leftKeys.every(
    key =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) && deepEquals(leftRecord[key], rightRecord[key], depth + 1)
  );
};
