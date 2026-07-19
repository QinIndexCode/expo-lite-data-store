export enum ApiResponseStatus {
  SUCCESS = 'success',
  ERROR = 'error',
}

export interface ApiResponse<T = unknown> {
  success: boolean;

  data?: T;

  error?: {
    code: string;

    message: string;

    details?: string;

    suggestion?: string;

    cause?: unknown;
  };

  meta: {
    requestId: string;

    timestamp: number;

    version: string;

    duration?: number;

    /** Legacy alias for processing duration in milliseconds. */
    processingTime?: number;
  };

  status?: string;
}

export interface BulkApiResponse<T = unknown> extends ApiResponse {
  data: {
    successCount: number;

    failureCount: number;

    results: Array<{
      status: ApiResponseStatus;

      data?: T;

      error?: ApiResponse['error'];
    }>;
  };
}

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

export function createErrorResponse(
  error: {
    code: string;
    message: string;
    details?: string;
    suggestion?: string;
    cause?: unknown;
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

function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
