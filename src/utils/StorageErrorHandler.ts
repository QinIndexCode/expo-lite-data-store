import { StorageErrorCode } from '../types/storageErrorCode';
import { StorageError } from '../types/storageErrorInfc';
import logger from './logger';

/**
 * Creates and normalizes storage errors across public operations.
 */
export class ErrorHandler {
  static createTableError(operation: string, tableName: string, cause?: unknown, details?: string): StorageError {
    // Development logs retain the original cause before callers receive a normalized error.
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

  static createQueryError(operation: string, tableName: string, cause?: unknown, details?: string): StorageError {
    return new StorageError(`${operation} in table ${tableName} failed`, 'QUERY_FAILED', {
      cause,
      details: details || `Failed to ${operation} in table: ${tableName}`,
      suggestion: 'Check if your query syntax is correct and the table exists',
    });
  }

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

  /** Preserves StorageError instances and normalizes other asynchronous failures. */
  static async handleAsyncError<T>(
    operation: () => Promise<T>,
    errorCreator: (cause: unknown) => StorageError
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw errorCreator(error);
    }
  }

  /** Preserves StorageError instances and normalizes other synchronous failures. */
  static handleSyncError<T>(operation: () => T, errorCreator: (cause: unknown) => StorageError): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw errorCreator(error);
    }
  }

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
