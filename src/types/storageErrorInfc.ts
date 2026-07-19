import { StorageErrorCode } from './storageErrorCode';

export enum ErrorCategory {
  TABLE = 'table',
  FILE = 'file',
  QUERY = 'query',
  MIGRATION = 'migration',
  PERMISSION = 'permission',
  DISK = 'disk',
  DATA = 'data',
  TIMEOUT = 'timeout',
  TRANSACTION = 'transaction',
  UNKNOWN = 'unknown',
}

export class StorageError extends Error {
  public readonly category: ErrorCategory;

  public readonly details?: string;

  public readonly suggestion?: string;

  public readonly timestamp: number;

  public readonly cause?: Error;

  constructor(
    message: string,
    public readonly code: StorageErrorCode,
    options?: {
      cause?: unknown;
      details?: string;
      suggestion?: string;
      tableName?: string;
      operation?: string;
    }
  ) {
    super(message);
    this.name = 'StorageError';
    this.timestamp = Date.now();
    this.cause = options?.cause instanceof Error ? options.cause : undefined;
    this.details = options?.details;
    this.suggestion = options?.suggestion;
    this.category = this.getCategoryFromCode(code);
  }

  private getCategoryFromCode(code: StorageErrorCode): ErrorCategory {
    if (code.startsWith('TABLE_')) {
      return ErrorCategory.TABLE;
    } else if (code.startsWith('FILE_')) {
      return ErrorCategory.FILE;
    } else if (code === 'QUERY_FAILED') {
      return ErrorCategory.QUERY;
    } else if (code === 'MIGRATION_FAILED') {
      return ErrorCategory.MIGRATION;
    } else if (code === 'PERMISSION_DENIED' || code === 'AUTH_ON_ACCESS_UNSUPPORTED') {
      return ErrorCategory.PERMISSION;
    } else if (code === 'DISK_FULL') {
      return ErrorCategory.DISK;
    } else if (code === 'CORRUPTED_DATA' || code === 'DATA_INCOMPLETE') {
      return ErrorCategory.DATA;
    } else if (code === 'TIMEOUT') {
      return ErrorCategory.TIMEOUT;
    } else if (code.startsWith('TRANSACTION_') || code === 'NO_TRANSACTION_IN_PROGRESS') {
      return ErrorCategory.TRANSACTION;
    } else {
      return ErrorCategory.UNKNOWN;
    }
  }

  toJSON(): object {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      details: this.details,
      suggestion: this.suggestion,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}
