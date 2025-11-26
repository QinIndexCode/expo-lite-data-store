// src/core/adapter/FileSystemStorageAdapter.ts
import { Directory, File } from "expo-file-system";
import config from "../../liteStore.config.js";
import { StorageAdapterInfc } from "../../types/storageAdapterInfc.js";
import { StorageError } from "../../types/storageErrorInfc.js";
import type {
    CreateTableOptions,
    ReadOptions,
    WriteOptions,
    WriteResult,
} from "../../types/storageTypes";
import ROOT from "../../utils/ROOTPath.js";
import { SingleFileHandler } from "../file/SingleFileHandler";
import { ChunkedFileHandler } from "../file/ChunkedFileHandler.js";
import type { ColumnSchema } from "../meta/MetadataManager";
import { meta } from "../meta/MetadataManager";
import { QueryEngine } from "../query/QueryEngine";
import withTimeout from "../../utils/withTimeout.js";
// 超时包装（所有异步操作加上 10s 超时）

export class FileSystemStorageAdapter implements StorageAdapterInfc {
    private chunkSize = config.chunkSize;

    private static readonly supportedColumnTypes: ColumnSchema[string][] = [
        "string",
        "number",
        "boolean",
        "date",
        "blob",
    ];

    private normalizeColumnSchema(
        columns?: Record<string, string>
    ): ColumnSchema {
        const schema: ColumnSchema = {};
        if (!columns) return schema;

        for (const [column, type] of Object.entries(columns)) {
            if (
                !FileSystemStorageAdapter.supportedColumnTypes.includes(
                    type as any
                )
            ) {
                throw new StorageError(
                    `Unsupported column type: ${column}: ${type}`,
                    "TABLE_COLUMN_INVALID"
                );
            }
            schema[column] = type as ColumnSchema[string];
        }
        return schema;
    }

    private getSingleFile(tableName: string): SingleFileHandler {
        const file = new File(ROOT, tableName + ".ldb");
        return new SingleFileHandler(file);
    }

