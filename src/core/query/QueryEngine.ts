import {
  isStorageRecord,
  type FilterCondition,
  type SortAlgorithm,
  type SortField,
  type SortOrder,
  type StorageRecord,
  type UpdatePayload,
} from '../../types/storageTypes';
import {
  sortByColumn,
  sortByColumnCounting,
  sortByColumnFast,
  sortByColumnMerge,
  sortByColumnSlow,
} from '../../utils/sortingTools';
import { processUpdateOperators } from '../../utils/specialOperators';
import { QUERY } from '../constants';
import logger from '../../utils/logger';

const MAX_FILTER_DEPTH = 10;

type SortFunction = <T extends object>(data: T[], column: string, order?: SortOrder) => T[];

const getRecordValue = (value: object, key: string): unknown => (isStorageRecord(value) ? value[key] : undefined);

const isFilterCondition = <T extends object>(value: unknown): value is FilterCondition<T> =>
  typeof value === 'function' || isStorageRecord(value);

const compareValues = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  if (typeof left === 'bigint' && typeof right === 'bigint') return left < right ? -1 : 1;
  return String(left).localeCompare(String(right));
};

/**
 * Matches a SQL LIKE pattern without compiling user-controlled regular expressions.
 * `%` matches any number of UTF-16 code units and `_` matches exactly one.
 */
const matchesLike = (value: string, pattern: string): boolean => {
  const source = value.toLowerCase();
  const query = pattern.toLowerCase();
  let sourceIndex = 0;
  let queryIndex = 0;
  let wildcardIndex = -1;
  let wildcardMatchIndex = 0;

  while (sourceIndex < source.length) {
    const token = query[queryIndex];

    if (token === '_' || token === source[sourceIndex]) {
      sourceIndex++;
      queryIndex++;
    } else if (token === '%') {
      wildcardIndex = queryIndex++;
      wildcardMatchIndex = sourceIndex;
    } else if (wildcardIndex !== -1) {
      queryIndex = wildcardIndex + 1;
      sourceIndex = ++wildcardMatchIndex;
    } else {
      return false;
    }
  }

  while (query[queryIndex] === '%') {
    queryIndex++;
  }

  return queryIndex === query.length;
};

export class QueryEngine {
  private static filterWithDepth<T extends object>(
    data: T[],
    condition: FilterCondition<T> | undefined,
    depth: number
  ): T[] {
    if (!condition) return data;

    if (depth > MAX_FILTER_DEPTH) {
      logger.error(
        `QueryEngine: Maximum filter depth (${MAX_FILTER_DEPTH}) exceeded. This may indicate a circular reference or overly complex query.`
      );
      throw new Error(`Maximum filter depth (${MAX_FILTER_DEPTH}) exceeded`);
    }

    if (typeof condition === 'function') {
      return data.filter(condition as (value: T, index: number, array: T[]) => unknown);
    }

    if (!isStorageRecord(condition)) {
      return [];
    }

    const conditionRecord = condition as StorageRecord;
    const andConditions = conditionRecord.$and;
    if (Array.isArray(andConditions)) {
      let result = [...data];
      for (const subCondition of andConditions) {
        if (!isFilterCondition<T>(subCondition)) {
          return [];
        }
        result = this.filterWithDepth(result, subCondition, depth + 1);
      }
      return result;
    }

    const orConditions = conditionRecord.$or;
    if (Array.isArray(orConditions)) {
      const results = new Set<T>();
      for (const subCondition of orConditions) {
        if (!isFilterCondition<T>(subCondition)) {
          continue;
        }
        const filtered = this.filterWithDepth(data, subCondition, depth + 1);
        filtered.forEach(item => results.add(item));
      }
      return Array.from(results);
    }

    return data.filter(item => {
      let matches = true;

      for (const [key, value] of Object.entries(conditionRecord)) {
        const itemValue = getRecordValue(item, key);

        if (isStorageRecord(value)) {
          for (const [op, opValue] of Object.entries(value)) {
            switch (op) {
              case '$eq':
                if (itemValue === null || itemValue === undefined) {
                  if (itemValue !== opValue) {
                    matches = false;
                  }
                } else if (itemValue !== opValue) {
                  matches = false;
                }
                break;
              case '$ne':
                if (itemValue === null || itemValue === undefined) {
                  if (itemValue === opValue) {
                    matches = false;
                  }
                } else if (itemValue === opValue) {
                  matches = false;
                }
                break;
              case '$gt':
                if (!(typeof itemValue === 'number' && typeof opValue === 'number') || itemValue <= opValue) {
                  matches = false;
                }
                break;
              case '$gte':
                if (!(typeof itemValue === 'number' && typeof opValue === 'number') || itemValue < opValue) {
                  matches = false;
                }
                break;
              case '$lt':
                if (!(typeof itemValue === 'number' && typeof opValue === 'number') || itemValue >= opValue) {
                  matches = false;
                }
                break;
              case '$lte':
                if (!(typeof itemValue === 'number' && typeof opValue === 'number') || itemValue > opValue) {
                  matches = false;
                }
                break;
              case '$in':
                if (!Array.isArray(opValue)) {
                  matches = false;
                } else {
                  const opValueSet = new Set(opValue);
                  if (itemValue === null || itemValue === undefined) {
                    if (!opValueSet.has(itemValue)) {
                      matches = false;
                    }
                  } else if (Array.isArray(itemValue)) {
                    if (!itemValue.some(item => opValueSet.has(item))) {
                      matches = false;
                    }
                  } else {
                    if (!opValueSet.has(itemValue)) {
                      matches = false;
                    }
                  }
                }
                break;
              case '$nin':
                if (!Array.isArray(opValue)) {
                  matches = false;
                } else {
                  const opValueSet = new Set(opValue);
                  if (itemValue === null || itemValue === undefined) {
                    if (opValueSet.has(itemValue)) {
                      matches = false;
                    }
                  } else if (Array.isArray(itemValue)) {
                    if (itemValue.some(item => opValueSet.has(item))) {
                      matches = false;
                    }
                  } else {
                    if (opValueSet.has(itemValue)) {
                      matches = false;
                    }
                  }
                }
                break;
              case '$like':
                if (typeof itemValue !== 'string' || typeof opValue !== 'string') {
                  matches = false;
                } else if (!matchesLike(itemValue, opValue)) {
                  matches = false;
                }
                break;
              default:
                matches = false;
            }

            if (!matches) break;
          }
        } else {
          if (itemValue === null || itemValue === undefined) {
            if (itemValue !== value) {
              matches = false;
            }
          } else if (Array.isArray(itemValue) && Array.isArray(value)) {
            if (JSON.stringify(itemValue) !== JSON.stringify(value)) {
              matches = false;
            }
          } else if (itemValue !== value) {
            matches = false;
          }
        }

        if (!matches) break;
      }

      return matches;
    });
  }

