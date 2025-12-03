// src/core/MetadataManager.ts
// 元数据管理器终极版 / Metadata Manager Ultimate Edition

import { File } from "expo-file-system";
import { StorageError } from "../../types/storageErrorInfc";
import ROOT from "../../utils/ROOTPath";
 
const META_FILE = new File(ROOT, "meta.ldb");
const CURRENT_VERSION = "1.0.0";

export interface ColumnSchema {
    [field: string]: "string" | "number" | "boolean" | "date" | "blob" | {
        type: "string" | "number" | "boolean" | "date" | "blob";
        isHighRisk?: boolean;
    };
}

export interface TableSchema {
    mode: "single" | "chunked";
    path: string;         // 单文件: "users.ldb"  分片: "users/"
    count: number;
    size?: number;
    lastId?: number;
    chunks?: number;
    createdAt: number;
    updatedAt: number;
    columns: ColumnSchema;
    indexes?: Record<string, "unique" | "normal">;
    isHighRisk?: boolean;
    highRiskFields?: string[];
}

export interface DatabaseMeta {
    version: string;
    generatedAt: number;
    tables: Record<string, TableSchema>;
}

export class MetadataManager {
    private cache: DatabaseMeta = {
        version: CURRENT_VERSION,
        generatedAt: Date.now(),
        tables: {},
    };

    private dirty = false;
    private writing = false;        // 防止并发写冲突
    private saveTimer: any = null;  // 防抖定时器
    private loadPromise: Promise<void> | null = null; // 用于跟踪load方法的执行状态

    constructor() {
        this.loadPromise = this.load(); // 异步加载，不阻塞启动，但保存promise以便外部等待
    }

    // 加载元数据（损坏自动重建）
    private async load() {
        try {
            const info = await META_FILE.info();
            if (!info.exists) throw new Error("File not exist");

            const text = await META_FILE.text();
            const parsed = JSON.parse(text);

            // check version
            if (parsed.version !== CURRENT_VERSION) {
                // future: add migration logic to upgrade the metadata version
            }

            this.cache = parsed;
        } catch (error) {
            this.cache = {
                version: CURRENT_VERSION,
                generatedAt: Date.now(),
                tables: {},
            };
            this.dirty = true;
            await this.save();
        }
    }

    // 等待加载完成（用于测试）
    async waitForLoad(): Promise<void> {
        if (this.loadPromise) {
            await this.loadPromise;
        }
    }

    // 清理资源（用于测试）
    cleanup(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
    }

    // 立即保存元数据（用于测试）
    async saveImmediately(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        await this.save();
    }

    // Lock Save (Prevent Concurrent Write) 
    // 锁保存（防止并发写冲突）
    private async save() {
        if (!this.dirty || this.writing) return;
        this.writing = true;
        if (this.saveTimer) clearTimeout(this.saveTimer);

        try {
            this.cache.generatedAt = Date.now();
            await META_FILE.write(JSON.stringify(this.cache, null, 2));
            this.dirty = false;
        } catch (error) {
            throw new StorageError("Metadata write failed", "META_FILE_WRITE_ERROR", { cause: error });
        } finally {
            this.writing = false;
        }
    }

    private triggerSave() {
        this.dirty = true; 
        if (this.saveTimer) clearTimeout(this.saveTimer);
        // 在测试环境中使用更短的延迟，避免测试挂起
        const delay = (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') ? 10 : 200;
        this.saveTimer = setTimeout(() => this.save(), delay);
    }

    // 获取单表元数据
    get(tableName: string): TableSchema | undefined {
        return this.cache.tables[tableName];
    }
    getPath(tableName: string): string {
        return this.cache.tables[tableName]?.path || `${tableName}.ldb`;
    }
    // 更新表元数据（自动合并）
    update(tableName: string, updates: Partial<TableSchema>) {
        const existing = this.cache.tables[tableName] || {
            mode: "single",
            path: `${tableName}.ldb`,
            count: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            columns: {},
        };

        this.cache.tables[tableName] = {
            ...existing,
            ...updates,
            updatedAt: Date.now(),
        };

        this.triggerSave();
    }

    // delete table
    delete(tableName: string) {
        delete this.cache.tables[tableName];
        this.triggerSave();
    }
    // all tables 
    allTables(): string[] {
        return Object.keys(this.cache.tables);
    }

    // count records in table
    count(tableName: string): number {
        return this.cache.tables[tableName]?.count ?? 0;
    }

    // 调试用：查看完整元数据
    debugDump_checkMetaCache(): DatabaseMeta {
        return this.cache;
    }
}

// 单例导出 + 自动加载
export const meta = new MetadataManager();