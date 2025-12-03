// src/core/cache/CacheController.ts
import { CacheManager } from "./CacheManager";

type CacheEventType = "create" | "update" | "delete" | "clear" | "bulk_write";

interface CacheEvent {
    type: CacheEventType;
    tableName: string;
    affectedIds?: (string | number)[];
}

export class CacheController {
    private static readonly MAX_TRACKED_KEYS = 300; // 每表最多追踪 300 个查询缓存
    private cacheManager: CacheManager;
    private listeners: Map<string, Set<(event: CacheEvent) => void>> = new Map();

    constructor(cacheManager: CacheManager) {
        this.cacheManager = cacheManager;
        this.listeners.set("*", new Set());
    }

    // 记录缓存键（带 LRU 自动清理）
    recordCacheKey(tableName: string, cacheKey: string): void {
        const keysKey = `${tableName}_cache_keys`;
        let keys = (this.cacheManager.get(keysKey) as string[]) || [];

        // 去重 + 最近使用前置
        keys = keys.filter(k => k !== cacheKey);
        keys.unshift(cacheKey);

        // 超出限制，删除最老的缓存
        if (keys.length > CacheController.MAX_TRACKED_KEYS) {
            const removed = keys.splice(CacheController.MAX_TRACKED_KEYS);
            removed.forEach(k => this.cacheManager.delete(k));
        }

        this.cacheManager.set(keysKey, keys);
    }

    // 精准失效：根据 affectedIds 删除包含这些 id 的查询缓存
    private invalidateByIds(tableName: string, ids: (string | number)[]) {
        if (ids.length === 0) return;
        const idSet = new Set(ids.map(String));
        const keysKey = `${tableName}_cache_keys`;
        const keys = (this.cacheManager.get(keysKey) as string[]) || [];
        const stillValid: string[] = [];

        for (const key of keys) {
            const data = this.cacheManager.get(key) as any[];
            if (!Array.isArray(data)) {
                this.cacheManager.delete(key);
                continue;
            }

            const shouldDelete = data.some(item => item?.id != null && idSet.has(String(item.id)));
            if (shouldDelete) {
                this.cacheManager.delete(key);
            } else {
                stillValid.push(key);
            }
        }

        if (stillValid.length < keys.length) {
            this.cacheManager.set(keysKey, stillValid);
        }
    }

    // 全表缓存失效
    clearTableCache(tableName: string): void {
        const keysKey = `${tableName}_cache_keys`;
        const keys = (this.cacheManager.get(keysKey) as string[]) || [];
        keys.forEach(k => this.cacheManager.delete(k));
        this.cacheManager.delete(keysKey);
        this.emit({ type: "clear", tableName });
    }

    // 主入口：所有写操作都走这里
    handleDataWrite(
        tableName: string,
        operation: CacheEventType,
        affectedIds?: (string | number)[]
    ): void {
        switch (operation) {
            case "create":
            case "bulk_write":
            case "clear":
                this.clearTableCache(tableName);
                break;
            case "update":
            case "delete":
                if (affectedIds && affectedIds.length > 0) {
                    this.invalidateByIds(tableName, affectedIds);
                } else {
                    this.clearTableCache(tableName); // 防御性回退
                }
                break;
        }

        this.emit({ type: operation, tableName, affectedIds });
    }

    // 事件系统
    on(tableName: string, listener: (e: CacheEvent) => void) {
        if (!this.listeners.has(tableName)) this.listeners.set(tableName, new Set());
        this.listeners.get(tableName)!.add(listener);
    }

    off(tableName: string, listener: (e: CacheEvent) => void) {
        this.listeners.get(tableName)?.delete(listener);
    }

    private emit(event: CacheEvent) {
        [event.tableName, "*"].forEach(t => {
            this.listeners.get(t)?.forEach(l => l(event));
        });
    }

    clearAll() {
        this.cacheManager.clear();
        this.emit({ type: "clear", tableName: "*" });
    }

    getCacheManager() {
        return this.cacheManager;
    }
}