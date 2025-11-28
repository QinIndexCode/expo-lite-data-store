// src/core/cache/CacheManager.ts

/**
 * 缓存策略枚举
 */
export enum CacheStrategy {
    LRU = "lru", // 最近最少使用
    LFU = "lfu"  // 最不经常使用
}

/**
 * 缓存项接口
 */
export interface CacheItem {
    /**
     * 缓存数据
     */
    data: any;
    /**
     * 过期时间戳（毫秒）
     */
    expiry: number;
    /**
     * 访问次数（用于LFU策略）
     */
    accessCount: number;
    /**
     * 最后访问时间（用于LRU策略）
     */
    lastAccess: number;
    /**
     * 是否为脏数据（需要写入磁盘）
     */
    dirty: boolean;
    /**
     * 缓存键（用于快速访问）
     */
    key?: string;
    /**
     * 前一个节点（用于LRU双向链表）
     */
    prev?: CacheItem | null;
    /**
     * 后一个节点（用于LRU双向链表）
     */
    next?: CacheItem | null;
}

/**
 * 缓存配置接口
 */
export interface CacheConfig {
    /**
     * 缓存策略
     */
    strategy: CacheStrategy;
    /**
     * 缓存最大容量（项数）
     */
    maxSize: number;
    /**
     * 缓存最大内存使用量（字节）
     */
    maxMemoryUsage?: number;
    /**
     * 内存使用阈值，超过该阈值时触发清理（百分比，0-1）
     */
    memoryThreshold?: number;
    /**
     * 默认过期时间（毫秒）
     */
    defaultExpiry: number;
    /**
     * 是否启用缓存穿透防护
     */
    enablePenetrationProtection: boolean;
    /**
     * 是否启用缓存击穿防护
     */
    enableBreakdownProtection: boolean;
    /**
     * 是否启用缓存雪崩防护
     */
    enableAvalancheProtection: boolean;
    /**
     * 缓存雪崩防护的随机过期时间范围（毫秒）
     */
    avalancheRandomExpiry: [number, number];
}

/**
 * 缓存统计信息接口
 */
export interface CacheStats {
    /**
     * 缓存命中率
     */
    hitRate: number;
    /**
     * 缓存命中次数
     */
    hits: number;
    /**
     * 缓存未命中次数
     */
    misses: number;
    /**
     * 缓存项数量
     */
    size: number;
    /**
     * 缓存最大容量
     */
    maxSize: number;
    /**
     * 缓存淘汰次数
     */
    evictions: number;
    /**
     * 缓存写入次数
     */
    writes: number;
    /**
     * 缓存读取次数
     */
    reads: number;
    /**
     * 当前内存使用量（字节）
     */
    memoryUsage: number;
    /**
     * 缓存最大内存使用量（字节）
     */
    maxMemoryUsage: number;
}

/**
     * 缓存管理器类
     * 
     * 设计模式：单例模式 + 策略模式
     * 用途：管理缓存数据，实现不同的缓存策略和防护措施
     * 优势：
     * - 支持多种缓存策略（LRU/LFU）
     * - 实现了完整的缓存防护措施
     * - 提供了缓存统计信息
     * - 线程安全的缓存操作
     * - 支持缓存一致性维护
     * - 基于内存使用量的智能清理
     */
export class CacheManager {
    /**
     * 缓存数据映射
     */
    private cache = new Map<string, CacheItem>();
    
    /**
     * LRU双向链表节点
     */
    private lruHead: CacheItem | null = null;
    private lruTail: CacheItem | null = null;
    
    /**
     * LRU节点映射，用于快速访问节点
     */
    private lruNodeMap = new Map<string, CacheItem>();
    
    /**
     * LFU频率映射，key为访问次数，value为该频率的所有缓存项
     */
    private lfuFreqMap = new Map<number, Set<string>>();
    
    /**
     * 当前最小访问频率
     */
    private lfuMinFreq = 0;
    
