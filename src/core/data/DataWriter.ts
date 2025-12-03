// src/core/data/DataWriter.ts
import { Directory, File } from "expo-file-system";
import config from "../../liteStore.config.js";
import { MetadataManagerInfc } from "../../types/metadataManagerInfc";
import { StorageError } from "../../types/storageErrorInfc";
import type {
    CreateTableOptions,
    WriteOptions,
    WriteResult
} from "../../types/storageTypes";
import { ErrorHandler } from "../../utils/errorHandler";
import ROOT from "../../utils/ROOTPath";
import withTimeout from "../../utils/withTimeout";
import { CacheManager } from "../cache/CacheManager";
import { ChunkedFileHandler } from "../file/ChunkedFileHandler";
import { SingleFileHandler } from "../file/SingleFileHandler";
import { FileOperationManager } from "../FileOperationManager";
import { IndexManager } from "../index/IndexManager";
import type { ColumnSchema } from "../meta/MetadataManager";
import { QueryEngine } from "../query/QueryEngine";
export class DataWriter {
    private chunkSize = config.chunkSize;
    private indexManager: IndexManager;
    private metadataManager: MetadataManagerInfc;
    private cacheManager: CacheManager;
    private fileOperationManager: FileOperationManager;

    constructor(
        metadataManager: MetadataManagerInfc,
        indexManager: IndexManager,
        cacheManager: CacheManager,
        fileOperationManager: FileOperationManager
    ) {
        this.metadataManager = metadataManager;
        this.indexManager = indexManager;
        this.cacheManager = cacheManager;
        this.fileOperationManager = fileOperationManager;
    }

    private static readonly supportedColumnTypes: ColumnSchema[string][] = [
        "string",
        "number",
        "boolean",
        "date",
        "blob",
    ];

    private normalizeColumnSchema(
        columns?: Record<string, string | { type: string; isHighRisk?: boolean }>
    ): ColumnSchema {
        const schema: ColumnSchema = {};
        if (!columns) return schema;

        for (const [column, definition] of Object.entries(columns)) {
            let type: string;
            let isHighRisk = false;

            // 处理不同类型的列定义
            if (typeof definition === 'string') {
                type = definition;
            } else {
                type = definition.type;
                isHighRisk = definition.isHighRisk || false;
            }

            if (
                !DataWriter.supportedColumnTypes.includes(
                    type as any
                )
            ) {
                throw ErrorHandler.createGeneralError(
                    `Unsupported column type: ${column}: ${type}`,
                    "TABLE_COLUMN_INVALID",
                    undefined,
                    `Column '${column}' has an unsupported type '${type}'`,
                    "Please use one of the supported types: string, number, boolean, date, blob"
                );
            }

            // 根据是否为高危字段，使用不同的存储格式
            if (isHighRisk) {
                schema[column] = {
                    type: type as "string" | "number" | "boolean" | "date" | "blob",
                    isHighRisk
                };
            } else {
                schema[column] = type as ColumnSchema[string];
            }
        }
        return schema;
    }

    private getSingleFile(tableName: string): SingleFileHandler {
        const file = new File(ROOT, tableName + ".ldb");
        return new SingleFileHandler(file);
    }

    private getChunkedHandler(tableName: string): ChunkedFileHandler {
        return new ChunkedFileHandler(tableName, this.metadataManager);
    }

    private shouldUseChunkedMode(data: Record<string, any>[]): boolean {
        // 根据数据量决定是否使用分片模式
        const estimatedSize = data.reduce(
            (acc, item) => acc + JSON.stringify(item).length,
            0
        );
        return estimatedSize > (this.chunkSize || 1024 * 1024) / 2;
    }

