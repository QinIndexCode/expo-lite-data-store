// src/utils/specialOperators.ts
// 集中管理所有特殊操作符的定义和处理
// 创建于: 2025-12-12

/**
 * 查询操作符类型定义
 */
export type QueryOperator = 
  | '$and' 
  | '$or' 
  | '$eq' 
  | '$ne' 
  | '$gt' 
  | '$gte' 
  | '$lt' 
  | '$lte' 
  | '$in' 
  | '$nin' 
  | '$like';

/**
 * 更新操作符类型定义
 */
export type UpdateOperator = 
  | '$inc' 
  | '$set' 
  | '$unset' 
  | '$push' 
  | '$pull' 
  | '$addToSet';

/**
 * 所有特殊操作符的集合
 */
export const SPECIAL_OPERATORS = {
  // 查询操作符
  QUERY: {
    '$and': true,
    '$or': true,
    '$eq': true,
    '$ne': true,
    '$gt': true,
    '$gte': true,
    '$lt': true,
    '$lte': true,
    '$in': true,
    '$nin': true,
    '$like': true
  },
  // 更新操作符
  UPDATE: {
    '$inc': true,
    '$set': true,
    '$unset': true,
    '$push': true,
    '$pull': true,
    '$addToSet': true
  }
};

/**
 * 检查是否为查询操作符
 */
export function isQueryOperator(key: string): key is QueryOperator {
  return key in SPECIAL_OPERATORS.QUERY;
}

/**
 * 检查是否为更新操作符
 */
export function isUpdateOperator(key: string): key is UpdateOperator {
  return key in SPECIAL_OPERATORS.UPDATE;
}

/**
 * 检查是否为任何特殊操作符
 */
export function isSpecialOperator(key: string): boolean {
  return isQueryOperator(key) || isUpdateOperator(key);
}

/**
 * 更新数据类型定义
 */
export type UpdateData = Record<string, any> | {
  $inc?: Record<string, number>;
  $set?: Record<string, any>;
  $unset?: string[];
  $push?: Record<string, any>;
  $pull?: Record<string, any>;
  $addToSet?: Record<string, any>;
  [key: string]: any;
};

/**
 * 分离普通更新字段和特殊操作符
 */
export function separateUpdateOperators(updateData: UpdateData): {
  regularFields: Record<string, any>;
  operators: Partial<Record<UpdateOperator, any>>;
} {
  const regularFields: Record<string, any> = {};
  const operators: Partial<Record<UpdateOperator, any>> = {};

  for (const [key, value] of Object.entries(updateData)) {
    if (isUpdateOperator(key)) {
      operators[key] = value;
    } else {
      regularFields[key] = value;
    }
  }

  return { regularFields, operators };
}

/**
 * 处理更新操作符，返回更新后的数据
 * @param originalData 原始数据
 * @param updateData 更新数据，包含普通字段和/或特殊操作符
 * @returns 更新后的数据
 */
export function processUpdateOperators<T extends Record<string, any>>(originalData: T, updateData: UpdateData): T {
  // 创建一个新对象，避免直接修改原始数据
  const result: Record<string, any> = { ...originalData };
  const { regularFields, operators } = separateUpdateOperators(updateData);

  // 处理特殊操作符
  if (operators.$inc) {
    for (const [field, increment] of Object.entries(operators.$inc)) {
      if (typeof increment === 'number') {
        const currentValue = typeof result[field] === 'number' ? result[field] : 0;
        result[field] = currentValue + increment;
      }
    }
  }

  if (operators.$set) {
    for (const [field, value] of Object.entries(operators.$set)) {
      result[field] = value;
    }
  }

  if (operators.$unset) {
    if (Array.isArray(operators.$unset)) {
      for (const field of operators.$unset) {
        delete result[field];
      }
    }
  }

  if (operators.$push) {
    for (const [field, value] of Object.entries(operators.$push)) {
      if (!Array.isArray(result[field])) {
        result[field] = [];
      }
      result[field].push(value);
    }
  }

  if (operators.$pull) {
    for (const [field, condition] of Object.entries(operators.$pull)) {
      if (Array.isArray(result[field])) {
        result[field] = result[field].filter(item => {
          // 简单值比较
          if (typeof condition !== 'object' || condition === null) {
            return item !== condition;
          }
          // 对象条件比较
          for (const [key, val] of Object.entries(condition)) {
            if (item[key] === val) {
              return false;
            }
          }
          return true;
        });
      }
    }
  }

  if (operators.$addToSet) {
    for (const [field, value] of Object.entries(operators.$addToSet)) {
      if (!Array.isArray(result[field])) {
        result[field] = [];
      }
      if (!result[field].includes(value)) {
        result[field].push(value);
      }
    }
  }

  // 处理普通字段更新
  for (const [field, value] of Object.entries(regularFields)) {
    result[field] = value;
  }

  return result as T;
}
