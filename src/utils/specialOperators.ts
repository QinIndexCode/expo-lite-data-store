import type { UpdatePayload } from '../types/storageTypes';

export type QueryOperator = '$and' | '$or' | '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin' | '$like';

export type UpdateOperator = '$inc' | '$set' | '$unset' | '$push' | '$pull' | '$addToSet';

const UNSAFE_UPDATE_FIELD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeUpdateFieldName = (field: string): void => {
  if (UNSAFE_UPDATE_FIELD_NAMES.has(field)) {
    throw new Error(`Unsafe update field: ${field}`);
  }
};

const safeObjectEntries = (value: unknown): Array<[string, unknown]> => {
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).map(([field, entryValue]) => {
    assertSafeUpdateFieldName(field);
    return [field, entryValue];
  });
};

/**
 * Supported query and update operators.
 */
export const SPECIAL_OPERATORS = {
  QUERY: {
    $and: true,
    $or: true,
    $eq: true,
    $ne: true,
    $gt: true,
    $gte: true,
    $lt: true,
    $lte: true,
    $in: true,
    $nin: true,
    $like: true,
  },
  UPDATE: {
    $inc: true,
    $set: true,
    $unset: true,
    $push: true,
    $pull: true,
    $addToSet: true,
  },
};

export function isQueryOperator(key: string): key is QueryOperator {
  return Object.prototype.hasOwnProperty.call(SPECIAL_OPERATORS.QUERY, key);
}

export function isUpdateOperator(key: string): key is UpdateOperator {
  return Object.prototype.hasOwnProperty.call(SPECIAL_OPERATORS.UPDATE, key);
}

export function isSpecialOperator(key: string): boolean {
  return isQueryOperator(key) || isUpdateOperator(key);
}

export function separateUpdateOperators(updateData: object): {
  regularFields: Record<string, unknown>;
  operators: Partial<Record<UpdateOperator, unknown>>;
} {
  const regularFields = Object.create(null) as Record<string, unknown>;
  const operators = Object.create(null) as Partial<Record<UpdateOperator, unknown>>;

  for (const [key, value] of safeObjectEntries(updateData)) {
    if (isUpdateOperator(key)) {
      operators[key] = value;
    } else {
      assertSafeUpdateFieldName(key);
      regularFields[key] = value;
    }
  }

  return { regularFields, operators };
}

/**
 * Applies ordinary fields and supported update operators without mutating the
 * original record.
 */
export function processUpdateOperators<T extends object>(originalData: T, updateData: UpdatePayload<T>): T {
  const result = Object.create(null) as Record<string, unknown>;
  for (const [field, value] of safeObjectEntries(originalData)) {
    result[field] = value;
  }
  const { regularFields, operators } = separateUpdateOperators(updateData);

  if (operators.$inc) {
    for (const [field, increment] of safeObjectEntries(operators.$inc)) {
      if (typeof increment === 'number') {
        const currentValue = typeof result[field] === 'number' ? result[field] : 0;
        result[field] = currentValue + increment;
      }
    }
  }

  if (operators.$set) {
    for (const [field, value] of safeObjectEntries(operators.$set)) {
      result[field] = value;
    }
  }

  if (operators.$unset) {
    if (Array.isArray(operators.$unset)) {
      for (const field of operators.$unset) {
        if (typeof field !== 'string') {
          continue;
        }
        assertSafeUpdateFieldName(field);
        delete result[field];
      }
    }
  }

  if (operators.$push) {
    for (const [field, value] of safeObjectEntries(operators.$push)) {
      const existing = result[field];
      // The result starts as a shallow record copy, so clone mutable values
      // before applying an operator that appends to them.
      const values: unknown[] = Array.isArray(existing) ? Array.from(existing) : [];
      result[field] = values;
      values.push(value);
    }
  }

  if (operators.$pull) {
    for (const [field, condition] of safeObjectEntries(operators.$pull)) {
      if (Array.isArray(result[field])) {
        result[field] = result[field].filter(item => {
          if (typeof condition !== 'object' || condition === null) {
            return item !== condition;
          }

          if (!isRecord(item) || !isRecord(condition)) {
            return item !== condition;
          }

          return !Object.entries(condition).some(([key, value]) => item[key] === value);
        });
      }
    }
  }

  if (operators.$addToSet) {
    for (const [field, value] of safeObjectEntries(operators.$addToSet)) {
      const existing = result[field];
      const values: unknown[] = Array.isArray(existing) ? Array.from(existing) : [];
      result[field] = values;
      if (!values.includes(value)) {
        values.push(value);
      }
    }
  }

  for (const [field, value] of Object.entries(regularFields)) {
    result[field] = value;
  }

  return result as T;
}