    // ==================== 创建表（支持单文件和分片模式） ====================
    async createTable(
        tableName: string,
        options: CreateTableOptions & {
            columns?: Record<string, string | { type: string; isHighRisk?: boolean }>;
            initialData?: Record<string, any>[];
            mode?: "single" | "chunked";
            isHighRisk?: boolean;
            highRiskFields?: string[];
        } = {}
    ): Promise<void> {
        return ErrorHandler.handleAsyncError(async () => {
            if (!tableName?.trim()) {
                throw ErrorHandler.createGeneralError(
                    "Table name cannot be empty",
                    "TABLE_NAME_INVALID",
                    undefined,
                    "Table name must be a non-empty string",
                    "Please provide a valid table name"
                );
            }
            if (this.metadataManager.get(tableName)) {
                return; // 幂等
            }
            
            // 检查文件系统访问权限
            await this.fileOperationManager.checkPermissions();

            const { columns = {}, initialData = [], mode = "single" } = options;

            // 根据数据量或手动指定决定使用哪种模式
            const actualMode = 
                mode === "chunked" || this.shouldUseChunkedMode(initialData)
                    ? "chunked"
                    : "single";

            if (actualMode === "chunked") {
                const handler = this.getChunkedHandler(tableName);
                await withTimeout(
                    handler.append(initialData),
                    10000,
                    `create chunked table ${tableName}`
                );
            } else {
                const handler = this.getSingleFile(tableName);
                await withTimeout(
                    handler.write(initialData),
                    10000,
                    `create single file table ${tableName}`
                );
            }

            // 注册元数据（不覆盖 createdAt）
            this.metadataManager.update(tableName, {
                mode: actualMode,
                path: 
                    actualMode === "chunked"
                        ? `${tableName}/`
                        : `${tableName}.ldb`,
                count: initialData.length,
                chunks: actualMode === "chunked" ? 1 : 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: this.normalizeColumnSchema(columns),
                isHighRisk: options.isHighRisk || false,
                highRiskFields: options.highRiskFields || []
            });
        }, (error) => ErrorHandler.createTableError("create", tableName, error));

    }

    // ==================== 删除表（彻底清理） ====================
    async deleteTable(tableName: string): Promise<void> {
        return ErrorHandler.handleAsyncError(async () => {
            const tableMeta = this.metadataManager.get(tableName);

            if (tableMeta?.mode === "chunked") {
                const handler = this.getChunkedHandler(tableName);
                await withTimeout(
                    handler.clear(),
                    10000,
                    `delete chunked table ${tableName}`
                );
            } else {
                await withTimeout(
                    Promise.allSettled([
                        this.getSingleFile(tableName).delete(),
                        new Directory(ROOT, tableName).delete(),
                    ]),
                    10000,
                    `delete table ${tableName}`
                );
            }

            this.metadataManager.delete(tableName);
        }, (error) => ErrorHandler.createTableError("delete", tableName, error));
    }

    // ==================== 写入（自动创建 + 超时） ====================
    async write(
        tableName: string,
        data: Record<string, any> | Record<string, any>[],
        options?: WriteOptions & { directWrite?: boolean }
    ): Promise<WriteResult> {
        return ErrorHandler.handleAsyncError(async () => {
            // 统一处理单条数据和多条数据，转换为数组格式
            const items = Array.isArray(data) ? data : [data];
            
            // 空数据直接返回，避免不必要的操作
            if (items.length === 0) {
                return await this.handleEmptyData(tableName);
            }

            // 验证写入数据的有效性，确保数据格式正确
            this.validateWriteData(items);

            // 自动创建表（如果不存在）
            await this.ensureTableExists(tableName);

            // 检查文件系统访问权限
            await this.fileOperationManager.checkPermissions();
            
            // 获取表的元数据，确定存储模式
            const tableMeta = this.metadataManager.get(tableName);
            
            // 根据存储模式执行写入操作
            const writeResult = await this.executeWriteOperation(tableName, items, options, tableMeta);
            
            // 更新索引
            await this.updateIndexes(tableName, items, options?.mode === "overwrite");
            
            // 更新表的元数据
            await this.updateTableMetadata(tableName, writeResult.final.length);
            
            // 清除缓存
            this.clearTableCache(tableName);

            // 返回写入结果
            return {
                written: items.length,
                totalAfterWrite: writeResult.final.length,
                chunked: writeResult.isChunked,
            };
        }, (error) => ErrorHandler.createFileError("write", `table ${tableName}`, error));
    }

    /**
     * 处理空数据写入
     */
    private async handleEmptyData(tableName: string): Promise<WriteResult> {
        return {
            written: 0,
            totalAfterWrite: await this.count(tableName),
            chunked: false,
        };
    }

    /**
     * 确保表存在，如果不存在则创建
     */
    private async ensureTableExists(tableName: string): Promise<void> {
        if (!(await this.hasTable(tableName))) {
            await this.createTable(tableName);
        }
    }

