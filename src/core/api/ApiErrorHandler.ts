/**
 * @module ApiErrorHandler
 * @description Error handler providing unified error handling and response formatting
 * @since 2025-12-11
 * @version 1.0.0
 */

import { ApiResponse } from '../../types/apiResponse';
import { StorageError } from '../../types/storageErrorInfc';
import logger from '../../utils/logger';

/**
 * 错误处理器类
 * 负责统一的错误处理和响应格式化
 * 将各种错误转换为标准化的API响应格式
 */
export class ErrorHandler {
  /**
   * 处理错误并返回标准API响应
   * @param error 发生的错误
   * @param requestId 请求ID
   * @param startTime 请求开始时间
   * @param version API版本
   * @returns 标准API错误响应
   */
  handleError(error: any, requestId: string, startTime: number, version: string): ApiResponse {
    const endTime = Date.now();
    const duration = endTime - startTime;

    if (error instanceof StorageError) {
      // Store错误 - 返回结构化错误信息
      return {
        success: false,
        data: null,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          suggestion: error.suggestion,
        },
        meta: {
          requestId,
          timestamp: endTime,
          duration,
          version,
        },
        status: 'error',
      };
    }

    // Unknown error - return generic error
    logger.error(`[ApiWrapper] Unhandled error in request ${requestId}:`, error);

    return {
      success: false,
      data: null,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      meta: {
        requestId,
        timestamp: endTime,
        duration,
        version,
      },
      status: 'error',
    };
  }

  /**
   * 生成请求ID
   * @returns 唯一的请求ID
   */
  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
