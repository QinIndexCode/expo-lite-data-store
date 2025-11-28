// src/core/data/DataReader.ts
import { File } from "expo-file-system";
import config from "../../liteStore.config.js";
import { MetadataManagerInfc } from "../../types/metadataManagerInfc";
import type {
    ReadOptions
} from "../../types/storageTypes";
import { ErrorHandler } from "../../utils/errorHandler";
import ROOT from "../../utils/ROOTPath";
import withTimeout from "../../utils/withTimeout";
import { CacheManager } from "../cache/CacheManager";
import { ChunkedFileHandler } from "../file/ChunkedFileHandler";
import { SingleFileHandler } from "../file/SingleFileHandler";
import { FileOperationManager } from "../FileOperationManager";
import { IndexManager } from "../index/IndexManager";
import { QueryEngine } from "../query/QueryEngine";
export class DataReader {
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

    private getSingleFile(tableName: string): SingleFileHandler {
        const file = new File(ROOT, tableName + ".ldb");
        return new SingleFileHandler(file);
    }

    private getChunkedHandler(tableName: string): ChunkedFileHandler {
        return new ChunkedFileHandler(tableName, this.metadataManager);
    }

    async read(
        tableName: string,
        options?: ReadOptions & { bypassCache?: boolean }
    ): Promise<Record<string, any>[]> {
        return ErrorHandler.handleAsyncError(async () => {
            // 获取表元数据
            const tableMeta = this.metadataManager.get(tableName);
            if (!tableMeta) {
                // 表不存在，返回空数组
                return [];
            }

            // 检查是否需要绕过缓存
            const tableIsHighRisk = tableMeta.isHighRisk || false;
            const shouldBypassCache = options?.bypassCache || tableIsHighRisk;

            let data: Record<string, any>[] = [];
            let useIndex = false;
            let indexedIds: string[] | number[] = [];
            
            // 如果不需要绕过缓存，尝试从缓存中获取数据
            if (!shouldBypassCache) {
                // 生成缓存键
                const cacheKey = `${tableName}_${JSON.stringify(options)}`;
                
                // 尝试从缓存中获取数据
                const cachedData = this.cacheManager.get(cacheKey);
                if (cachedData) {
                    return cachedData;
                }
            }
            
            // 检查是否可以使用索引
            if (options?.filter) {
                // 只有当filter是对象匹配形式时，才尝试使用索引
                if (typeof options.filter === 'object' && options.filter !== null && !('$or' in options.filter) && !('$and' in options.filter)) {
                    const filterKeys = Object.keys(options.filter);
                    // 查找是否有带索引的字段
                    for (const key of filterKeys) {
                        if (this.indexManager.hasIndex(tableName, key)) {
                            // 使用索引查询
                            const value = (options.filter as Record<string, any>)[key];
                            indexedIds = this.indexManager.queryIndex(tableName, key, value) as string[] | number[];
                            useIndex = indexedIds.length > 0;
                            break;
                        }
                    }
                }
            }
            
            // 读取数据
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
            
            // 应用过滤
            if (useIndex) {
                // 使用索引过滤，只返回匹配索引的数据
                data = data.filter(item => {
                    const id = item.id;
                    if (typeof id === 'string') {
                        return (indexedIds as string[]).includes(id);
                    } else if (typeof id === 'number') {
                        return (indexedIds as number[]).includes(id);
                    }
                    return false;
                });
            } else if (options?.filter) {
                // 不使用索引，应用完整过滤条件
                data = QueryEngine.filter(data, options.filter);
            }
            
            // 应用分页
            data = QueryEngine.paginate(data, options?.skip, options?.limit);
            
            // 只有非高危数据才存入缓存
            if (!shouldBypassCache) {
                // 生成缓存键
                const cacheKey = `${tableName}_${JSON.stringify(options)}`;
                
                // 将结果存入缓存
                this.cacheManager.set(cacheKey, data);
                
                // 记录该缓存键到表的缓存键列表中
                const tableCacheKeysKey = `${tableName}_cache_keys`;
                const tableCacheKeys = this.cacheManager.get(tableCacheKeysKey) as string[] || [];
                if (!tableCacheKeys.includes(cacheKey)) {
                    tableCacheKeys.push(cacheKey);
                    this.cacheManager.set(tableCacheKeysKey, tableCacheKeys);
                }
            }

            return data;
        }, (error) => ErrorHandler.createFileError("read", `table ${tableName}`, error));
    }

    async findOne(
        tableName: string,
        filter: Record<string, any>
    ): Promise<Record<string, any> | null> {
        return ErrorHandler.handleAsyncError(async () => {
            // 优化findOne性能，直接使用read方法的分页功能
            const results = await this.read(tableName, { filter, limit: 1 });
            return results.length > 0 ? results[0] : null;
        }, (error) => ErrorHandler.createQueryError("find one", tableName, error));
    }

    async findMany(
        tableName: string,
        filter?: Record<string, any>,
        options?: { skip?: number; limit?: number }
    ): Promise<Record<string, any>[]> {
        return ErrorHandler.handleAsyncError(async () => {
            // 直接复用read方法，确保两种模式都能正确处理
            return await this.read(tableName, { filter, ...options });
        }, (error) => ErrorHandler.createQueryError("find many", tableName, error));
    }
}