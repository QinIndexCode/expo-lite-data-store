/**
 * @module ValidationWrapper
 * @description Validation wrapper for input data verification
 * @since 2025-12-03
 * @version 3.0.0
 */

import { StorageError } from '../../types/storageErrorInfc';
import type { StorageErrorCode } from '../../types/storageErrorCode';
import { assertValidTableName } from '../../utils/tableName';

export const API_INPUT_LIMITS = {
  maxWriteRecords: 1000,
  maxBulkOperations: 1000,
  maxBulkRecords: 1000,
  maxSerializedPayloadBytes: 5 * 1024 * 1024,
} as const;

/**
 * 验证包装器，负责输入数据验证
 */
export class ValidationWrapper {
  private assertSerializedPayloadSize(
    payload: unknown,
    label: string,
    invalidCode: StorageErrorCode,
    tooLargeCode: StorageErrorCode
  ): void {
    let serialized: string | undefined;

    try {
      serialized = JSON.stringify(payload);
    } catch (cause) {
      throw new StorageError(`${label} must be JSON-serializable`, invalidCode, { cause });
    }

    if (typeof serialized !== 'string') {
      throw new StorageError(`${label} must be JSON-serializable`, invalidCode);
    }

    const size = new TextEncoder().encode(serialized).byteLength;
    if (size > API_INPUT_LIMITS.maxSerializedPayloadBytes) {
      throw new StorageError(
        `${label} exceeds the ${API_INPUT_LIMITS.maxSerializedPayloadBytes}-byte limit`,
        tooLargeCode
      );
    }
  }

  /**
   * 验证表名
   * @param tableName 表名
   */
  validateTableName(tableName: string): void {
    assertValidTableName(tableName);
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

    if (items.length > API_INPUT_LIMITS.maxWriteRecords) {
      throw new StorageError(
        `Invalid data: write requests may contain at most ${API_INPUT_LIMITS.maxWriteRecords} records`,
        'FILE_CONTENT_TOO_MANY'
      );
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

    this.assertSerializedPayloadSize(data, 'Write data', 'FILE_CONTENT_INVALID', 'FILE_CONTENT_TOO_LARGE');
  }

  /** Validate optional create-table seed data while allowing an intentionally empty table. */
  validateInitialData(initialData: unknown): void {
    if (!Array.isArray(initialData)) {
      throw new StorageError('Invalid initial data: expected an array', 'FILE_CONTENT_INVALID');
    }

    if (initialData.length > 0) {
      this.validateWriteData(initialData);
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
    operations: Array<
      | {
          type: 'insert';
          data: Record<string, any> | Record<string, any>[];
        }
      | {
          type: 'update';
          data: Record<string, any>;
          where: Record<string, any>;
        }
      | {
          type: 'delete';
          where: Record<string, any>;
        }
    >
  ): number {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new StorageError('Invalid bulk operations: operations must be a non-empty array', 'BULK_OPERATION_FAILED');
    }

    if (operations.length > API_INPUT_LIMITS.maxBulkOperations) {
      throw new StorageError(
        `Invalid bulk operations: requests may contain at most ${API_INPUT_LIMITS.maxBulkOperations} operations`,
        'BULK_OPERATION_FAILED'
      );
    }

    let totalRecords = 0;

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

      if (op.type === 'insert' && !('data' in op)) {
        throw new StorageError(
          `Invalid insert operation at index ${i}: data is required for insert operations`,
          'BULK_OPERATION_FAILED'
        );
      }

      if (op.type === 'update' && (!('data' in op) || !('where' in op))) {
        throw new StorageError(
          `Invalid update operation at index ${i}: data and where are required for update operations`,
          'BULK_OPERATION_FAILED'
        );
      }

      if (op.type === 'delete' && !('where' in op)) {
        throw new StorageError(
          `Invalid delete operation at index ${i}: where is required for delete operations`,
          'BULK_OPERATION_FAILED'
        );
      }

      if (op.type === 'insert') {
        this.validateWriteData(op.data);
        totalRecords += Array.isArray(op.data) ? op.data.length : 1;
      } else if (op.type === 'update') {
        this.validateWriteData(op.data);
        this.validateFilter(op.where);
        totalRecords++;
      } else {
        this.validateFilter(op.where);
        totalRecords++;
      }

      if (totalRecords > API_INPUT_LIMITS.maxBulkRecords) {
        throw new StorageError(
          `Invalid bulk operations: requests may contain at most ${API_INPUT_LIMITS.maxBulkRecords} logical records`,
          'BULK_OPERATION_FAILED'
        );
      }
    }

    this.assertSerializedPayloadSize(operations, 'Bulk operations', 'BULK_OPERATION_FAILED', 'BULK_OPERATION_FAILED');
    return totalRecords;
  }
}