    private getChunkedHandler(tableName: string): ChunkedFileHandler {
        return new ChunkedFileHandler(tableName);
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
            columns?: Record<string, string>;
            initialData?: Record<string, any>[];
            mode?: "single" | "chunked";
        } = {}
    ): Promise<void> {
        try {
            if (!tableName?.trim()) {
                throw new StorageError(
                    "Table name cannot be empty",
                    "TABLE_NAME_INVALID"
                );
            }
            if (meta.get(tableName)) {
                return; // 幂等
            }

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
            meta.update(tableName, {
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
            });
        } catch (error) {
            throw new StorageError(
                `Create table ${tableName} failed`,
                "TABLE_CREATE_FAILED",
                error
            );
        }
    }

    // ==================== 删除表（彻底清理） ====================
    async deleteTable(tableName: string): Promise<void> {
        try {
            const tableMeta = meta.get(tableName);

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

            meta.delete(tableName);
        } catch (error) {
            throw new StorageError(
                `Delete table ${tableName} failed`,
                "TABLE_DELETE_FAILED",
                error
            );
        }
    }

    async hasTable(tableName: string): Promise<boolean> {
        return meta.get(tableName) !== undefined;
    }

    async listTables(): Promise<string[]> {
        return meta.allTables();
    }

    // ==================== 写入（自动创建 + 超时） ====================
    async write(
        tableName: string,
        data: Record<string, any> | Record<string, any>[],
        options?: WriteOptions
    ): Promise<WriteResult> {
        const items = Array.isArray(data) ? data : [data];
        if (items.length === 0) {
            return {
                written: 0,
                totalAfterWrite: await this.count(tableName),
                chunked: false,
            };
        }

        // 自动创建表
        if (!(await this.hasTable(tableName))) {
            await this.createTable(tableName);
        }

        try {
            const tableMeta = meta.get(tableName);
            let final: Record<string, any>[];
            let isChunked = false;

            if (tableMeta?.mode === "chunked") {
                const handler = this.getChunkedHandler(tableName);
                if (options?.mode === "overwrite") {
                    // 对于覆盖模式，需要先清空再追加
                    await withTimeout(
                        handler.clear(),
                        10000,
                        `clear chunked table ${tableName}`
                    );
                    final = items;
                } else {
                    // 对于追加模式，直接追加
                    final = [
                        ...(await withTimeout(
                            handler.readAll(),
                            10000,
                            `read chunked table ${tableName}`
                        )),
                        ...items,
                    ];
                }
                await withTimeout(
                    handler.append(items),
                    10000,
                    `append to chunked table ${tableName}`
                );
                isChunked = true;
            } else {
                const handler = this.getSingleFile(tableName);
                const existing =
                    options?.mode === "overwrite"
                        ? []
                        : await withTimeout(
                              handler.read(),
                              10000,
                              `read single file table ${tableName}`
                          );
                final =
                    options?.mode === "overwrite"
                        ? items
                        : [...existing, ...items];

                await withTimeout(
                    handler.write(final),
                    10000,
                    `write to single file table ${tableName}`
                );
            }

            meta.update(tableName, {
                count: final.length,
                updatedAt: Date.now(),
            });

            return {
                written: items.length,
                totalAfterWrite: final.length,
                chunked: isChunked,
            };
        } catch (error) {
            throw new StorageError(
                `write to table ${tableName} failed`,
                "FILE_WRITE_FAILED",
                error
            );
        }
    }

    // ==================== 读取（防御性编程） ====================
    async read(
        tableName: string,
        options?: ReadOptions
    ): Promise<Record<string, any>[]> {
        try {
            const tableMeta = meta.get(tableName);
            if (!tableMeta) {
                throw new StorageError(
                    `Table ${tableName} not found`,
                    "TABLE_NOT_FOUND"
                );
            }

            let data: Record<string, any>[] = [];
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

            if (options?.filter) {
                data = QueryEngine.filter(data, options.filter);
            }
            data = QueryEngine.paginate(data, options?.skip, options?.limit);

            return data;
        } catch (error) {
            throw new StorageError(
                `read table ${tableName} failed`,
                "FILE_READ_FAILED",
                error
            );
        }
    }

    async count(tableName: string): Promise<number> {
        const tableMeta = meta.get(tableName);
        if (!tableMeta) {
            throw new StorageError(
                `Table ${tableName} not found`,
                "TABLE_NOT_FOUND"
            );
        }
        return meta.count(tableName);
    }

    // ==================== 查询方法 ====================
    async findOne(
        tableName: string,
        filter: Record<string, any>
    ): Promise<Record<string, any> | null> {
        try {
            // 优化findOne性能，直接使用read方法的分页功能
            const results = await this.read(tableName, { filter, limit: 1 });
            return results.length > 0 ? results[0] : null;
        } catch (error) {
            throw new StorageError(
                `Find one in table ${tableName} failed`,
                "QUERY_FAILED",
                error
            );
        }
    }

    async findMany(
        tableName: string,
        filter?: Record<string, any>,
        options?: { skip?: number; limit?: number }
    ): Promise<Record<string, any>[]> {
        try {
            // 直接复用read方法，确保两种模式都能正确处理
            return await this.read(tableName, { filter, ...options });
        } catch (error) {
            throw new StorageError(
                `find many in table ${tableName} failed`,
                "QUERY_FAILED",
                error
            );
        }
    }

    // ==================== 批量操作 ====================
    async bulkWrite(
        tableName: string,
        operations: Array<{
            type: "insert" | "update" | "delete";
            data: Record<string, any> | Record<string, any>[];
        }>
    ): Promise<WriteResult> {
        try {
            // 对于批量操作，先读取所有数据，在内存中处理，然后一次性写回
            const tableMeta = meta.get(tableName);
            if (!tableMeta) {
                throw new StorageError(
                    `Table ${tableName} not found`,
                    "TABLE_NOT_FOUND"
                );
            }

            let data = await this.read(tableName);
            let writtenCount = 0;

            for (const op of operations) {
                const items = Array.isArray(op.data) ? op.data : [op.data];

                switch (op.type) {
                    case "insert":
                        data.push(...items);
                        writtenCount += items.length;
                        break;
                    case "update":
                        // 简化版更新：这里只实现了替换逻辑
                        // 实际应用中可能需要更复杂的更新逻辑
                        for (const item of items) {
                            if (item.id) {
                                const index = data.findIndex(
                                    (d) => d.id === item.id
                                );
                                if (index !== -1) {
                                    data[index] = { ...data[index], ...item };
                                    writtenCount++;
                                }
                            }
                        }
                        break;
                    case "delete":
                        // 支持基于id的删除
                        for (const item of items) {
                            if (item.id) {
                                const initialLength = data.length;
                                data = data.filter(d => d.id !== item.id);
                                if (data.length < initialLength) {
                                    writtenCount++;
                                }
                            }
                        }
                        break;
                }
            }

            // 根据表模式选择合适的写回方式
            if (tableMeta.mode === "chunked") {
                const handler = this.getChunkedHandler(tableName);
                await withTimeout(handler.clear(), 10000, `clear chunked table for bulk write ${tableName}`);
                await withTimeout(handler.append(data), 10000, `append bulk data to chunked table ${tableName}`);
            } else {
                const handler = this.getSingleFile(tableName);
                await withTimeout(handler.write(data), 10000, `write bulk data to single file table ${tableName}`);
            }

            // 更新元数据
            meta.update(tableName, {
                count: data.length,
                updatedAt: Date.now(),
            });

            return {
                written: writtenCount,
                totalAfterWrite: data.length,
                chunked: tableMeta.mode === "chunked",
            };
        } catch (error) {
            throw new StorageError(
                `bulk write to table ${tableName} failed`,
                "BULK_OPERATION_FAILED",
                error
            );
        }
    }

    // ==================== 模式迁移 ====================
    async migrateToChunked(tableName: string): Promise<void> {
        try {
            const tableMeta = meta.get(tableName);
            if (!tableMeta || tableMeta.mode === "chunked") {
                return; // 已经是分片模式或表不存在
            }

            // 读取现有数据
            const data = await this.read(tableName);

            // 创建新的分片表
            const chunkedHandler = this.getChunkedHandler(tableName);
            await withTimeout(
                chunkedHandler.append(data),
                10000,
                `migrate data to chunked mode ${tableName}`
            );

            // 删除原单文件
            await withTimeout(
                this.getSingleFile(tableName).delete(),
                10000,
                `delete old single file ${tableName}`
            );

            // 更新元数据
            meta.update(tableName, {
                ...tableMeta,
                mode: "chunked",
                path: `${tableName}/`,
                chunks: 1,
                updatedAt: Date.now(),
            });
        } catch (error) {
            throw new StorageError(
                `migrate table ${tableName} to chunked mode failed`,
                "MIGRATION_FAILED",
                error
            );
        }
    }
}

const storage = new FileSystemStorageAdapter();
export default storage;