    /**
     * 根据存储模式执行写入操作
     */
    private async executeWriteOperation(
        tableName: string,
        items: Record<string, any>[],
        options?: WriteOptions & { directWrite?: boolean },
        tableMeta?: any
    ): Promise<{ final: Record<string, any>[]; isChunked: boolean }> {
        let final: Record<string, any>[];
        let isChunked = false;

        // 分片模式处理逻辑
        if (tableMeta?.mode === "chunked") {
            final = await this.writeToChunkedTable(tableName, items, options);
            isChunked = true;
        } 
        // 单文件模式处理逻辑
        else {
            final = await this.writeToSingleFileTable(tableName, items, options);
        }

        return { final, isChunked };
    }

    /**
     * 写入分片表
     */
    private async writeToChunkedTable(
        tableName: string,
        items: Record<string, any>[],
        options?: WriteOptions & { directWrite?: boolean }
    ): Promise<Record<string, any>[]> {
        const handler = this.getChunkedHandler(tableName);
        let final: Record<string, any>[];
        
        if (options?.mode === "overwrite") {
            // 覆盖模式：直接写入新数据，无需先读取现有数据
            await withTimeout(
                handler.write(items), // 使用更高效的write方法替代clear+append
                10000,
                `write to chunked table ${tableName}`
            );
            final = items;
        } else {
            // 追加模式：读取现有数据，追加新数据
            final = [
                ...(await withTimeout(
                    handler.readAll(),
                    10000,
                    `read chunked table ${tableName}`
                )),
                ...items,
            ];
            
            // 追加数据到分片文件
            await withTimeout(
                handler.append(items),
                10000,
                `append to chunked table ${tableName}`
            );
        }
        
        return final;
    }

    /**
     * 写入单文件表
     */
    private async writeToSingleFileTable(
        tableName: string,
        items: Record<string, any>[],
        options?: WriteOptions & { directWrite?: boolean }
    ): Promise<Record<string, any>[]> {
        const handler = this.getSingleFile(tableName);
        
        // 读取现有数据（覆盖模式下为空）
        const existing = 
            options?.mode === "overwrite"
                ? []
                : await withTimeout(
                      handler.read(),
                      10000,
                      `read single file table ${tableName}`
                  );
        
        // 合并现有数据和新数据（覆盖模式下只有新数据）
        const final = 
            options?.mode === "overwrite"
                ? items
                : [...existing, ...items];

        // 写入数据到单文件
        await withTimeout(
            handler.write(final),
            10000,
            `write to single file table ${tableName}`
        );
        
        return final;
    }

    /**
     * 更新索引
     */
    private async updateIndexes(
        tableName: string,
        items: Record<string, any>[],
        isOverwrite: boolean
    ): Promise<void> {
        // 覆盖模式下，清除现有索引
        if (isOverwrite) {
            this.indexManager.clearTableIndexes(tableName);
        }
        
        // 更新索引，为新写入的数据添加索引
        for (const item of items) {
            this.indexManager.addToIndex(tableName, item);
        }
    }

    /**
     * 更新表的元数据
     */
    private async updateTableMetadata(
        tableName: string,
        newCount: number
    ): Promise<void> {
        this.metadataManager.update(tableName, {
            count: newCount,
            updatedAt: Date.now(),
        });
    }
    