    /**
     * 缓存配置
     */
    private config: CacheConfig;
    
    /**
     * 缓存统计信息
     */
    private stats: CacheStats = {
        hitRate: 0,
        hits: 0,
        misses: 0,
        size: 0,
        maxSize: 0,
        evictions: 0,
        writes: 0,
        reads: 0,
        memoryUsage: 0,
        maxMemoryUsage: 0
    };
    
    /**
     * 互斥锁，用于保证线程安全
     */
    private mutex = new Map<string, Promise<void>>();
    
    /**
     * 构造函数
     * 
     * @param config 缓存配置
     */
    constructor(config: Partial<CacheConfig> = {}) {
        // 默认配置
        this.config = {
            strategy: CacheStrategy.LRU,
            maxSize: 1000,
            defaultExpiry: 3600000, // 1小时
            enablePenetrationProtection: true,
            enableBreakdownProtection: true,
            enableAvalancheProtection: true,
            avalancheRandomExpiry: [0, 300000], // 0-5分钟
            memoryThreshold: 0.8, // 默认80%阈值
            ...config
        };
        
        // 初始化统计信息
        this.stats.maxSize = this.config.maxSize;
        this.stats.maxMemoryUsage = this.config.maxMemoryUsage || 0;
        
        // 定期清理过期缓存
        this.startCleanupTimer();
    }
    
    /**
     * 将节点添加到LRU链表头部
     * @param key 缓存键
     * @param item 缓存项
     */
    private addToLRUHead(key: string, item: CacheItem): void {
        item.key = key;
        item.prev = null;
        item.next = this.lruHead;
        
        if (this.lruHead) {
            this.lruHead.prev = item;
        }
        this.lruHead = item;
        
        if (!this.lruTail) {
            this.lruTail = item;
        }
        
        this.lruNodeMap.set(key, item);
    }
    
    /**
     * 从LRU链表中移除节点
     * @param key 缓存键
     */
    private removeFromLRU(key: string): void {
        const item = this.lruNodeMap.get(key);
        if (!item) return;
        
        if (item.prev) {
            item.prev.next = item.next || null;
        } else {
            this.lruHead = item.next || null;
        }
        
        if (item.next) {
            item.next.prev = item.prev || null;
        } else {
            this.lruTail = item.prev || null;
        }
        
        this.lruNodeMap.delete(key);
    }
    
    /**
     * 将节点移动到LRU链表头部
     * @param key 缓存键
     */
    private moveToLRUHead(key: string): void {
        this.removeFromLRU(key);
        const item = this.cache.get(key);
        if (item) {
            this.addToLRUHead(key, item);
        }
    }
    
    /**
     * 更新LFU频率
     * @param key 缓存键
     */
    private updateLFU(key: string): void {
        const item = this.cache.get(key);
        if (!item) return;
        
        // 移除旧频率
        const oldFreq = item.accessCount;
        const oldFreqSet = this.lfuFreqMap.get(oldFreq);
        if (oldFreqSet) {
            oldFreqSet.delete(key);
            if (oldFreqSet.size === 0) {
                this.lfuFreqMap.delete(oldFreq);
                // 如果当前是最小频率，更新最小频率
                if (oldFreq === this.lfuMinFreq) {
                    this.lfuMinFreq++;
                }
            }
        }
        
        // 增加访问次数
        item.accessCount++;
        const newFreq = item.accessCount;
        
        // 添加到新频率
        if (!this.lfuFreqMap.has(newFreq)) {
            this.lfuFreqMap.set(newFreq, new Set());
        }
        this.lfuFreqMap.get(newFreq)?.add(key);
    }
    
