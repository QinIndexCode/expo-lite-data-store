// src/utils/errorHandler.ts
import { StorageErrorCode } from '../types/storageErrorCode';
import { StorageError } from '../types/storageErrorInfc';
import logger from './logger';

/**
 * 错误处理工具类，提供统一的错误创建和处理方法
 */
export class ErrorHandler {
  /**
   * 创建表相关错误
   * @param operation 操作类型（create、delete、update、read等）
   * @param tableName 表名
   * @param cause 原始错误（可选）
   * @param details 详细错误信息（可选）
   * @returns StorageError 格式化后的存储错误对象
   */
  static createTableError(operation: string, tableName: string, cause?: unknown, details?: string): StorageError {
    // 在测试和开发环境打印底层错误，便于排查表创建/删除问题
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      logger.error(`[ErrorHandler][createTableError] operation=${operation}, table=${tableName}, cause=`, cause);
    }
    return new StorageError(
      `${operation} table ${tableName} failed`,
      `TABLE_${operation.toUpperCase()}_FAILED` as StorageErrorCode,
      {
        cause,
        details: details || `Failed to ${operation} table: ${tableName}`,
        suggestion: ErrorHandler.getTableErrorSuggestion(operation),
      }
    );
  }

  /**
   * 创建文件相关错误
   * @param operation 操作类型（write、read、delete、move等）
   * @param resource 资源路径或名称
   * @param cause 原始错误（可选）
   * @param details 详细错误信息（可选）
   * @returns StorageError 格式化后的存储错误对象
   */
  static createFileError(operation: string, resource: string, cause?: unknown, details?: string): StorageError {
    return new StorageError(
      `${operation} ${resource} failed`,
      `FILE_${operation.toUpperCase()}_FAILED` as StorageErrorCode,
      {
        cause,
        details: details || `Failed to ${operation} ${resource}`,
        suggestion: ErrorHandler.getFileErrorSuggestion(operation),
      }
    );
  }

  /**
   * 创建查询相关错误
   * @param operation 操作类型（findOne、findMany等）
   * @param tableName 表名
   * @param cause 原始错误（可选）
   * @param details 详细错误信息（可选）
   * @returns StorageError 格式化后的存储错误对象
   */
  static createQueryError(operation: string, tableName: string, cause?: unknown, details?: string): StorageError {
    return new StorageError(`${operation} in table ${tableName} failed`, 'QUERY_FAILED', {
      cause,
      details: details || `Failed to ${operation} in table: ${tableName}`,
      suggestion: 'Check if your query syntax is correct and the table exists',
    });
  }

  /**
   * 创建事务相关错误
   * @param operation 操作类型（begin、commit、rollback等）
   * @param cause 原始错误（可选）
   * @param details 详细错误信息（可选）
   * @returns StorageError 格式化后的存储错误对象
   */
  static createTransactionError(operation: string, cause?: unknown, details?: string): StorageError {
    return new StorageError(
      `${operation} transaction failed`,
      `TRANSACTION_${operation.toUpperCase()}_FAILED` as StorageErrorCode,
      {
        cause,
        details: details || `Failed to ${operation} transaction`,
        suggestion: ErrorHandler.getTransactionErrorSuggestion(operation),
      }
    );
  }

  /**
   * 创建通用错误
   * @param message 错误消息
   * @param code 错误代码
   * @param cause 原始错误（可选）
   * @param details 详细错误信息（可选）
   * @param suggestion 错误解决建议（可选）
   * @returns StorageError 格式化后的存储错误对象
   */
  static createGeneralError(
    message: string,
    code: StorageErrorCode,
    cause?: unknown,
    details?: string,
    suggestion?: string
  ): StorageError {
    return new StorageError(message, code, {
      cause,
      details,
      suggestion,
    });
  }

  /**
   * 获取表操作错误的建议
   * @param operation 操作类型
   * @returns string 错误解决建议
   */
  private static getTableErrorSuggestion(operation: string): string {
    switch (operation.toLowerCase()) {
      case 'create':
        return 'Check if the table name is valid and you have write permissions';
      case 'delete':
        return 'Check if the table exists and you have write permissions';
      case 'update':
        return 'Check if the table exists and the update data is valid';
      case 'read':
        return 'Check if the table exists and you have read permissions';
      default:
        return 'Check if you have the necessary permissions and the table is accessible';
    }
  }

  /**
   * 获取文件操作错误的建议
   * @param operation 操作类型
   * @returns string 错误解决建议
   */
  private static getFileErrorSuggestion(operation: string): string {
    switch (operation.toLowerCase()) {
      case 'write':
        return 'Check if you have write permissions and the disk is not full';
      case 'read':
        return 'Check if the file exists and you have read permissions';
      case 'delete':
        return 'Check if the file exists and you have write permissions';
      case 'move':
      case 'copy':
      case 'rename':
        return 'Check if you have write permissions on both source and destination';
      default:
        return 'Check if you have the necessary permissions and the file is accessible';
    }
  }

  /**
   * 获取事务操作错误的建议
   * @param operation 操作类型
   * @returns string 错误解决建议
   */
  private static getTransactionErrorSuggestion(operation: string): string {
    switch (operation.toLowerCase()) {
      case 'begin':
        return 'Check if there is already an active transaction';
      case 'commit':
        return 'Check if all operations in the transaction are valid and you have write permissions';
      case 'rollback':
        return 'Check if there is an active transaction to rollback';
      default:
        return 'Check if the transaction is in a valid state';
    }
  }

  /**
   * 处理异步操作错误，确保所有异步操作都返回统一的错误格式
   * @param operation 异步操作函数
   * @param errorCreator 错误创建函数
   * @returns Promise<T> 操作结果
   * @throws StorageError 格式化后的存储错误
   */
  static async handleAsyncError<T>(
    operation: () => Promise<T>,
    errorCreator: (cause: unknown) => StorageError
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw errorCreator(error);
    }
  }

  /**
   * 处理同步操作错误，确保所有同步操作都返回统一的错误格式
   * @param operation 同步操作函数
   * @param errorCreator 错误创建函数
   * @returns T 操作结果
   * @throws StorageError 格式化后的存储错误
   */
  static handleSyncError<T>(operation: () => T, errorCreator: (cause: unknown) => StorageError): T {
    try {
      return operation();
    } catch (error) {
      throw errorCreator(error);
    }
  }

  /**
   * 格式化错误信息，使其更易读
   * @param error 错误对象
   * @returns string 格式化后的错误字符串
   */
  static formatError(error: unknown): string {
    if (error instanceof StorageError) {
      return (
        `${error.name}: ${error.message}\n` +
        `Code: ${error.code}\n` +
        `Category: ${error.category}\n` +
        (error.details ? `Details: ${error.details}\n` : '') +
        (error.suggestion ? `Suggestion: ${error.suggestion}\n` : '') +
        (error.stack ? `Stack: ${error.stack}` : '')
      );
    } else if (error instanceof Error) {
      return `${error.name}: ${error.message}\nStack: ${error.stack}`;
    } else {
      return `Unknown error: ${String(error)}`;
    }
  }
}
