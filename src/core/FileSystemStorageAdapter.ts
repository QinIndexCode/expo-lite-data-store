// src/core/FileSystemStorageAdapter.ts
import { Directory, Paths, File } from "expo-file-system";
import * as CryptoJS from "expo-crypto";
import * as Crypto from "expo-crypto";
const chunk_size = 8 * 1024 * 1024; // 8MB //后续可配置

import type { StorageAdapter } from "./storageAdapter";
import { StorageError } from "./storageAdapter";
import type {
    FilterCondition,
    WriteResult,
    WriteOptions,
    ReadOptions,
} from "../types/storage";
import { StorageErrorCode } from "../types/storage";
import type { TableMeta, Catalog } from "../types/storage";

// ============================= 常量 & 配置 / Constants & Configuration =============================
const ROOT = new Directory(Paths.document, "expo-litedatastore");
await ROOT.create({ intermediates: true }); // 全局只创建一次根目录

const SINGLE_FILE_EXT = ".ldb"; // 小表后缀：users.ldb / single file extension for single mode
const CHUNK_FILE_PREFIX = ""; // 大表分片前缀（空字符串，文件名 0000.ldb） / chunk prefix for chunked mode
const META_FILE = "meta.ldb"; // 分片模式下的元数据文件 / meta file for chunked mode

// ============================= 核心实现类 / Core Implementation Class =============================
export class FileSystemStorageAdapter implements StorageAdapter {
    private chunkSize: number;

    /**
     * 构造函数
     * @param customChunkSize custom chunk size for chunked mode, default max 8MB / 自定义分片大小，默认最大 8MB
     */
    constructor(customChunkSize = 8 * 1024 * 1024) {
        this.chunkSize = customChunkSize;
    }
    // --------------------- 工具函数 ---------------------

    /**
     * 获取单文件模式路径（小表）
     * @param tableName 表名
     * @returns File 对象
     */

    /**
     * 获取单文件模式路径（小表）
     * @param tableName 表名
     * @returns File 对象
     */
    private getSingleFile(tableName: string): File {
        return new File(ROOT, tableName + SINGLE_FILE_EXT);
    }
    /**
     * 获取分片模式目录（大表）
     * @param tableName 表名
     * @returns Directory 对象
     */
    private getChunkedDir(tableName: string): Directory {
        return new Directory(ROOT, tableName);
    }
    /**
     * 获取表模式（单文件或分片）
     * @param tableName 表名
     * @returns "single" | "chunked"
     */
    private async getTableMode(
        tableName: string
    ): Promise<"single" | "chunked"> {
        const singleFile = this.getSingleFile(tableName);
        const chunkedDir = this.getChunkedDir(tableName);

        const [singleInfo, dirInfo] = await Promise.all([
            singleFile.info(),
            chunkedDir.info(),
        ]);

        if (dirInfo.exists && dirInfo.uri) return "chunked";
        if (singleInfo.exists) return "single";
        return "single"; // 默认单文件
    }
    // --------------------- 接口实现 / Interface Implementation ---------------------
    /**
     * 创建表（懒创建，write 时自动调用） / create table (lazy creation, called automatically when write)
     * 目前不需要手动调用，保持接口兼容 / now it's lazy creation, called automatically when write
     */
    async createTable(): Promise<void> {
        // 懒创建，write 时自动处理
        return;
    }
    async write(
        tableName: string,
        data: Record<string, any> | Record<string, any>[],
        options?: WriteOptions
    ): Promise<WriteResult> {
        const items = Array.isArray(data) ? data : [data];
        if (items.length === 0) {
            const total = await this.count(tableName);
            return { written: 0, totalAfterWrite: total, chunked: false };
        }

        const mode = options?.mode ?? "append";

        // 1. 判断当前表模式
        const currentMode = await this.getTableMode(tableName);

        // 2. 读取现有数据（append 模式）
        let existing: Record<string, any>[] = [];
        if (mode === "append") {
            existing = await this.readAll(tableName);
        }

        // 3. 合并数据
        const finalData =
            mode === "overwrite" ? items : [...existing, ...items];

        // 4. 写入（当前强制单文件模式）
        const file = this.getSingleFile(tableName);
        const content = JSON.stringify(finalData);
        const hash = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            content
        );

        await file.write(JSON.stringify({ data: finalData, hash }));

        return {
            written: items.length,
            totalAfterWrite: finalData.length,
            chunked: false,
        };
    }

    // --------------------- 内部辅助函数 / Internal Helper Functions ---------------------

    /**
     * 读取整表数据（内部使用）/ read all data (internal use)
     */
    private async readAll(tableName: string): Promise<Record<string, any>[]> {
        const file = this.getSingleFile(tableName);
        const info = await file.info();
        if (!info.exists) return [];

        const text = await file.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            throw new StorageError("数据解析失败", "CORRUPTED_DATA", e);
        }

        // 完整性校验
        const expected = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            JSON.stringify(parsed.data)
        );
        if (expected !== parsed.hash) {
            throw new StorageError("数据被篡改", "CORRUPTED_DATA");
        }

        return parsed.data;
    }

    /**
     * 统计条数（临时实现，后续根据模式优化,以及优化性能，内存占用等） / count items (temporary implementation, will be optimized later)
     */
    private async count(tableName: string): Promise<number> {
        return (await this.readAll(tableName)).length; //后续不推荐使用readAll，因为它会读取整个文件，导致性能问题
    }

    async deleteTable(tableName: string): Promise<void> {
        throw new Error("Method not implemented");
    }
    async hasTable(tableName: string): Promise<boolean> {
        throw new Error("Method not implemented");
    }
    async listTables(): Promise<string[]> {
        throw new Error("Method not implemented");
    }
    async read(
        tableName: string,
        options?: ReadOptions
    ): Promise<Record<string, any>[]> {
        throw new Error("Method not implemented");
    }
}