    /**
     * 从LFU中移除项
     * @returns 被移除的缓存键
     */
    private removeLFUItem(): string | undefined {
        // 找到最小频率的集合
        const minFreqSet = this.lfuFreqMap.get(this.lfuMinFreq);
        if (!minFreqSet || minFreqSet.size === 0) return undefined;
        
        // 移除第一个元素
        const keyResult = minFreqSet.values().next();
        if (keyResult.done) return undefined;
        
        const key = keyResult.value;
        if (key) {
            minFreqSet.delete(key);
            
            // 如果集合为空，删除该频率
            if (minFreqSet.size === 0) {
                this.lfuFreqMap.delete(this.lfuMinFreq);
            }
        }
        
        return key;
    }
    
    /**
     * 启动定期清理过期缓存的定时器
     */
    private startCleanupTimer(): void {
        // 每5分钟清理一次过期缓存
        setInterval(() => {
            this.cleanupExpired();
        }, 300000);
    }
    
    /**
     * 清理过期缓存
     */
    private cleanupExpired(): void {
        const now = Date.now();
        let removed = 0;
        
        for (const [key, item] of this.cache.entries()) {
            if (item.expiry < now) {
                // 减去过期项的大小
                const itemSize = this.calculateDataSize(item.data);
                this.stats.memoryUsage -= itemSize;
                
                // 从LRU或LFU中移除
                if (this.config.strategy === CacheStrategy.LRU) {
                    this.removeFromLRU(key);
                } else if (this.config.strategy === CacheStrategy.LFU) {
                    const freq = item.accessCount;
                    const freqSet = this.lfuFreqMap.get(freq);
                    if (freqSet) {
                        freqSet.delete(key);
                        if (freqSet.size === 0) {
                            this.lfuFreqMap.delete(freq);
                            if (freq === this.lfuMinFreq) {
                                this.lfuMinFreq++;
                            }
                        }
                    }
                }
                
                this.cache.delete(key);
                removed++;
            }
        }
        
        if (removed > 0) {
            this.updateStats();
        }
    }
    
    /**
     * 计算数据大小（字节）
     * @param data 要计算大小的数据
     * @returns 数据大小（字节）
     */
    private calculateDataSize(data: any): number {
        if (data === null || data === undefined) {
            return 0;
        }
        
        switch (typeof data) {
            case 'string':
                // 每个字符2字节（UTF-16）
                return data.length * 2;
            case 'number':
                // 数字占8字节
                return 8;
            case 'boolean':
                // 布尔值占1字节
                return 1;
            case 'object':
                if (Array.isArray(data)) {
                    // 数组：递归计算每个元素大小
                    return data.reduce((total, item) => total + this.calculateDataSize(item), 0);
                } else {
                    // 对象：递归计算每个属性大小
                    return Object.entries(data).reduce((total, [key, value]) => {
                        return total + this.calculateDataSize(key) + this.calculateDataSize(value);
                    }, 0);
                }
            default:
                return 0;
        }
    }
    
    /**
     * 更新缓存统计信息
     */
    private updateStats(): void {
        this.stats.size = this.cache.size;
        this.stats.hitRate = this.stats.reads > 0 
            ? this.stats.hits / this.stats.reads 
            : 0;
    }
    
    /**
     * 计算缓存过期时间
     * 
     * @param customExpiry 自定义过期时间（毫秒）
     * @returns 计算后的过期时间戳
     */
    private calculateExpiry(customExpiry?: number): number {
        const baseExpiry = customExpiry || this.config.defaultExpiry;
        const now = Date.now();
        
        // 如果启用了缓存雪崩防护且过期时间较长（>1秒），添加随机过期时间
        if (this.config.enableAvalancheProtection && baseExpiry > 1000) {
            const [min, max] = this.config.avalancheRandomExpiry;
            const randomExpiry = Math.random() * (max - min) + min;
            return now + baseExpiry + randomExpiry;
        }
        
        return now + baseExpiry;
    }
    
