import type { ApiResponse } from '../../types/apiResponse';
import { StorageError } from '../../types/storageErrorInfc';
import logger from '../../utils/logger';

/** Formats storage and unexpected failures as API responses. */
export class ErrorHandler {
  handleError<T = unknown>(error: unknown, requestId: string, startTime: number, version: string): ApiResponse<T> {
    const endTime = Date.now();
    const duration = endTime - startTime;

    if (error instanceof StorageError) {
      return {
        success: false,
        data: undefined,
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

    logger.error(`[ApiWrapper] Unhandled error in request ${requestId}:`, error);

    return {
      success: false,
      data: undefined,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
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

  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
