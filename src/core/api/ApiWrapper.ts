// src/core/api/ApiWrapper.ts
// API包装器，使用外观模式协调各个组件

import { ApiResponse } from "../../types/apiResponse.js";
import { StorageAdapterInfc } from "../../types/storageAdapterInfc.js";
import type {
    CreateTableOptions,
    ReadOptions,
    WriteOptions,
    WriteResult
} from "../../types/storageTypes";
import { ApiRouter } from "./ApiRouter.js";
import { ErrorHandler } from "./ErrorHandler.js";
import { RateLimitWrapper } from "./RateLimitWrapper.js";
import { ValidationWrapper } from "./ValidationWrapper.js";

/**
 * API包装器类 - 外观模式
 * 协调各个组件提供统一的API接口
 */
export class ApiWrapper {
    private apiRouter: ApiRouter;
    private rateLimitWrapper: RateLimitWrapper;
    private validationWrapper: ValidationWrapper;
    private errorHandler: ErrorHandler;
    private storageAdapter: StorageAdapterInfc;

    /**
     * 构造函数
     * @param storageAdapter 存储适配器实例
     * @param options API配置选项
     */
    constructor(
        storageAdapter: StorageAdapterInfc,
        options: {
            defaultVersion?: string;
            supportedVersions?: string[];
            rateLimit?: {
                rate?: number;
                capacity?: number;
                enabled?: boolean;
            };
        } = {}
    ) {
        this.storageAdapter = storageAdapter;

        // 初始化各个组件
        this.apiRouter = new ApiRouter({
            defaultVersion: options.defaultVersion,
            supportedVersions: options.supportedVersions
        });

        this.rateLimitWrapper = new RateLimitWrapper(options.rateLimit);
        this.validationWrapper = new ValidationWrapper();
        this.errorHandler = new ErrorHandler();
    }

    /**
     * 创建表
     * @param tableName 表名
     * @param options 创建表选项
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async createTable(
        tableName: string,
        options?: CreateTableOptions & {
            columns?: Record<string, string>;
            initialData?: Record<string, any>[];
            mode?: "single" | "chunked";
        },
        version?: string,
        clientId: string = "default"
    ): Promise<ApiResponse<void>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);

        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 5); // 创建表消耗5个令牌
            if (!rateLimitStatus.allowed) {
                return this.errorHandler.handleError(
                    {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    requestId,
                    startTime,
                    apiVersion
                );
            }

            // 请求验证
            this.validationWrapper.validateTableName(tableName);

            await this.storageAdapter.createTable(tableName, options);

            return {
                success: true,
                data: undefined,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 删除表
     * @param tableName 表名
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async deleteTable(tableName: string, version?: string, clientId: string = "default"): Promise<ApiResponse<void>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);

        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 3); // 删除表消耗3个令牌
            if (!rateLimitStatus.allowed) {
                return this.errorHandler.handleError(
                    {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    requestId,
                    startTime,
                    apiVersion
                );
            }

            // 请求验证
            this.validationWrapper.validateTableName(tableName);

            await this.storageAdapter.deleteTable(tableName);

            return {
                success: true,
                data: undefined,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 判断表是否存在
     * @param tableName 表名
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async hasTable(tableName: string, version?: string, clientId: string = "default"): Promise<ApiResponse<boolean>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 1); // 检查表存在性消耗1个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                    data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            
            const result = await this.storageAdapter.hasTable(tableName);
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 列出所有表名
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async listTables(version?: string, clientId: string = "default"): Promise<ApiResponse<string[]>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 2); // 列出表消耗2个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            const result = await this.storageAdapter.listTables();
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 写入数据
     * @param tableName 表名
     * @param data 要写入的数据
     * @param options 写入选项
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async write(
        tableName: string,
        data: Record<string, any> | Record<string, any>[],
        options?: WriteOptions,
        version?: string,
        clientId: string = "default"
    ): Promise<ApiResponse<WriteResult>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const tokens = Array.isArray(data) ? Math.min(data.length, 10) : 3; // 写入操作消耗3-10个令牌
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, tokens);
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            this.validationWrapper.validateWriteData(data);
            
            const result = await this.storageAdapter.write(tableName, data, options);
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 读取数据
     * @param tableName 表名
     * @param options 读取选项
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async read(
        tableName: string,
        options?: ReadOptions,
        version?: string,
        clientId: string = "default"
    ): Promise<ApiResponse<Record<string, any>[]>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 2); // 读取操作消耗2个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            
            const result = await this.storageAdapter.read(tableName, options);
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 获取表记录数
     * @param tableName 表名
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async count(tableName: string, version?: string, clientId: string = "default"): Promise<ApiResponse<number>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 1); // 计数操作消耗1个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                    data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            
            const result = await this.storageAdapter.count(tableName);
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 查找单条记录
     * @param tableName 表名
     * @param filter 过滤条件
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async findOne(
        tableName: string,
        filter: Record<string, any>,
        version?: string,
        clientId: string = "default"
    ): Promise<ApiResponse<Record<string, any> | null>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 1); // 查找单条记录消耗1个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                data: null,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            this.validationWrapper.validateFilter(filter);
            
            const result = await this.storageAdapter.findOne(tableName, filter);
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 查找多条记录
     * @param tableName 表名
     * @param filter 过滤条件
     * @param options 选项
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async findMany(
        tableName: string,
        filter?: Record<string, any>,
        options?: { skip?: number; limit?: number },
        version?: string,
        clientId: string = "default"
    ): Promise<ApiResponse<Record<string, any>[]>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 2); // 查找多条记录消耗2个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            if (filter) {
                this.validationWrapper.validateFilter(filter);
            }
            
            const result = await this.storageAdapter.findMany(tableName, filter, options);
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 批量操作
     * @param tableName 表名
     * @param operations 操作数组
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async bulkWrite(
        tableName: string,
        operations: Array<{
            type: "insert" | "update" | "delete";
            data: Record<string, any> | Record<string, any>[];
        }>,
        version?: string,
        clientId: string = "default"
    ): Promise<ApiResponse<WriteResult>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const totalOperations = operations.reduce((count, op) => {
                return count + (Array.isArray(op.data) ? op.data.length : 1);
            }, 0);
            const tokens = Math.min(totalOperations * 2, 20); // 批量操作消耗2-20个令牌
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, tokens);
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            this.validationWrapper.validateBulkOperations(operations);
            
            const result = await this.storageAdapter.bulkWrite(tableName, operations);
            
            return {
                success: true,
                data: result,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 迁移到分片模式
     * @param tableName 表名
     * @param version API版本
     * @param clientId 客户端ID，用于限流
     * @returns 统一格式的API响应
     */
    async migrateToChunked(tableName: string, version?: string, clientId: string = "default"): Promise<ApiResponse<void>> {
        const startTime = Date.now();
        const requestId = this.errorHandler.generateRequestId();
        const apiVersion = this.apiRouter.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 10); // 迁移操作消耗10个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    success: false,
                data: undefined,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
                };
            }
            
            // 请求验证
            this.validationWrapper.validateTableName(tableName);
            
            await this.storageAdapter.migrateToChunked(tableName);
            
            return {
                success: true,
                data: undefined,
                error: undefined,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    duration: Date.now() - startTime,
                    version: apiVersion
                },
                status: "success"
            };
        } catch (error) {
            return this.errorHandler.handleError(error, requestId, startTime, apiVersion);
        }
    }
}
