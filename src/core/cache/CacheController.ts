// src/core/cache/CacheController.ts
import { CacheManager } from "./CacheManager";

/**
 * 缓存事件类型
 */
type CacheEventType = "create" | "update" | "delete" | "clear" | "bulk_write";

/**
 * 缓存事件接口
 */
interface CacheEvent {
    type: CacheEventType;
    tableName: string;
    keys?: string[];
    filter?: any;
}

export class CacheController {
    private cacheManager: CacheManager;
    private cacheEventListeners: Map<string, Set<(event: CacheEvent) => void>>;

    constructor(cacheManager: CacheManager) {
        this.cacheManager = cacheManager;
        this.cacheEventListeners = new Map();
        this.initializeEventListeners();
    }

    /**
     * 初始化事件监听器
     */
    private initializeEventListeners(): void {
        // 监听所有表的缓存事件
        this.cacheEventListeners.set("*", new Set());
    }

    /**
     * 清除与特定表相关的所有缓存条目
     * @param tableName 表名
     */
    clearTableCache(tableName: string): void {
        // 生成缓存键列表
        const tableCacheKeysKey = `${tableName}_cache_keys`;
        const tableCacheKeys = this.cacheManager.get(tableCacheKeysKey) as string[] || [];
        
        // 删除所有相关缓存条目
        for (const key of tableCacheKeys) {
            this.cacheManager.delete(key);
        }
        
        // 清除缓存键列表
        this.cacheManager.delete(tableCacheKeysKey);
        
        // 触发缓存清除事件
        this.emitCacheEvent({
            type: "clear",
            tableName
        });
    }

    /**
     * 清除特定查询的缓存
     * @param tableName 表名
     * @param filter 查询过滤条件
     */
    clearQueryCache(tableName: string, filter?: any): void {
        // 生成缓存键列表
        const tableCacheKeysKey = `${tableName}_cache_keys`;
        const tableCacheKeys = this.cacheManager.get(tableCacheKeysKey) as string[] || [];
        
        // 如果提供了过滤条件，只清除匹配的查询缓存
        if (filter) {
            const filterStr = JSON.stringify(filter);
            for (const key of tableCacheKeys) {
                // 检查缓存键是否包含过滤条件
                if (key.includes(filterStr)) {
                    this.cacheManager.delete(key);
                }
            }
        } else {
            // 否则清除所有与该表相关的缓存
            this.clearTableCache(tableName);
        }
        
        // 触发缓存清除事件
        this.emitCacheEvent({
            type: "update",
            tableName,
            filter
        });
    }

    /**
     * 记录表的缓存键，用于后续清除缓存
     * @param tableName 表名
     * @param cacheKey 缓存键
     */
    recordTableCacheKey(tableName: string, cacheKey: string): void {
        const tableCacheKeysKey = `${tableName}_cache_keys`;
        const tableCacheKeys = this.cacheManager.get(tableCacheKeysKey) as string[] || [];
        if (!tableCacheKeys.includes(cacheKey)) {
            tableCacheKeys.push(cacheKey);
            this.cacheManager.set(tableCacheKeysKey, tableCacheKeys);
        }
    }

    /**
     * 获取缓存管理器实例
     */
    getCacheManager(): CacheManager {
        return this.cacheManager;
    }

    /**
     * 清除所有缓存
     */
    clearAllCache(): void {
        this.cacheManager.clear();
        
        // 触发全局缓存清除事件
        this.emitCacheEvent({
            type: "clear",
            tableName: "*"
        });
    }

    /**
     * 注册缓存事件监听器
     * @param tableName 表名，"*"表示监听所有表
     * @param listener 事件监听器
     */
    onCacheEvent(tableName: string, listener: (event: CacheEvent) => void): void {
        if (!this.cacheEventListeners.has(tableName)) {
            this.cacheEventListeners.set(tableName, new Set());
        }
        this.cacheEventListeners.get(tableName)?.add(listener);
    }

    /**
     * 移除缓存事件监听器
     * @param tableName 表名
     * @param listener 事件监听器
     */
    offCacheEvent(tableName: string, listener: (event: CacheEvent) => void): void {
        this.cacheEventListeners.get(tableName)?.delete(listener);
    }

    /**
     * 触发缓存事件
     * @param event 缓存事件
     */
    private emitCacheEvent(event: CacheEvent): void {
        // 触发特定表的事件监听器
        if (this.cacheEventListeners.has(event.tableName)) {
            this.cacheEventListeners.get(event.tableName)?.forEach(listener => {
                listener(event);
            });
        }
        
        // 触发全局事件监听器
        this.cacheEventListeners.get("*")?.forEach(listener => {
            listener(event);
        });
    }

    /**
     * 处理数据写入事件，智能清除相关缓存
     * @param tableName 表名
     * @param operationType 操作类型
     * @param keys 受影响的键
     * @param filter 过滤条件
     */
    handleDataWriteEvent(
        tableName: string,
        operationType: CacheEventType,
        keys?: string[],
        filter?: any
    ): void {
        switch (operationType) {
            case "create":
            case "update":
            case "delete":
            case "bulk_write":
                // 对于写入操作，清除相关查询缓存
                this.clearQueryCache(tableName, filter);
                break;
            case "clear":
                // 对于清空操作，清除所有相关缓存
                this.clearTableCache(tableName);
                break;
        }
        
        // 触发缓存事件
        this.emitCacheEvent({
            type: operationType,
            tableName,
            keys,
            filter
        });
    }
}