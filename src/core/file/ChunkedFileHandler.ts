/**
 * ChunkedFileHandler handles file operations for chunked storage mode.
 * It appends data to multiple files (chunks) and manages metadata.
 */
import * as Crypto from "expo-crypto";
import { Directory, File, FileInfo } from "expo-file-system";
import { StorageError } from "../../types/storageErrorInfc";
import config from "../../liteStore.config.js";
import ROOT from "../../utils/ROOTPath.js";
import { meta } from "../meta/MetadataManager.js";
import withTimeout from "../../utils/withTimeout.js";

const CHUNK_EXT = ".ldb";
const META_FILE = "meta.ldb";



export class ChunkedFileHandler {
    private tableDir: Directory;

    constructor(tableName: string) {
        this.tableDir = new Directory(ROOT, tableName);
    }

    private getChunkFile(index: number): File {
        return new File(
            this.tableDir,
            String(index).padStart(6, "0") + CHUNK_EXT
        );
    }

    private getMetaFile(): File {
        return new File(this.tableDir, META_FILE);
    }

    /**
     * Appends data to the table's chunked files.
     * @param data - The data to append.
     */
    async append(data: Record<string, any>[]) {
        try {
            // 输入验证
            if (!Array.isArray(data)) {
                throw new StorageError(
                    `DATA_ERROR：expect array, received ${typeof data}`,
                    "FILE_CONTENT_INVALID"
                );
            }

            if (data.length === 0) return;

            // 添加超时控制
            await withTimeout(
                Promise.resolve(this.tableDir.create({ intermediates: true })),
                10000,
                `create table directory ${this.tableDir.name}`
            );

            const currentMeta = meta.get(this.tableDir.name) || {
                mode: "chunked" as const,
                path: this.tableDir.name + "/",
                count: 0,
                chunks: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            let chunkIndex = currentMeta.chunks || 0;
            let currentChunk: Record<string, any>[] = [];
            let currentSize = 0;

            // 确保配置有合理的默认值
            const chunkSize = config.chunkSize || 1024 * 1024; // 默认1MB

            for (const item of data) {
                try {
                    // 对每个数据项进行有效性检查
                    if (typeof item !== "object" || item === null) {
                        console.warn(`skip invalid data item:`, item);
                        continue;
                    }

                    const itemSize =
                        new TextEncoder().encode(JSON.stringify(item))
                            .byteLength + 200; // 预估开销

                    if (
                        currentSize + itemSize > chunkSize &&
                        currentChunk.length > 0
                    ) {
                        await this.writeChunk(chunkIndex, currentChunk);
                        chunkIndex++;
                        currentChunk = [];
                        currentSize = 0;
                    }

                    currentChunk.push(item);
                    currentSize += itemSize;
                } catch (err) {
                    console.warn(`skip error data item:`, item, err);
                    // 跳过出错的项，继续处理后续数据
                }
            }

            if (currentChunk.length > 0) {
                await this.writeChunk(chunkIndex, currentChunk);
                chunkIndex++;
            }

            // 更新元数据
            meta.update(this.tableDir.name, {
                mode: "chunked",
                count: currentMeta.count + data.length,
                chunks: chunkIndex,
                updatedAt: Date.now(),
            });
        } catch (error) {
            // 捕获并处理所有异常
            console.error(`append data to table ${this.tableDir.name} failed`, error);
            throw new StorageError(
                `append data to table ${this.tableDir.name} failed`,
                "FILE_WRITE_FAILED",
                error
            );
        }
    }

    private async writeChunk(index: number, data: Record<string, any>[]) {
        const file = this.getChunkFile(index);
        try {
            // 添加输入验证
            if (!Array.isArray(data)) {
                throw new StorageError(
                    `DATA_ERROR：expect array, received ${typeof data}`,
                    "FILE_CONTENT_INVALID"
                );
            }

            const content = JSON.stringify(data);
            const hash = await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                content
            );

            // 添加超时控制
            await withTimeout(
                Promise.resolve(file.write(JSON.stringify({ data, hash }))),
                10000,
                `write chunk ${index} failed`
            );
        } catch (error) {
            throw new StorageError(
                `write chunk ${index} failed`,
                "FILE_WRITE_FAILED",
                error
            );
        }
    }

