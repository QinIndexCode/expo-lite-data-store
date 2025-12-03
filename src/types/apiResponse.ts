// src/types/apiResponse.ts
// 统一API响应格式定义

/**
 * API响应状态枚举
 */
export enum ApiResponseStatus {
    SUCCESS = "success",
    ERROR = "error"
}

/**
 * API响应格式接口
 */
export interface ApiResponse<T = any> {
    /**
     * 操作是否成功
     */
    success: boolean;

    /**
     * 响应数据（成功时返回）
     */
    data?: T;

    /**
     * 错误信息（失败时返回）
     */
    error?: {
        /**
         * 错误码
         */
        code: string;

        /**
         * 错误消息
         */
        message: string;

        /**
         * 错误详情
         */
        details?: string;

        /**
         * 错误建议
         */
        suggestion?: string;

        /**
         * 原始错误
         */
        cause?: any;
    };

    /**
     * 响应元数据
     */
    meta: {
        /**
         * 请求ID
         */
        requestId: string;

        /**
         * 响应时间戳
         */
        timestamp: number;

        /**
         * API版本
         */
        version: string;

        /**
         * 处理时间（毫秒）
         */
        duration?: number;

        /**
         * 处理时间（毫秒）- 兼容旧版本
         */
        processingTime?: number;
    };

    /**
     * 响应状态（字符串格式）
     */
    status?: string;
}

/**
 * 批量操作响应格式接口
 */
export interface BulkApiResponse<T = any> extends ApiResponse {
    /**
     * 批量操作结果
     */
    data: {
        /**
         * 成功的操作数
         */
        successCount: number;
        
        /**
         * 失败的操作数
         */
        failureCount: number;
        
        /**
         * 操作结果列表
         */
        results: Array<{
            /**
             * 操作状态
             */
            status: ApiResponseStatus;
            
            /**
             * 操作数据
             */
            data?: T;
            
            /**
             * 操作错误
             */
            error?: ApiResponse['error'];
        }>;
    };
}

/**
 * 创建成功响应
 * @param data 响应数据
 * @param options 响应选项
 * @returns 成功响应对象
 */
export function createSuccessResponse<T>(data: T, options?: {
    requestId?: string;
    processingTime?: number;
}): ApiResponse<T> {
    return {
        success: true,
        data,
        meta: {
            requestId: options?.requestId || generateRequestId(),
            timestamp: Date.now(),
            version: "1.0.0",
            duration: options?.processingTime
        },
        status: "success"
    };
}

/**
 * 创建错误响应
 * @param error 错误信息
 * @param options 响应选项
 * @returns 错误响应对象
 */
export function createErrorResponse(error: {
    code: string;
    message: string;
    details?: string;
    suggestion?: string;
    cause?: any;
}, options?: {
    requestId?: string;
    processingTime?: number;
}): ApiResponse {
    return {
        success: false,
        data: null,
        error,
        meta: {
            requestId: options?.requestId || generateRequestId(),
            timestamp: Date.now(),
            version: "1.0.0",
            duration: options?.processingTime
        },
        status: "error"
    };
}

/**
 * 生成请求ID
 * @returns 请求ID
 */
function generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
