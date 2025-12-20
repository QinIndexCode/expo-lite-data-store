// src/core/query/QueryEngine.ts
// 查询引擎，支持数据过滤、排序、分页和聚合操作
// 创建于: 2025-11-28
// 最后修改: 2025-12-12

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

/**
 * 查询引擎类
 * 负责数据过滤、排序、分页和聚合操作
 * 支持多种查询操作符和智能排序算法选择
 */
export class QueryEngine {
  /**
   * 过滤数据，支持多种查询操作符
   */
  static filter<T extends Record<string, any>>(data: T[], condition?: FilterCondition): T[] {
    if (!condition) return data;

    // 函数条件
    if (typeof condition === 'function') {
      return data.filter(condition as (value: T, index: number, array: T[]) => unknown);
    }

    // 检查condition是否为对象，如果不是，返回空数组
    if (typeof condition !== 'object' || condition === null) {
      return [];
    }

    // 复合 AND 条件
    if ('$and' in condition) {
      let result = [...data];
      for (const subCondition of condition.$and!) {
        result = this.filter(result, subCondition);
      }
      return result;
    }

    // 复合 OR 条件
    if ('$or' in condition) {
      const results = new Set<T>();
      for (const subCondition of condition.$or!) {
        const filtered = this.filter(data, subCondition);
        filtered.forEach(item => results.add(item));
      }
      return Array.from(results);
    }

    // 简单条件
    return data.filter(item => {
      let matches = true;

      for (const [key, value] of Object.entries(condition)) {
        const itemValue = item[key];

        // 操作符条件
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          for (const [op, opValue] of Object.entries(value)) {
            switch (op) {
              case '$eq':
                // 处理null和undefined的特殊情况
                if (itemValue === null || itemValue === undefined) {
                  if (itemValue !== opValue) {
                    matches = false;
                  }
                } else if (itemValue !== opValue) {
                  matches = false;
                }
                break;
              case '$ne':
                // 处理null和undefined的特殊情况
                if (itemValue === null || itemValue === undefined) {
                  if (itemValue === opValue) {
                    matches = false;
                  }
                } else if (itemValue === opValue) {
                  matches = false;
                }
                break;
              case '$gt':
                if (typeof itemValue === 'number' && typeof opValue === 'number' && itemValue <= opValue) {
                  matches = false;
                }
                break;
              case '$gte':
                if (typeof itemValue === 'number' && typeof opValue === 'number' && itemValue < opValue) {
                  matches = false;
                }
                break;
              case '$lt':
                if (typeof itemValue === 'number' && typeof opValue === 'number' && itemValue >= opValue) {
                  matches = false;
                }
                break;
              case '$lte':
                if (typeof itemValue === 'number' && typeof opValue === 'number' && itemValue > opValue) {
                  matches = false;
                }
                break;
              case '$in':
                if (!Array.isArray(opValue)) {
                  matches = false;
                } else {
                  // 使用Set优化性能
                  const opValueSet = new Set(opValue);
                  // 处理null和undefined的特殊情况
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
                  // 使用Set优化性能
                  const opValueSet = new Set(opValue);
                  // 处理null和undefined的特殊情况
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
                  const pattern = opValue.replace(/%/g, '.*');
                  const regex = new RegExp(`^${pattern}$`, 'i');
                  if (!regex.test(itemValue)) {
                    matches = false;
                  }
                }
                break;
              default:
                matches = false;
            }

            if (!matches) break;
          }
        }
        // 简单值比较
        else {
          // 处理null和undefined的特殊情况
          if (itemValue === null || itemValue === undefined) {
            if (itemValue !== value) {
              matches = false;
            }
          } 
          // 处理数组比较，使用JSON.stringify比较内容
          else if (Array.isArray(itemValue) && Array.isArray(value)) {
            if (JSON.stringify(itemValue) !== JSON.stringify(value)) {
              matches = false;
            }
          }
          // 普通值比较
          else if (itemValue !== value) {
            matches = false;
          }
        }

        if (!matches) break;
      }

      return matches;
    });
  }

  /**
   * 处理更新操作符，如 $inc
   */
  static update<T extends Record<string, any>>(originalData: T, updateData: Record<string, any>): T {
    // 使用集中化的更新操作符处理函数
    return processUpdateOperators(originalData, updateData);
  }

  /**
   * 批量更新数据，支持更新操作符
   * 调整参数顺序：必需参数在前，可选参数在后
   */
  static bulkUpdate<T extends Record<string, any>>(data: T[], updateData: Record<string, any>, condition?: FilterCondition): T[] {
    if (!updateData || Object.keys(updateData).length === 0) {
      return data;
    }
    
    const filteredData = condition ? this.filter(data, condition) : data;
    const updatedDataMap = new Map<string | number, T>();
    
    // 收集需要更新的数据的映射
    for (const item of filteredData) {
      updatedDataMap.set(item.id || item._id, item);
    }
    
    // 更新数据
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
    // 优化：如果skip大于等于数据长度，直接返回空数组
    if (skip >= data.length) {
      return [];
    }

    // 优化：当limit为0时，返回空数组
    if (limit === 0) {
      logger.warn('Warning: limit=0 was passed to paginate, returning empty array as per convention');
      return [];
    }

    // 优化：计算实际需要的结束索引
    const startIndex = skip;
    const endIndex = limit !== undefined ? Math.min(startIndex + limit, data.length) : data.length;

    // 优化：如果startIndex为0且endIndex为数据长度，直接返回原数组
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
    // 如果用户指定了算法，直接使用
    if (requestedAlgorithm && requestedAlgorithm !== 'default') {
      return requestedAlgorithm;
    }

    // 智能选择算法
    const dataSize = data.length;
    const sortFields = Array.isArray(sortBy) ? sortBy : [sortBy];

    // 小数据集使用默认算法
    if (dataSize < QUERY.COUNTING_SORT_THRESHOLD) {
      return 'default';
    }

    // 大数据集使用归并排序（稳定且高效）
    if (dataSize > QUERY.MERGE_SORT_THRESHOLD) {
      return 'merge';
    }

    // 检查是否适合计数排序（字段值范围有限）
    if (sortFields.length === 1 && sortFields[0] !== undefined && this.isSuitableForCountingSort(data, sortFields[0])) {
      return 'counting';
    }

    // 默认使用归并排序（平衡稳定性和性能）
    return 'merge';
  }

  /**
   * 判断字段是否适合计数排序
   */
  private static isSuitableForCountingSort(data: any[], field: string): boolean {
    if (data.length === 0) return false;

    const values = new Set();
    let uniqueCount = 0;

    // 收集唯一值，限制检查数量以提高性能
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

    // 如果唯一值数量少于总数的10%，且绝对数量小于阈值，适合计数排序
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

    // 选择排序算法
    const selectedAlgorithm = this.selectSortAlgorithm(algorithm, data, sortBy);
    const sortFunction = this.getSortFunction(selectedAlgorithm);

    // 处理多字段排序
    if (Array.isArray(sortBy)) {
      const sortOrders = Array.isArray(order) ? order : new Array(sortBy.length).fill(order || 'asc');

      // 递归应用排序，从最后一个字段开始向前排序
      let sortedData = [...data];
      for (let i = sortBy.length - 1; i >= 0; i--) {
        const field = sortBy[i];
        const fieldOrder = sortOrders[i] || 'asc';
        sortedData = sortFunction(sortedData, field, fieldOrder);
      }
      return sortedData;
    } else {
      // 单字段排序
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
      // 生成分组键
      const key = groupFields.map(field => item[field]).join('_');

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(item);
    }

    return groups;
  }
}