    /**
     * 根据缓存策略淘汰缓存项
     */
    private evictItem(): void {
        if (this.cache.size <= this.config.maxSize) {
            return;
        }
        
        let evictKey: string | undefined;
        
        switch (this.config.strategy) {
            case CacheStrategy.LRU:
                // 从LRU链表尾部移除最旧的项
                if (this.lruTail && this.lruTail.key) {
                    evictKey = this.lruTail.key;
                    this.removeFromLRU(evictKey);
                }
                break;
            case CacheStrategy.LFU:
                // 从LFU中移除最小频率的项
                evictKey = this.removeLFUItem();
                break;
        }
        
        if (evictKey) {
            const item = this.cache.get(evictKey);
            if (item) {
                const itemSize = this.calculateDataSize(item.data);
                this.stats.memoryUsage -= itemSize;
            }
            this.cache.delete(evictKey);
            this.stats.evictions++;
            this.updateStats();
        }
    }
    
    /**
     * 根据内存使用量清理缓存
     */
    private cleanupByMemoryUsage(): void {
        // 如果没有配置最大内存使用量，直接返回
        if (!this.config.maxMemoryUsage) {
            return;
        }
        
        // 计算内存使用阈值
        const threshold = this.config.maxMemoryUsage * (this.config.memoryThreshold || 0.8);
        
        // 如果当前内存使用量未超过阈值，直接返回
        if (this.stats.memoryUsage <= threshold) {
            return;
        }
        
        // 需要清理的目标内存使用量（清理到阈值的70%）
        const targetUsage = this.config.maxMemoryUsage * 0.7;
        
        // 开始清理，直到达到目标使用量或缓存为空
        while (this.stats.memoryUsage > targetUsage && this.cache.size > 0) {
            this.evictItem();
        }
    }
    
    /**
     * 获取缓存项
     * 
     * @param key 缓存键
     * @returns 缓存项，如果不存在或已过期则返回undefined
     */
    private getCacheItem(key: string): CacheItem | undefined {
        const item = this.cache.get(key);
        if (!item) {
            return undefined;
        }
        
        // 检查是否过期
        if (item.expiry < Date.now()) {
            this.cache.delete(key);
            // 从LRU或LFU中移除
            if (this.config.strategy === CacheStrategy.LRU) {
                this.removeFromLRU(key);
            } else if (this.config.strategy === CacheStrategy.LFU) {
                this.updateLFU(key); // 这会移除旧频率
            }
            this.updateStats();
            return undefined;
        }
        
        // 更新访问信息
        item.lastAccess = Date.now();
        
        // 根据策略更新缓存结构
        if (this.config.strategy === CacheStrategy.LRU) {
            this.moveToLRUHead(key);
        } else if (this.config.strategy === CacheStrategy.LFU) {
            this.updateLFU(key);
        }
        
        return item;
    }
    
