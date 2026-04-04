/**
 * @module QueryEngine
 * @description Query engine for data filtering, sorting, pagination, and aggregation
 * @since 2025-11-28
 * @version 1.0.0
 */

import type { FilterCondition } from '../../types/storageTypes';
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

/**
 * Escapes special regex characters in a string
 */
const escapeRegExp = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Converts SQL LIKE pattern to RegExp
 * Compiles once for reuse across all items
 */
const likePatternToRegex = (pattern: string): RegExp => {
  const escaped = escapeRegExp(pattern);
  const regexPattern = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${regexPattern}$`, 'i');
};

/**
 * Pre-compiles all $like patterns in a filter condition
 */
const precompileLikePatterns = (condition: any): Map<string, RegExp> => {
  const patterns = new Map<string, RegExp>();
  if (!condition || typeof condition !== 'object') return patterns;

  const collectPatterns = (cond: any): void => {
    if (!cond || typeof cond !== 'object') return;
    if ('$and' in cond && Array.isArray(cond.$and)) {
      cond.$and.forEach(collectPatterns);
      return;
    }
    if ('$or' in cond && Array.isArray(cond.$or)) {
      cond.$or.forEach(collectPatterns);
      return;
    }
    for (const [, value] of Object.entries(cond)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [op, opValue] of Object.entries(value)) {
          if (op === '$like' && typeof opValue === 'string') {
            if (!patterns.has(opValue)) {
              patterns.set(opValue, likePatternToRegex(opValue));
            }
          }
        }
      }
    }
  };

  collectPatterns(condition);
  return patterns;
};

export class QueryEngine {
  private static filterWithDepth<T extends Record<string, any>>(
    data: T[],
    condition: any,
    depth: number,
    likePatterns?: Map<string, RegExp>
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

    if (typeof condition !== 'object' || condition === null) {
      return [];
    }

    if ('$and' in condition) {
      let result = [...data];
      for (const subCondition of condition.$and!) {
        result = this.filterWithDepth(result, subCondition, depth + 1);
      }
      return result;
    }

    if ('$or' in condition) {
      const results = new Set<T>();
      for (const subCondition of condition.$or!) {
        const filtered = this.filterWithDepth(data, subCondition, depth + 1);
        filtered.forEach(item => results.add(item));
      }
      return Array.from(results);
    }

    return data.filter(item => {
      let matches = true;

      for (const [key, value] of Object.entries(condition)) {
        const itemValue = item[key];

        // Operator condition
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          for (const [op, opValue] of Object.entries(value)) {
            switch (op) {
              case '$eq':
                // Processnull和undefined的特殊情况
                if (itemValue === null || itemValue === undefined) {
                  if (itemValue !== opValue) {
                    matches = false;
                  }
                } else if (itemValue !== opValue) {
                  matches = false;
                }
                break;
              case '$ne':
                // Processnull和undefined的特殊情况
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
                  // Use Set for performance
                  const opValueSet = new Set(opValue);
                  // Processnull和undefined的特殊情况
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
                  // Use Set for performance
                  const opValueSet = new Set(opValue);
                  // Processnull和undefined的特殊情况
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
                } else {
                  const regex = likePatterns?.get(opValue);
                  if (regex) {
                    if (!regex.test(itemValue)) {
                      matches = false;
                    }
                  } else {
                    const fallbackRegex = likePatternToRegex(opValue);
                    if (!fallbackRegex.test(itemValue)) {
                      matches = false;
                    }
                  }
                }
                break;
              default:
                matches = false;
            }

            if (!matches) break;
          }
        }
        // Simple value comparison
        else {
          // Processnull和undefined的特殊情况
          if (itemValue === null || itemValue === undefined) {
            if (itemValue !== value) {
              matches = false;
            }
          }
          // Process数组比较，使用JSON.stringify比较内容
          else if (Array.isArray(itemValue) && Array.isArray(value)) {
            if (JSON.stringify(itemValue) !== JSON.stringify(value)) {
              matches = false;
            }
          }
          // Ordinary value comparison
          else if (itemValue !== value) {
            matches = false;
          }
        }

        if (!matches) break;
      }

      return matches;
    });
  }

  static filter<T extends Record<string, any>>(data: T[], condition?: FilterCondition): T[] {
    const likePatterns = precompileLikePatterns(condition);
    return this.filterWithDepth(data, condition, 0, likePatterns);
  }

  static update<T extends Record<string, any>>(originalData: T, updateData: Record<string, any>): T {
    // Use centralized update operator handler
    return processUpdateOperators(originalData, updateData);
  }

  /**
   * 批量更新数据，支持更新操作符
   * 调整参数顺序：必需参数在前，可选参数在后
   */
  static bulkUpdate<T extends Record<string, any>>(
    data: T[],
    updateData: Record<string, any>,
    condition?: FilterCondition
  ): T[] {
    if (!updateData || Object.keys(updateData).length === 0) {
      return data;
    }

    const filteredData = condition ? this.filter(data, condition) : data;
    const updatedDataMap = new Map<string | number, T>();

    // Collect data mapping for update
    for (const item of filteredData) {
      updatedDataMap.set(item.id || item._id, item);
    }

    // Update数据
    return data.map(item => {
      const id = item.id || item._id;
      if (updatedDataMap.has(id)) {
        return this.update(item, updateData);
      }
      return item;
    });
  }

  /**
   * 分页处理，优化切片操作
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
   * 获取排序函数
   * 根据算法类型返回对应的排序函数
   */
  private static getSortFunction(algorithm: string = 'default'): Function {
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
   * 智能选择排序算法
   * 根据数据特征自动选择最合适的排序算法
   */
  private static selectSortAlgorithm(
    requestedAlgorithm: string | undefined,
    data: any[],
    sortBy: string | string[]
  ): string {
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

    // Check if适合计数排序（字段值范围有限）
    if (sortFields.length === 1 && sortFields[0] !== undefined && this.isSuitableForCountingSort(data, sortFields[0])) {
      return 'counting';
    }

    // Default to merge sort (balance stability and performance)
    return 'merge';
  }

  /**
   * 判断字段是否适合计数排序
   */
  private static isSuitableForCountingSort(data: any[], field: string): boolean {
    if (data.length === 0) return false;

    const values = new Set();
    let uniqueCount = 0;

    // Collect unique values, limit check count for performance
    const sampleSize = Math.min(data.length, 1000);
    for (let i = 0; i < sampleSize && uniqueCount < 50; i++) {
      const value = data[i][field];
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
   * 排序数据
   * 支持多种排序算法和多字段排序
   */
  static sort<T extends Record<string, any>>(
    data: T[],
    sortBy?: string | string[],
    order?: 'asc' | 'desc' | ('asc' | 'desc')[],
    algorithm?: string
  ): T[] {
    if (!sortBy || data.length === 0) return data;

    // Select sorting algorithm
    const selectedAlgorithm = this.selectSortAlgorithm(algorithm, data, sortBy);
    const sortFunction = this.getSortFunction(selectedAlgorithm);

    // Process多字段排序
    if (Array.isArray(sortBy)) {
      const sortOrders = Array.isArray(order) ? order : new Array(sortBy.length).fill(order || 'asc');

      // Recursive应用排序，从最后一个字段开始向前排序
      let sortedData = [...data];
      for (let i = sortBy.length - 1; i >= 0; i--) {
        const field = sortBy[i];
        const fieldOrder = sortOrders[i] || 'asc';
        sortedData = sortFunction(sortedData, field, fieldOrder);
      }
      return sortedData;
    } else {
      // Single field sort
      const sortOrder = Array.isArray(order) ? order[0] : order || 'asc';
      return sortFunction(data, sortBy, sortOrder);
    }
  }

  /**
   * 聚合查询，计算总和
   */
  static sum<T extends Record<string, any>>(data: T[], field: string): number {
    return data.reduce((acc, item) => {
      const value = item[field];
      return acc + (typeof value === 'number' ? value : 0);
    }, 0);
  }

  /**
   * 聚合查询，计算平均值
   */
  static avg<T extends Record<string, any>>(data: T[], field: string): number {
    if (data.length === 0) return 0;
    const sum = this.sum(data, field);
    return sum / data.length;
  }

  /**
   * 聚合查询，计算最大值
   */
  static max<T extends Record<string, any>>(data: T[], field: string): any {
    if (data.length === 0) return undefined;
    return data.reduce((max, item) => {
      const value = item[field];
      return max === undefined || value > max ? value : max;
    }, undefined);
  }

  /**
   * 聚合查询，计算最小值
   */
  static min<T extends Record<string, any>>(data: T[], field: string): any {
    if (data.length === 0) return undefined;
    return data.reduce((min, item) => {
      const value = item[field];
      return min === undefined || value < min ? value : min;
    }, undefined);
  }

  /**
   * 分组查询
   */
  static groupBy<T extends Record<string, any>>(data: T[], groupBy: string | string[]): Record<string, T[]> {
    const groups: Record<string, T[]> = {};
    const groupFields = Array.isArray(groupBy) ? groupBy : [groupBy];

    for (const item of data) {
      // Generate grouping key
      const key = groupFields.map(field => item[field]).join('_');

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(item);
    }

    return groups;
  }
}