  static filter<T extends object>(data: T[], condition?: FilterCondition<T>): T[] {
    return this.filterWithDepth(data, condition, 0);
  }

  static update<T extends object>(originalData: T, updateData: UpdatePayload<T>): T {
    return processUpdateOperators(originalData, updateData);
  }

  /**
   * Updates all records that match an optional filter.
   */
  static bulkUpdate<T extends object>(data: T[], updateData: UpdatePayload<T>, condition?: FilterCondition<T>): T[] {
    if (!updateData || Object.keys(updateData).length === 0) {
      return data;
    }

    const filteredData = condition ? this.filter(data, condition) : data;
    const updatedDataRefs = new Set(filteredData);

    // Preserve references for records that do not match the optional filter.
    return data.map(item => {
      if (updatedDataRefs.has(item)) {
        return this.update(item, updateData);
      }
      return item;
    });
  }

  /**
   * Returns a bounded page without allocating when the requested range is empty.
   */
  static paginate<T>(data: T[], skip = 0, limit?: number): T[] {
    // Optimization: If skip >= data length, return empty array
    if (skip >= data.length) {
      return [];
    }

    // Optimization: When limit is 0, return empty array
    if (limit === 0) {
      logger.warn('Warning: limit=0 was passed to paginate, returning empty array as per convention');
      return [];
    }

    // Optimization: Calculate actual end index
    const startIndex = skip;
    const endIndex = limit !== undefined ? Math.min(startIndex + limit, data.length) : data.length;

    // Optimization: If startIndex=0 and endIndex=data length, return original
    if (startIndex === 0 && endIndex === data.length) {
      return data;
    }

    return data.slice(startIndex, endIndex);
  }

  /**
   * Selects the requested sorting implementation.
   */
  private static getSortFunction(algorithm: SortAlgorithm = 'default'): SortFunction {
    switch (algorithm) {
      case 'fast':
        return sortByColumnFast;
      case 'counting':
        return sortByColumnCounting;
      case 'merge':
        return sortByColumnMerge;
      case 'slow':
        return sortByColumnSlow;
      case 'default':
      default:
        return sortByColumn;
    }
  }