    async readAll(): Promise<Record<string, any>[]> {
        const metaFile = this.getMetaFile();
        let chunksCount = 0;
        try {
            // 添加超时控制和类型安全
            const info = await withTimeout(
                Promise.resolve(metaFile.info()),
                10000,
                "CHECK META FILE"
            );
            if (info.exists) {
                const text = await withTimeout(
                    metaFile.text(),
                    10000,
                    "READ META FILE"
                );
                const metaInfo = JSON.parse(text);
                chunksCount = metaInfo?.chunks || 0;
            }
        } catch (e) {
            // 读取元数据失败时，使用扫描模式
            console.warn("READ META FILE , ENABLE SCAN MODE", e);
        }

        const all: Record<string, any>[] = [];
        // 使用常量定义最大扫描数量，便于维护
        const MAX_SCAN_CHUNKS = 1000;
        const scanLimit = Math.max(chunksCount, MAX_SCAN_CHUNKS);

        for (let i = 0; i < scanLimit; i++) {
            const file = this.getChunkFile(i);

            try {
                // 添加超时控制
                const info = await withTimeout<FileInfo>(
                    Promise.resolve(file.info()),
                    10000,
                    `CHECK CHUNK ${i} EXISTS`
                );

                if (!info.exists) {
                    if (i < chunksCount) continue; // 中间缺失也跳过
                    break; // 连续缺失说明结束了
                }

                const text = await withTimeout(
                    file.text(),
                    10000,
                    `READ CHUNK ${i} CONTENT`
                );

                const parsed = JSON.parse(text);

                // 增强防御性编程
                if (!parsed || typeof parsed !== "object") {
                    // 分片 ${i} 格式错误：不是有效的JSON对象
                    console.warn(`CHUNK ${i} FORMAT_ERROR：not valid JSON object`);
                    continue;
                }

                if (!Array.isArray(parsed.data) || parsed.hash === undefined) {
                    // 分片 ${i} 格式错误：缺少data数组或hash字段
                    console.warn(`CHUNK ${i} FORMAT_ERROR：missing data array or hash field`);
                    continue;
                }

                const expected = await Crypto.digestStringAsync(
                    Crypto.CryptoDigestAlgorithm.SHA256,
                    JSON.stringify(parsed.data)
                );

                if (expected !== parsed.hash) {
                    // 分片 ${i} 已损坏，跳过
                    console.warn(`CHUNK ${i} CORRUPTED：hash mismatch`);
                    continue;
                }

                all.push(...parsed.data);
            } catch (e) {
                // 读取分片 ${i} 失败
                console.warn(`READ CHUNK ${i} FAILED`, e);
            }
        }
        return all;
    }

    async clear() {
        try {
            // 添加超时控制
            const entries = await withTimeout(
                Promise.resolve(this.tableDir.list()),
                10000,
                "LIST TABLE DIR"
            );

            // 使用 Promise.allSettled 避免一个失败影响全部
            await Promise.allSettled(
                entries.map(async (e) => {
                    try {
                        await withTimeout(
                            Promise.resolve(e.delete()),
                            10000,
                            `DELETE ${e.name}`
                        );
                    } catch (err) {
                        // 删除 ${e.name} 失败
                        console.warn(`DELETE ${e.name} FAILED`, err);
                    }
                })
            );

            await withTimeout(
                Promise.resolve(this.getMetaFile().delete()),
                10000,
                "DELETE META FILE"
            );
            // 更新元数据
            meta.update(this.tableDir.name, {
                count: 0,
                chunks: 0,
                updatedAt: Date.now(),
            });
        } catch (error) {
            // 清空分片表失败
            console.error("CLEAR CHUNKED TABLE FAILED", error);
            throw new StorageError(
                "CLEAR CHUNKED TABLE FAILED",
                "TABLE_DELETE_FAILED",
                error
            );
        }
    }
}
