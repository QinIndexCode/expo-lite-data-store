import { StorageErrorCode } from './storageErrorCode.js';

/**
 * 错误分类枚举
 */
export enum ErrorCategory {
  TABLE = 'table',
  FILE = 'file',
  QUERY = 'query',
  MIGRATION = 'migration',
  PERMISSION = 'permission',
  DISK = 'disk',
  DATA = 'data',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

/**
 * 存储错误类，提供详细的错误信息和建议
 */
export class StorageError extends Error {
  /**
   * 错误分类
   */
  public readonly category: ErrorCategory;

  /**
   * 错误详情
   */
  public readonly details?: string;

  /**
   * 解决建议
   */
  public readonly suggestion?: string;

  /**
   * 错误发生时间
   */
  public readonly timestamp: number;

  /**
   * 原始错误原因
   */
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

  /**
   * 根据错误码获取错误分类
   */
  private getCategoryFromCode(code: StorageErrorCode): ErrorCategory {
    if (code.startsWith('TABLE_')) {
      return ErrorCategory.TABLE;
    } else if (code.startsWith('FILE_')) {
      return ErrorCategory.FILE;
    } else if (code === 'QUERY_FAILED') {
      return ErrorCategory.QUERY;
    } else if (code === 'MIGRATION_FAILED') {
      return ErrorCategory.MIGRATION;
    } else if (code === 'PERMISSION_DENIED') {
      return ErrorCategory.PERMISSION;
    } else if (code === 'DISK_FULL') {
      return ErrorCategory.DISK;
    } else if (code === 'CORRUPTED_DATA' || code === 'DATA_INCOMPLETE') {
      return ErrorCategory.DATA;
    } else if (code === 'TIMEOUT') {
      return ErrorCategory.TIMEOUT;
    } else {
      return ErrorCategory.UNKNOWN;
    }
  }

  /**
   * 转换为JSON格式，便于日志记录
   */
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