  /**
   * Selects a stable sorting algorithm from the requested configuration and
   * collection characteristics.
   */
  private static selectSortAlgorithm<T extends object>(
    requestedAlgorithm: SortAlgorithm | undefined,
    data: T[],
    sortBy: SortField<T> | SortField<T>[]
  ): SortAlgorithm {
    // If user specified algorithm, use directly
    if (requestedAlgorithm && requestedAlgorithm !== 'default') {
      return requestedAlgorithm;
    }

    // Smart algorithm selection
    const dataSize = data.length;
    const sortFields = Array.isArray(sortBy) ? sortBy : [sortBy];

    // Use default algorithm for small datasets
    if (dataSize < QUERY.COUNTING_SORT_THRESHOLD) {
      return 'default';
    }

    // Use merge sort for large datasets (stable and efficient)
    if (dataSize > QUERY.MERGE_SORT_THRESHOLD) {
      return 'merge';
    }

    // Counting sort is only efficient for a small value domain.
    if (sortFields.length === 1 && sortFields[0] !== undefined && this.isSuitableForCountingSort(data, sortFields[0])) {
      return 'counting';
    }

    // Default to merge sort (balance stability and performance)
    return 'merge';
  }

  /**
   * Checks whether a field has a small enough value domain for bucket sorting.
   */
  private static isSuitableForCountingSort<T extends object>(data: T[], field: SortField<T>): boolean {
    if (data.length === 0) return false;

    const values = new Set();
    let uniqueCount = 0;

    // Collect unique values, limit check count for performance
    const sampleSize = Math.min(data.length, 1000);
    for (let i = 0; i < sampleSize && uniqueCount < 50; i++) {
      const item = data[i];
      if (!item) {
        continue;
      }
      const value = getRecordValue(item, field);
      if (value !== null && value !== undefined) {
        if (!values.has(value)) {
          values.add(value);
          uniqueCount++;
        }
      }
    }

    // If unique values < 10% of total and below threshold, use counting sort
    return uniqueCount < Math.min(data.length * 0.1, QUERY.COUNTING_SORT_THRESHOLD);
  }

  /**
   * Sorts records by one or more fields.
   */
  static sort<T extends object>(
    data: T[],
    sortBy?: SortField<T> | SortField<T>[],
    order?: SortOrder | SortOrder[],
    algorithm?: SortAlgorithm
  ): T[] {
    if (!sortBy || data.length === 0) return data;

    // Select sorting algorithm
    const selectedAlgorithm = this.selectSortAlgorithm(algorithm, data, sortBy);
    const sortFunction = this.getSortFunction(selectedAlgorithm);

    if (Array.isArray(sortBy)) {
      const sortOrders: SortOrder[] = Array.isArray(order) ? order : new Array(sortBy.length).fill(order ?? 'asc');

      let sortedData = [...data];
      for (let i = sortBy.length - 1; i >= 0; i--) {
        const field = sortBy[i];
        if (field === undefined) {
          continue;
        }
        const fieldOrder = sortOrders[i] || 'asc';
        sortedData = sortFunction(sortedData, field, fieldOrder);
      }
      return sortedData;
    } else {
      const sortOrder = Array.isArray(order) ? order[0] : order || 'asc';
      return sortFunction(data, sortBy, sortOrder ?? 'asc');
    }
  }

  /**
   * Sums numeric values in a field.
   */
  static sum<T extends object>(data: T[], field: SortField<T>): number {
    return data.reduce((acc, item) => {
      const value = getRecordValue(item, field);
      return acc + (typeof value === 'number' ? value : 0);
    }, 0);
  }

  /**
   * Calculates the average of numeric field values.
   */
  static avg<T extends object>(data: T[], field: SortField<T>): number {
    if (data.length === 0) return 0;
    const sum = this.sum(data, field);
    return sum / data.length;
  }

  /**
   * Returns the greatest field value, or undefined for an empty collection.
   */
  static max<T extends object>(data: T[], field: SortField<T>): unknown {
    if (data.length === 0) return undefined;
    let maximum: unknown;
    for (const item of data) {
      const value = getRecordValue(item, field);
      if (maximum === undefined || compareValues(value, maximum) > 0) {
        maximum = value;
      }
    }
    return maximum;
  }

  /**
   * Returns the smallest field value, or undefined for an empty collection.
   */
  static min<T extends object>(data: T[], field: SortField<T>): unknown {
    if (data.length === 0) return undefined;
    let minimum: unknown;
    for (const item of data) {
      const value = getRecordValue(item, field);
      if (minimum === undefined || compareValues(value, minimum) < 0) {
        minimum = value;
      }
    }
    return minimum;
  }

  /**
   * Groups records by one or more fields.
   */
  static groupBy<T extends object>(data: T[], groupBy: SortField<T> | SortField<T>[]): Record<string, T[]> {
    const groups: Record<string, T[]> = Object.create(null) as Record<string, T[]>;
    const groupFields = Array.isArray(groupBy) ? groupBy : [groupBy];

    for (const item of data) {
      const key = groupFields.map(field => getRecordValue(item, field)).join('_');

      if (!Object.prototype.hasOwnProperty.call(groups, key)) {
        groups[key] = [];
      }

      groups[key].push(item);
    }

    return groups;
  }
}