    /**
     * 设置缓存项
     * 
     * @param key 缓存键
     * @param data 缓存数据
     * @param expiry 自定义过期时间（毫秒）
     * @param dirty 是否为脏数据
     */
    private setCacheItem(key: string, data: any, expiry?: number, dirty: boolean = false): void {
        const now = Date.now();
        const dataSize = this.calculateDataSize(data);
        
        // 如果键已存在，先移除旧项并减去其大小
        if (this.cache.has(key)) {
            const oldItem = this.cache.get(key);
            if (oldItem) {
                const oldSize = this.calculateDataSize(oldItem.data);
                this.stats.memoryUsage -= oldSize;
            }
            
            if (this.config.strategy === CacheStrategy.LRU) {
                this.removeFromLRU(key);
            } else if (this.config.strategy === CacheStrategy.LFU) {
                const oldItem = this.cache.get(key);
                if (oldItem) {
                    const oldFreq = oldItem.accessCount;
                    const oldFreqSet = this.lfuFreqMap.get(oldFreq);
                    if (oldFreqSet) {
                        oldFreqSet.delete(key);
                        if (oldFreqSet.size === 0) {
                            this.lfuFreqMap.delete(oldFreq);
                            if (oldFreq === this.lfuMinFreq) {
                                this.lfuMinFreq++;
                            }
                        }
                    }
                }
            }
        }
        
        const cacheItem: CacheItem = {
            data,
            expiry: this.calculateExpiry(expiry),
            accessCount: 1,
            lastAccess: now,
            dirty
        };
        
        this.cache.set(key, cacheItem);
        this.stats.writes++;
        
        // 添加新数据的大小
        this.stats.memoryUsage += dataSize;
        
        // 根据策略更新缓存结构
        if (this.config.strategy === CacheStrategy.LRU) {
            this.addToLRUHead(key, cacheItem);
        } else if (this.config.strategy === CacheStrategy.LFU) {
            // 新项的访问频率为1
            if (!this.lfuFreqMap.has(1)) {
                this.lfuFreqMap.set(1, new Set());
            }
            this.lfuFreqMap.get(1)?.add(key);
            this.lfuMinFreq = 1;
        }
        
        // 如果缓存已满，淘汰旧项
        this.evictItem();
        
        // 检查内存使用量，如果超过阈值则清理
        this.cleanupByMemoryUsage();
        
        this.updateStats();
    }
    
    /**
     * 获取缓存数据
     * 
     * @param key 缓存键
     * @returns 缓存数据，如果不存在或已过期则返回undefined
     */
    get(key: string): any {
        this.stats.reads++;
        
        const item = this.getCacheItem(key);
        if (item) {
            this.stats.hits++;
            this.updateStats();
            return item.data;
        }
        
        this.stats.misses++;
        this.updateStats();
        return undefined;
    }
    
    /**
     * 设置缓存数据
     * 
     * @param key 缓存键
     * @param data 缓存数据
     * @param expiry 自定义过期时间（毫秒）
     * @param dirty 是否为脏数据
     */
    set(key: string, data: any, expiry?: number, dirty: boolean = false): void {
        this.setCacheItem(key, data, expiry, dirty);
    }
    
    /**
     * 删除缓存数据
     * 
     * @param key 缓存键
     */
    delete(key: string): void {
        if (this.cache.has(key)) {
            // 减去要删除项的大小
            const item = this.cache.get(key);
            if (item) {
                const itemSize = this.calculateDataSize(item.data);
                this.stats.memoryUsage -= itemSize;
            }
            
            // 从LRU或LFU中移除
            if (this.config.strategy === CacheStrategy.LRU) {
                this.removeFromLRU(key);
            } else if (this.config.strategy === CacheStrategy.LFU) {
                const item = this.cache.get(key);
                if (item) {
                    const freq = item.accessCount;
                    const freqSet = this.lfuFreqMap.get(freq);
                    if (freqSet) {
                        freqSet.delete(key);
                        if (freqSet.size === 0) {
                            this.lfuFreqMap.delete(freq);
                            if (freq === this.lfuMinFreq) {
                                this.lfuMinFreq++;
                            }
                        }
                    }
                }
            }
            this.cache.delete(key);
            this.updateStats();
        }
    }
    
    /**
     * 清空缓存
     */
    clear(): void {
        this.cache.clear();
        // 清空LRU相关数据结构
        this.lruHead = null;
        this.lruTail = null;
        this.lruNodeMap.clear();
        // 清空LFU相关数据结构
        this.lfuFreqMap.clear();
        this.lfuMinFreq = 0;
        // 重置内存使用量
        this.stats.memoryUsage = 0;
        this.updateStats();
    }
    
    /**
     * 标记缓存项为脏数据
     * 
     * @param key 缓存键
     */
    markAsDirty(key: string): void {
        const item = this.cache.get(key);
        if (item) {
            item.dirty = true;
        }
    }
    
    /**
     * 标记缓存项为干净数据
     * 
     * @param key 缓存键
     */
    markAsClean(key: string): void {
        const item = this.cache.get(key);
        if (item) {
            item.dirty = false;
        }
    }
    
