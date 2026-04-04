/**
 * @module apiResponse
 * @description Unified API response format definitions
 * @since 2025-11-19
 * @version 1.0.0
 */

/**
 * API response status enum
 */
export enum ApiResponseStatus {
  SUCCESS = 'success',
  ERROR = 'error',
}

/**
 * API response interface
 */
export interface ApiResponse<T = any> {
  /**
   * Whether the operation succeeded
   */
  success: boolean;

  /**
   * Response data (returned on success)
   */
  data?: T;

  /**
   * Error information (returned on failure)
   */
  error?: {
    /**
     * Error code
     */
    code: string;

    /**
     * Error message
     */
    message: string;

    /**
     * Error details
     */
    details?: string;

    /**
     * Suggested resolution
     */
    suggestion?: string;

    /**
     * Original error
     */
    cause?: any;
  };

  /**
   * Response metadata
   */
  meta: {
    /**
     * Request ID
     */
    requestId: string;

    /**
     * Response timestamp
     */
    timestamp: number;

    /**
     * API version
     */
    version: string;

    /**
     * Processing time in milliseconds
     */
    duration?: number;

    /**
     * Processing time in milliseconds - legacy compatibility
     */
    processingTime?: number;
  };

  /**
   * Response status (string format)
   */
  status?: string;
}

/**
 * Bulk operation response interface
 */
export interface BulkApiResponse<T = any> extends ApiResponse {
  /**
   * Bulk operation results
   */
  data: {
    /**
     * Number of successful operations
     */
    successCount: number;

    /**
     * Number of failed operations
     */
    failureCount: number;

    /**
     * List of operation results
     */
    results: Array<{
      /**
       * Operation status
       */
      status: ApiResponseStatus;

      /**
       * Operation data
       */
      data?: T;

      /**
       * Operation error
       */
      error?: ApiResponse['error'];
    }>;
  };
}

/**
 * Create a success response
 * @param data Response data
 * @param options Response options
 * @returns Success response object
 */
export function createSuccessResponse<T>(
  data: T,
  options?: {
    requestId?: string;
    processingTime?: number;
  }
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      requestId: options?.requestId || generateRequestId(),
      timestamp: Date.now(),
      version: '1.0.0',
      duration: options?.processingTime,
    },
    status: 'success',
  };
}

/**
 * Create an error response
 * @param error Error information
 * @param options Response options
 * @returns Error response object
 */
export function createErrorResponse(
  error: {
    code: string;
    message: string;
    details?: string;
    suggestion?: string;
    cause?: any;
  },
  options?: {
    requestId?: string;
    processingTime?: number;
  }
): ApiResponse {
  return {
    success: false,
    data: null,
    error,
    meta: {
      requestId: options?.requestId || generateRequestId(),
      timestamp: Date.now(),
      version: '1.0.0',
      duration: options?.processingTime,
    },
    status: 'error',
  };
}

/**
 * Generate a request ID
 * @returns Request ID
 */
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
