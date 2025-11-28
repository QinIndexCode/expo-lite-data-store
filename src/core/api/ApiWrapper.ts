// src/core/api/ApiWrapper.ts
// API包装器，用于实现统一响应格式和完善的错误码体系

import { ApiResponse, ApiResponseStatus } from "../../types/apiResponse.js";
import { StorageAdapterInfc } from "../../types/storageAdapterInfc.js";
import { StorageError } from "../../types/storageErrorInfc.js";
import type {
    CreateTableOptions,
    ReadOptions,
    WriteOptions,
    WriteResult
} from "../../types/storageTypes";
import { RateLimiter, RateLimitStatus } from "./RateLimiter.js";

/**
 * API包装器类，用于实现统一响应格式和完善的错误码体系
 */
export class ApiWrapper {
    /**
     * 存储适配器实例
     */
    private storageAdapter: StorageAdapterInfc;
    
    /**
     * 支持的API版本列表
     */
    private readonly supportedVersions = ["1.0.0"];
    
    /**
     * 默认API版本
     */
    private readonly defaultVersion = "1.0.0";
    
    /**
     * 限流实例
     */
    private rateLimiter: RateLimiter;
    
    /**
     * 构造函数
     * @param storageAdapter 存储适配器实例
     * @param options API配置选项
     */
    constructor(
        storageAdapter: StorageAdapterInfc,
        private readonly options: {
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
        
        // 初始化限流实例
        this.rateLimiter = new RateLimiter({
            rate: this.options.rateLimit?.rate || 100,
            capacity: this.options.rateLimit?.capacity || 200,
            enabled: this.options.rateLimit?.enabled !== false
        });
    }
    
    /**
     * 检查限流
     * @param clientId 客户端ID
     * @param tokens 消耗的令牌数
     * @returns 限流状态
     */
    private checkRateLimit(clientId: string = "default", tokens: number = 1): RateLimitStatus {
        return this.rateLimiter.consume(clientId, tokens);
    }
    
    /**
     * 获取API版本
     * @param version 请求的API版本
     * @returns 有效的API版本
     */
    private getApiVersion(version?: string): string {
        const requestedVersion = version || this.options.defaultVersion || this.defaultVersion;
        
        if (this.supportedVersions.includes(requestedVersion)) {
            return requestedVersion;
        }
        
        // 如果请求的版本不支持，使用默认版本
        return this.defaultVersion;
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 5); // 创建表消耗5个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            
            await this.storageAdapter.createTable(tableName, options);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 3); // 删除表消耗3个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            
            await this.storageAdapter.deleteTable(tableName);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 1); // 检查表存在性消耗1个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            
            const result = await this.storageAdapter.hasTable(tableName);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 2); // 列出表消耗2个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            const result = await this.storageAdapter.listTables();
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const tokens = Array.isArray(data) ? Math.min(data.length, 10) : 3; // 写入操作消耗3-10个令牌
            const rateLimitStatus = this.checkRateLimit(clientId, tokens);
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            this.validateWriteData(data);
            
            const result = await this.storageAdapter.write(tableName, data, options);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 2); // 读取操作消耗2个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            
            const result = await this.storageAdapter.read(tableName, options);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 1); // 计数操作消耗1个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            
            const result = await this.storageAdapter.count(tableName);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 1); // 查找单条记录消耗1个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            this.validateFilter(filter);
            
            const result = await this.storageAdapter.findOne(tableName, filter);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 2); // 查找多条记录消耗2个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            if (filter) {
                this.validateFilter(filter);
            }
            
            const result = await this.storageAdapter.findMany(tableName, filter, options);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const totalOperations = operations.reduce((count, op) => {
                return count + (Array.isArray(op.data) ? op.data.length : 1);
            }, 0);
            const tokens = Math.min(totalOperations * 2, 20); // 批量操作消耗2-20个令牌
            const rateLimitStatus = this.checkRateLimit(clientId, tokens);
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            this.validateBulkOperations(operations);
            
            const result = await this.storageAdapter.bulkWrite(tableName, operations);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                data: result,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
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
        const requestId = this.generateRequestId();
        const apiVersion = this.getApiVersion(version);
        
        try {
            // 检查限流
            const rateLimitStatus = this.checkRateLimit(clientId, 10); // 迁移操作消耗10个令牌
            if (!rateLimitStatus.allowed) {
                return {
                    status: ApiResponseStatus.ERROR,
                    error: {
                        code: "RATE_LIMIT_EXCEEDED",
                        message: "Rate limit exceeded",
                        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
                        suggestion: "Reduce the frequency of requests or contact support to increase your rate limit"
                    },
                    meta: {
                        requestId,
                        timestamp: Date.now(),
                        version: apiVersion,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            
            // 请求验证
            this.validateTableName(tableName);
            
            await this.storageAdapter.migrateToChunked(tableName);
            
            return {
                status: ApiResponseStatus.SUCCESS,
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version: apiVersion,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return this.handleError(error, requestId, startTime, apiVersion);
        }
    }
    
    /**
     * 验证表名
     * @param tableName 表名
     */
    private validateTableName(tableName: string): void {
        if (!tableName || typeof tableName !== "string" || tableName.trim() === "") {
            throw new StorageError(
                "Invalid table name",
                "TABLE_NAME_INVALID",
                {
                    details: "Table name must be a non-empty string",
                    suggestion: "Please provide a valid table name"
                }
            );
        }
        
        // 表名长度限制
        if (tableName.length > 100) {
            throw new StorageError(
                "Table name too long",
                "TABLE_NAME_INVALID",
                {
                    details: "Table name must be less than 100 characters",
                    suggestion: "Please provide a shorter table name"
                }
            );
        }
        
        // 表名格式限制
        const validTableNameRegex = /^[a-zA-Z0-9_\-]+$/;
        if (!validTableNameRegex.test(tableName)) {
            throw new StorageError(
                "Invalid table name format",
                "TABLE_NAME_INVALID",
                {
                    details: "Table name can only contain letters, numbers, underscores and hyphens",
                    suggestion: "Please provide a valid table name format"
                }
            );
        }
    }
    
    /**
     * 验证写入数据
     * @param data 要写入的数据
     */
    private validateWriteData(data: Record<string, any> | Record<string, any>[]): void {
        const items = Array.isArray(data) ? data : [data];
        
        if (items.length === 0) {
            throw new StorageError(
                "No data to write",
                "FILE_CONTENT_INVALID",
                {
                    details: "Write operation requires at least one data item",
                    suggestion: "Please provide valid data to write"
                }
            );
        }
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (typeof item !== "object" || item === null || Array.isArray(item)) {
                throw new StorageError(
                    `Invalid data item at index ${i}`,
                    "FILE_CONTENT_INVALID",
                    {
                        details: "Data items must be objects",
                        suggestion: "Please provide valid objects for all data items"
                    }
                );
            }
            
            if (Object.keys(item).length === 0) {
                throw new StorageError(
                    `Empty object at index ${i}`,
                    "FILE_CONTENT_INVALID",
                    {
                        details: "Data objects must contain at least one field",
                        suggestion: "Please provide objects with valid fields"
                    }
                );
            }
        }
    }
    
    /**
     * 验证过滤条件
     * @param filter 过滤条件
     */
    private validateFilter(filter: Record<string, any>): void {
        if (typeof filter !== "object" || filter === null) {
            throw new StorageError(
                "Invalid filter condition",
                "QUERY_FAILED",
                {
                    details: "Filter must be an object",
                    suggestion: "Please provide a valid filter object"
                }
            );
        }
        
        if (Object.keys(filter).length === 0) {
            throw new StorageError(
                "Empty filter condition",
                "QUERY_FAILED",
                {
                    details: "Filter must contain at least one condition",
                    suggestion: "Please provide a valid filter with conditions"
                }
            );
        }
    }
    
    /**
     * 验证批量操作
     * @param operations 操作数组
     */
    private validateBulkOperations(operations: Array<{
        type: "insert" | "update" | "delete";
        data: Record<string, any> | Record<string, any>[];
    }>): void {
        if (!Array.isArray(operations) || operations.length === 0) {
            throw new StorageError(
                "Invalid bulk operations",
                "BULK_OPERATION_FAILED",
                {
                    details: "Bulk operations must be a non-empty array",
                    suggestion: "Please provide valid bulk operations"
                }
            );
        }
        
        for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            
            if (typeof op !== "object" || op === null) {
                throw new StorageError(
                    `Invalid operation at index ${i}`,
                    "BULK_OPERATION_FAILED",
                    {
                        details: "Operations must be objects",
                        suggestion: "Please provide valid operation objects"
                    }
                );
            }
            
            if (!["insert", "update", "delete"].includes(op.type)) {
                throw new StorageError(
                    `Invalid operation type at index ${i}`,
                    "BULK_OPERATION_FAILED",
                    {
                        details: "Operation type must be one of: insert, update, delete",
                        suggestion: "Please provide a valid operation type"
                    }
                );
            }
            
            this.validateWriteData(op.data);
        }
    }
    
    /**
     * 处理错误，转换为统一的API响应格式
     * @param error 错误对象
     * @param requestId 请求ID
     * @param startTime 开始时间
     * @param version API版本
     * @returns 统一格式的错误响应
     */
    private handleError(error: any, requestId: string, startTime: number, version: string): ApiResponse {
        if (error instanceof StorageError) {
            return {
                status: ApiResponseStatus.ERROR,
                error: {
                    code: error.code,
                    message: error.message,
                    details: error.details,
                    suggestion: error.suggestion,
                    cause: error.cause
                },
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version,
                    processingTime: Date.now() - startTime
                }
            };
        } else {
            // 处理未知错误
            return {
                status: ApiResponseStatus.ERROR,
                error: {
                    code: "UNKNOWN",
                    message: error.message || "An unknown error occurred",
                    details: "An unexpected error happened",
                    suggestion: "Please try again later or contact support",
                    cause: error
                },
                meta: {
                    requestId,
                    timestamp: Date.now(),
                    version,
                    processingTime: Date.now() - startTime
                }
            };
        }
    }
    
    /**
     * 生成请求ID
     * @returns 请求ID
     */
    private generateRequestId(): string {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
}