    /**
     * 验证写入数据的有效性
     */
    private validateWriteData(data: Record<string, any>[]): void {
        ErrorHandler.handleSyncError(() => {
            if (!Array.isArray(data)) {
                throw ErrorHandler.createGeneralError(
                    "Invalid data format",
                    "FILE_CONTENT_INVALID",
                    undefined,
                    `Expected array of records, received ${typeof data}`,
                    "Please provide an array of records or a single record"
                );
            }
            
            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                if (typeof item !== "object" || item === null) {
                    throw ErrorHandler.createGeneralError(
                        `Invalid data item at index ${i}`,
                        "FILE_CONTENT_INVALID",
                        undefined,
                        `Expected object, received ${typeof item}`,
                        "Please provide valid objects for all items"
                    );
                }
                
                // 检查是否包含有效字段
                if (Object.keys(item).length === 0) {
                    throw ErrorHandler.createGeneralError(
                        `Empty object at index ${i}`,
                        "FILE_CONTENT_INVALID",
                        undefined,
                        "Object must contain at least one field",
                        "Please provide objects with valid fields"
                    );
                }
                
                // 检查字段类型
                for (const [key, value] of Object.entries(item)) {
                    if (value === undefined) {
                        throw ErrorHandler.createGeneralError(
                            `Undefined value for field '${key}' at index ${i}`,
                            "FILE_CONTENT_INVALID",
                            undefined,
                            "Fields cannot have undefined values",
                            "Please provide valid values for all fields"
                        );
                    }
                }
            }
        }, (error) => error as StorageError);
    }

    async hasTable(tableName: string): Promise<boolean> {
        return this.metadataManager.get(tableName) !== undefined;
    }

    async count(tableName: string): Promise<number> {
        const tableMeta = this.metadataManager.get(tableName);
        if (!tableMeta) {
            // 表不存在，返回0
            return 0;
        }
        return this.metadataManager.count(tableName);
    }

    // ==================== 删除数据 ====================
    async delete(
        tableName: string,
        where: Record<string, any>
    ): Promise<number> {
        return ErrorHandler.handleAsyncError(async () => {
            // 检查文件系统访问权限
            await this.fileOperationManager.checkPermissions();
            
            const tableMeta = this.metadataManager.get(tableName);
            if (!tableMeta) {
                throw ErrorHandler.createGeneralError(
                    `Table ${tableName} not found`,
                    "TABLE_NOT_FOUND",
                    undefined,
                    `Table ${tableName} does not exist`,
                    "Please check if the table name is correct"
                );
            }

            // 读取所有数据
            let data: Record<string, any>[];
            if (tableMeta.mode === "chunked") {
                const handler = this.getChunkedHandler(tableName);
                data = await withTimeout(
                    handler.readAll(),
                    10000,
                    `read chunked table ${tableName}`
                );
            } else {
                const handler = this.getSingleFile(tableName);
                data = await withTimeout(
                    handler.read(),
                    10000,
                    `read single file table ${tableName}`
                );
            }

            // 应用过滤条件，找出要保留的数据（使用QueryEngine处理复杂查询）
            // 直接找出要保留的数据，而不是先找要删除的数据再过滤，这样更高效
            const filteredData = data.filter(item => {
                // 检查item是否不匹配where条件（即要保留的数据）
                return !QueryEngine.filter([item], where).length;
            });

            // 计算删除的记录数
            const deletedCount = data.length - filteredData.length;

            // 如果没有删除任何记录，直接返回
            if (deletedCount === 0) {
                return 0;
            }

            // 写入过滤后的数据
            if (tableMeta.mode === "chunked") {
                const handler = this.getChunkedHandler(tableName);
                await withTimeout(
                    handler.clear(),
                    10000,
                    `clear chunked table ${tableName}`
                );
                await withTimeout(
                    handler.append(filteredData),
                    10000,
                    `append to chunked table ${tableName}`
                );
            } else {
                const handler = this.getSingleFile(tableName);
                await withTimeout(
                    handler.write(filteredData),
                    10000,
                    `write to single file table ${tableName}`
                );
            }

            // 更新索引
            this.indexManager.clearTableIndexes(tableName);
            for (const item of filteredData) {
                this.indexManager.addToIndex(tableName, item);
            }

            // 更新元数据
            this.metadataManager.update(tableName, {
                count: filteredData.length,
                updatedAt: Date.now(),
            });

            // 清除缓存
            this.clearTableCache(tableName);

            return deletedCount;
        }, (error) => ErrorHandler.createFileError("delete from", `table ${tableName}`, error));
    }

    /**
     * 清除与特定表相关的所有缓存条目
     * @param tableName 表名
     */
    private clearTableCache(tableName: string): void {
        // 由于我们无法直接遍历CacheManager的内部缓存，
        // 我们需要使用一种策略来清除相关缓存
        // 这里我们使用一个特殊的缓存键来记录所有与该表相关的缓存键
        const tableCacheKeysKey = `${tableName}_cache_keys`;
        const tableCacheKeys = this.cacheManager.get(tableCacheKeysKey) as string[] || [];
        
        // 删除所有相关缓存条目
        for (const key of tableCacheKeys) {
            this.cacheManager.delete(key);
        }
        
        // 清除缓存键列表
        this.cacheManager.delete(tableCacheKeysKey);
    }

}