    /**
     * 获取所有脏数据
     * 
     * @returns 脏数据映射，键为缓存键，值为缓存数据
     */
    getDirtyData(): Map<string, any> {
        const dirtyData = new Map<string, any>();
        for (const [key, item] of this.cache.entries()) {
            if (item.dirty) {
                dirtyData.set(key, item.data);
            }
        }
        return dirtyData;
    }
    
    /**
     * 获取缓存统计信息
     * 
     * @returns 缓存统计信息
     */
    getStats(): CacheStats {
        return { ...this.stats };
    }
    
    /**
     * 获取缓存大小
     * 
     * @returns 缓存项数量
     */
    getSize(): number {
        return this.cache.size;
    }
    
    /**
     * 检查缓存键是否存在
     * 
     * @param key 缓存键
     * @returns 是否存在
     */
    has(key: string): boolean {
        return this.getCacheItem(key) !== undefined;
    }
    
    /**
     * 加锁，用于保证线程安全
     * 
     * @param key 锁键
     * @returns 解锁函数
     */
    private async lock(key: string): Promise<() => void> {
        // 等待之前的锁释放
        while (this.mutex.has(key)) {
            await this.mutex.get(key);
        }
        
        let resolve: () => void;
        const promise = new Promise<void>((res) => {
            resolve = res;
        });
        
        this.mutex.set(key, promise);
        
        return () => {
            resolve!();
            this.mutex.delete(key);
        };
    }
    
    /**
     * 线程安全的获取缓存数据
     * 
     * @param key 缓存键
     * @param fetchFn 获取数据的函数（当缓存不存在时调用）
     * @param expiry 自定义过期时间（毫秒）
     * @returns 缓存数据
     */
    async getSafe(key: string, fetchFn: () => Promise<any>, expiry?: number): Promise<any> {
        // 先尝试从缓存获取
        let data = this.get(key);
        if (data !== undefined) {
            return data;
        }
        
        // 加锁，防止缓存击穿
        const unlock = await this.lock(key);
        try {
            // 再次检查缓存，防止重复获取
            data = this.get(key);
            if (data !== undefined) {
                return data;
            }
            
            // 获取数据
            data = await fetchFn();
            
            // 设置缓存
            this.set(key, data, expiry);
            
            return data;
        } finally {
            unlock();
        }
    }
    
    /**
     * 线程安全的设置缓存数据
     * 
     * @param key 缓存键
     * @param data 缓存数据
     * @param expiry 自定义过期时间（毫秒）
     * @param dirty 是否为脏数据
     */
    async setSafe(key: string, data: any, expiry?: number, dirty: boolean = false): Promise<void> {
        const unlock = await this.lock(key);
        try {
            this.set(key, data, expiry, dirty);
        } finally {
            unlock();
        }
    }
    
    /**
     * 缓存穿透防护：获取缓存数据，如果不存在则返回默认值
     * 
     * @param key 缓存键
     * @param fetchFn 获取数据的函数
     * @param defaultValue 默认值
     * @param expiry 自定义过期时间（毫秒）
     * @returns 缓存数据或默认值
     */
    async getWithPenetrationProtection(key: string, fetchFn: () => Promise<any>, defaultValue: any = null, expiry?: number): Promise<any> {
        if (!this.config.enablePenetrationProtection) {
            return this.getSafe(key, fetchFn, expiry);
        }
        
        try {
            const data = await this.getSafe(key, fetchFn, expiry);
            if (data === null || data === undefined) {
                // 缓存穿透防护：将默认值存入缓存
                this.set(key, defaultValue, expiry || 60000); // 缓存1分钟
                return defaultValue;
            }
            return data;
        } catch (error) {
            // 缓存穿透防护：发生错误时返回默认值
            return defaultValue;
        }
    }
}