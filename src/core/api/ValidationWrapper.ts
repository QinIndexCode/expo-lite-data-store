// src/core/api/ValidationWrapper.ts
// 验证包装器类，负责输入数据验证
// 创建于: 2025-12-03
// 最后修改: 2025-12-11

import { StorageError } from '../../types/storageErrorInfc';
import { FILE_OPERATION, REGEX } from '../constants';

/**
 * 验证包装器，负责输入数据验证
 */
export class ValidationWrapper {
  /**
   * 验证表名
   * @param tableName 表名
   */
  validateTableName(tableName: string): void {
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new StorageError('Invalid table name: table name cannot be empty', 'TABLE_NAME_INVALID');
    }

    if (tableName.length > FILE_OPERATION.MAX_TABLE_NAME_LENGTH) {
      throw new StorageError(
        `Invalid table name: table name too long (max ${FILE_OPERATION.MAX_TABLE_NAME_LENGTH} characters)`,
        'TABLE_NAME_INVALID'
      );
    }

    if (!REGEX.TABLE_NAME.test(tableName)) {
      throw new StorageError(
        'Invalid table name: table name must start with a letter and contain only letters, numbers, and underscores',
        'TABLE_NAME_INVALID'
      );
    }
  }

  /**
   * 验证写入数据
   * @param data 要验证的数据
   */
  validateWriteData(data: Record<string, any> | Record<string, any>[]): void {
    const items = Array.isArray(data) ? data : [data];

    if (items.length === 0) {
      throw new StorageError('Invalid data: no data to write', 'FILE_CONTENT_INVALID');
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new StorageError(
          `Invalid data item at index ${i}: expected object, received ${typeof item}`,
          'FILE_CONTENT_INVALID'
        );
      }

      if (Object.keys(item).length === 0) {
        throw new StorageError(`Invalid data item at index ${i}: empty object`, 'FILE_CONTENT_INVALID');
      }
    }
  }

  /**
   * 验证过滤条件
   * @param filter 过滤条件
   */
  validateFilter(filter: Record<string, any>): void {
    if (typeof filter !== 'object' || filter === null) {
      throw new StorageError('Invalid filter condition: filter must be an object', 'QUERY_FAILED');
    }

    if (Object.keys(filter).length === 0) {
      throw new StorageError('Invalid filter condition: empty filter condition', 'QUERY_FAILED');
    }
  }

  /**
   * 验证批量操作
   * @param operations 批量操作数组
   */
  validateBulkOperations(
    operations: Array<{
      type: 'insert' | 'update' | 'delete';
      data?: Record<string, any>;
      filter?: Record<string, any>;
    }>
  ): void {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new StorageError('Invalid bulk operations: operations must be a non-empty array', 'BULK_OPERATION_FAILED');
    }

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];

      if (typeof op !== 'object' || op === null) {
        throw new StorageError(`Invalid operation at index ${i}: operation must be an object`, 'BULK_OPERATION_FAILED');
      }

      if (!['insert', 'update', 'delete'].includes(op.type)) {
        throw new StorageError(
          `Invalid operation type at index ${i}: operation type must be 'insert', 'update', or 'delete'`,
          'BULK_OPERATION_FAILED'
        );
      }

      if (op.type === 'insert' && !op.data) {
        throw new StorageError(
          `Invalid insert operation at index ${i}: data is required for insert operations`,
          'BULK_OPERATION_FAILED'
        );
      }

      if ((op.type === 'update' || op.type === 'delete') && !op.filter) {
        throw new StorageError(
          `Invalid ${op.type} operation at index ${i}: filter is required for ${op.type} operations`,
          'BULK_OPERATION_FAILED'
        );
      }
    }
  }
}
