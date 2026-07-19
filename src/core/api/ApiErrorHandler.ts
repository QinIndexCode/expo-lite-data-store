import type { ApiResponse } from '../../types/apiResponse';
import { StorageError } from '../../types/storageErrorInfc';
import logger from '../../utils/logger';

/** Converts storage and unexpected failures into API responses without exposing internal details in production. */
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

  /** Creates a request identifier for correlating API responses with logs. */
  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
