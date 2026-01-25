// src/core/service/AutoSyncService.ts
import { FileSystemStorageAdapter } from '../adapter/FileSystemStorageAdapter';

import { CacheService } from './CacheService';
import { configManager } from '../config/ConfigManager';
import logger from '../../utils/logger';

/**
 * 自动同步服务事件类型常量
 */
export const AUTO_SYNC_EVENTS = {
  SYNC_START: 'syncStart',
  SYNC_COMPLETE: 'syncComplete',
  SYNC_FAILED: 'syncFailed',
  SYNC_ERROR: 'syncError'
} as const;

/**
 * 自动同步服务事件类型
 */
export type AutoSyncEvent = typeof AUTO_SYNC_EVENTS[keyof typeof AUTO_SYNC_EVENTS];

/**
 * 自动同步统计信息接口
 */
export interface AutoSyncStats {
  /** 总同步次数 */
  syncCount: number;
  /** 总同步项数 */
  totalItemsSynced: number;
  /** 上次同步时间 */
  lastSyncTime: number;
  /** 平均同步耗时（毫秒） */
  avgSyncTime: number;
  /** 失败同步次数 */
  failedSyncCount: number;
  /** 成功同步项数 */
  successfulItemsSynced: number;
  /** 失败同步项数 */
  failedItemsSynced: number;
}

/**
 * 自动同步事件数据接口
 */
export interface AutoSyncEventData {
  /** 事件类型 */
  event: AutoSyncEvent;
  /** 同步项数量 */
  itemsCount?: number;
  /** 成功同步项数 */
  successfulItems?: number;
  /** 失败同步项数 */
  failedItems?: number;
  /** 同步耗时（毫秒） */
  syncTime?: number;
  /** 错误信息 */
  error?: Error;
  /** 统计信息 */
  stats?: AutoSyncStats;
}

/**
 * 自动同步事件监听器类型
 */
export type AutoSyncEventListener = (data: AutoSyncEventData) => void;

/**
 * 自动同步服务配置接口
 */
interface AutoSyncConfig {
  /** 是否启用自动同步 */
  enabled: boolean;
  /** 同步间隔（毫秒） */
  interval: number;
  /** 最小同步项数量 */
  minItems: number;
  /** 批量大小限制 */
  batchSize: number;
}

/**
 * 自动同步服务类
 * 定期将缓存中的脏数据同步到磁盘
 * 实现单例模式，确保在任何时候只有一个实例在运行
 */
export class AutoSyncService {
  /** 静态实例，用于单例模式 */
  private static instance: AutoSyncService | null = null;
  /** 缓存服务实例 */
  private cacheService: CacheService;
  /** 存储适配器实例 */
  private storageAdapter: FileSystemStorageAdapter;
  /** 同步配置 */
  private config!: AutoSyncConfig;
  /** 同步定时器ID */
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  /** 是否正在同步中 */
  private isSyncing = false;
  /** 是否正在关闭中 */
  private isShuttingDown = false;
  /** 同步完成的Promise resolve函数 */
  private syncCompleteResolve: (() => void) | null = null;
  /** 事件监听器映射 */
  private eventListeners = new Map<AutoSyncEvent, Set<AutoSyncEventListener>>();
  /** 同步统计信息 */
  private stats: AutoSyncStats = {
    /** 总同步次数 */
    syncCount: 0,
    /** 总同步项数 */
    totalItemsSynced: 0,
    /** 上次同步时间 */
    lastSyncTime: 0,
    /** 平均同步耗时（毫秒） */
    avgSyncTime: 0,
    /** 失败同步次数 */
    failedSyncCount: 0,
    /** 成功同步项数 */
    successfulItemsSynced: 0,
    /** 失败同步项数 */
    failedItemsSynced: 0,
  };

  /**
   * 私有构造函数，防止外部直接实例化
   * @param cacheService 缓存服务实例
   * @param storageAdapter 存储适配器实例
   */
  private constructor(cacheService: CacheService, storageAdapter: FileSystemStorageAdapter) {
    this.cacheService = cacheService;
    this.storageAdapter = storageAdapter;

    // 初始化配置
    this._updateConfigFromGlobalConfig();
    // 验证初始配置
    this._validateConfig(this.config);
  }

  /**
   * 获取单例实例
   * @param cacheService 缓存服务实例
   * @param storageAdapter 存储适配器实例
   * @returns AutoSyncService 单例实例
   */
  public static getInstance(cacheService: CacheService, storageAdapter: FileSystemStorageAdapter): AutoSyncService {
    if (!AutoSyncService.instance) {
      // 创建新实例
      AutoSyncService.instance = new AutoSyncService(cacheService, storageAdapter);
    } else {
      // 更新现有实例的依赖
      AutoSyncService.instance.cacheService = cacheService;
      AutoSyncService.instance.storageAdapter = storageAdapter;
      // 重新更新配置，确保使用最新的全局配置
      AutoSyncService.instance._updateConfigFromGlobalConfig();
      AutoSyncService.instance._validateConfig(AutoSyncService.instance.config);
    }
    return AutoSyncService.instance;
  }

  /**
   * 清理并重置单例实例
   * 用于热更新时清理旧实例
   */
  public static async cleanupInstance(): Promise<void> {
    if (AutoSyncService.instance) {
      await AutoSyncService.instance.cleanup();
      AutoSyncService.instance = null;
      logger.info('[AutoSyncService] Singleton instance cleaned up for hot reload');
    }
  }

  /**
   * 验证配置参数的合理性
   */
  private _validateConfig(config: AutoSyncConfig): void {
    if (typeof config.interval !== 'number' || config.interval <= 0) {
      throw new Error(`Invalid interval: ${config.interval}. Must be a positive number.`);
    }
    if (typeof config.minItems !== 'number' || config.minItems < 0) {
      throw new Error(`Invalid minItems: ${config.minItems}. Must be a non-negative number.`);
    }
    if (typeof config.batchSize !== 'number' || config.batchSize <= 0) {
      throw new Error(`Invalid batchSize: ${config.batchSize}. Must be a positive number.`);
    }
    if (typeof config.enabled !== 'boolean') {
      throw new Error(`Invalid enabled: ${config.enabled}. Must be a boolean.`);
    }
  }

  /**
   * 初始化默认配置
   */
  private _updateConfigFromGlobalConfig(): void {
    const globalConfig = configManager.getConfig();
    this.config = {
      enabled: globalConfig.autoSync?.enabled ?? true,
      interval: globalConfig.autoSync?.interval ?? 5000,
      minItems: globalConfig.autoSync?.minItems ?? 1,
      batchSize: globalConfig.autoSync?.batchSize ?? 100,
    };
  }

  /**
   * 启动自动同步服务
   * @param forceUpdateConfig 是否强制从全局配置更新（默认为false，保留当前实例配置）
   */
  start(forceUpdateConfig: boolean = false): void {
    // 只有在forceUpdateConfig为true时，才从全局配置更新
    if (forceUpdateConfig) {
      this._updateConfigFromGlobalConfig();
      this._validateConfig(this.config);
    }
    
    // 如果定时器已经存在，先清除它，然后重新启动
    if (this.syncTimer) {
      logger.info('[AutoSyncService] Sync timer already exists, restarting with new config', this.config);
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (!this.config.enabled) {
      logger.info('[AutoSyncService] Auto-sync is disabled in config');
      return;
    }

    logger.info('[AutoSyncService] Starting auto-sync service with config', this.config);

    // 立即执行一次同步（不等待完成，避免阻塞启动）
    this.sync().catch(error => {
      logger.error('[AutoSyncService] Initial sync failed', error);
    });

    // 设置定时同步
    this.syncTimer = setInterval(() => {
      this.sync().catch(error => {
        logger.error('[AutoSyncService] Scheduled sync failed', error);
      });
    }, this.config.interval);
    
    // 确保定时器被正确设置
    if (!this.syncTimer) {
      logger.error('[AutoSyncService] Failed to create sync timer');
    }
  }

  /**
   * 停止自动同步服务
   */
  async stop(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      logger.info('[AutoSyncService] Stopping auto-sync service');
    }

    // 等待正在进行的同步完成
    if (this.isSyncing) {
      logger.info('[AutoSyncService] Waiting for ongoing sync to complete...');
      await new Promise<void>(resolve => {
        // 如果已经有等待的Promise，保存它以便后续处理
        const existingResolve = this.syncCompleteResolve;
        this.syncCompleteResolve = () => {
          resolve();
          if (existingResolve) {
            existingResolve();
          }
        };
      });
      logger.info('[AutoSyncService] Ongoing sync completed');
    }
  }

  /**
   * 带重试机制的写入操作
   */
  private async writeWithRetry(tableName: string, data: any, cacheKey: string, maxRetries: number = 3): Promise<boolean> {
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        attempt++;
        await this.storageAdapter.write(tableName, data, { mode: 'overwrite', directWrite: true });
        return true;
      } catch (error) {
        // 区分不同类型的错误
        const isTransientError = this._isTransientError(error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // 根据尝试次数和错误类型调整日志级别
        if (attempt < maxRetries && isTransientError) {
          logger.warn('[AutoSyncService] Attempt', attempt, 'failed to sync item', cacheKey, 'for table', tableName, ':', errorMessage);
        } else {
          logger.error('[AutoSyncService] Attempt', attempt, 'failed to sync item', cacheKey, 'for table', tableName, ':', errorMessage);
        }
        
        // 只有短暂性错误才重试
        if (attempt < maxRetries && isTransientError) {
          // 指数退避重试，带随机抖动避免雪崩
          const baseDelay = Math.pow(2, attempt - 1) * 500; // 从500ms开始，而不是1000ms
          const jitter = Math.random() * 250; // 0-250ms随机抖动，减少资源竞争
          const delay = baseDelay + jitter;
          logger.info('[AutoSyncService] Retrying in', Math.round(delay), 'ms...');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // 非短暂性错误或重试次数用完，直接失败
          logger.error('[AutoSyncService] Giving up on syncing item', cacheKey, 'for table', tableName, '-', isTransientError ? 'max retries reached' : 'non-transient error');
          break;
        }
      }
    }
    return false;
  }

  /**
   * 判断是否为短暂性错误（可以重试）
   */
  private _isTransientError(error: any): boolean {
    if (!(error instanceof Error)) {
      return true; // 未知错误类型，默认可以重试
    }
    
    const errorMessage = error.message.toLowerCase();
    // 常见的短暂性错误关键词
    const transientErrorKeywords = ['timeout', 'network', 'connection', 'retry', 'temporary', 'busy', 'locked', 'concurrency'];
    
    return transientErrorKeywords.some(keyword => errorMessage.includes(keyword));
  }

  /**
   * 手动触发同步
   */
  async sync(): Promise<void> {
    if (this.isSyncing || this.isShuttingDown) {
      logger.info('[AutoSyncService] Skipping sync, already in progress or shutting down');
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const successfulWrites: string[] = [];
    const failedWrites: string[] = [];

    try {
      // 获取所有脏数据
      const dirtyData = this.cacheService.getDirtyData();
      const dirtyCount = dirtyData.size;

      logger.info('[AutoSyncService] Detected', dirtyCount, 'dirty items');

      // 检查是否达到同步阈值
      if (dirtyCount < this.config.minItems) {
        logger.info('[AutoSyncService] Dirty item count below threshold, skipping sync');
        return;
      }

      // 触发同步开始事件
      this.emit('syncStart', {
        itemsCount: dirtyCount,
      });

      // 将脏数据按表名分组
      const groupedDirtyData = new Map<string, Array<{ cacheKey: string; data: any }>>();
      for (const [cacheKey, data] of dirtyData.entries()) {
        let tableName = '';
        let isValid = false;
        
        try {
          // 从缓存键中提取表名（缓存键格式：tableName_id或tableName_suffix_id）
          const cacheKeyParts = cacheKey.split('_');
          
          // 查找第一个ID部分，前面的部分组合成表名
          for (let i = 0; i < cacheKeyParts.length; i++) {
            const part = cacheKeyParts[i];
            // 如果是纯数字或者看起来像ID（例如UUID），则前面的部分是表名
            if (/^\d+$/.test(part) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(part)) {
              // 找到ID部分，前面的部分是表名
              tableName = cacheKeyParts.slice(0, i).join('_');
              isValid = tableName.length > 0;
              break;
            }
          }
          
          // 如果没有找到数字部分，使用缓存键的第一部分作为表名
          if (!isValid) {
            tableName = cacheKeyParts[0];
            isValid = tableName.length > 0;
          }
          
          if (!isValid || tableName.length === 0) {
            throw new Error('Could not extract table name from cache key');
          }
          
          if (!groupedDirtyData.has(tableName)) {
            groupedDirtyData.set(tableName, []);
          }
          groupedDirtyData.get(tableName)!.push({ cacheKey, data });
        } catch (error) {
          logger.error('[AutoSyncService] Failed to process cache key:', cacheKey, error);
          failedWrites.push(cacheKey);
        }
      }

      // 处理每个表的脏数据
      for (const [tableName, items] of groupedDirtyData.entries()) {
        logger.info('[AutoSyncService] Syncing', items.length, 'items for table', tableName);
        
        // 按batchSize批量处理
        for (let i = 0; i < items.length; i += this.config.batchSize) {
          const batchItems = items.slice(i, i + this.config.batchSize);
          logger.info('[AutoSyncService] Processing batch', Math.floor(i / this.config.batchSize) + 1, 'of', Math.ceil(items.length / this.config.batchSize), 'for table', tableName);
          
          try {
            // 注意：我们直接写入脏数据，使用overwrite模式
            // 这是因为：
            // 1. 我们已经从缓存中获取了脏数据，它包含了完整的表数据
            // 2. 我们信任缓存中的数据是最新的
            // 3. 这种方式更简单，避免了复杂的合并逻辑
            
            // 对于每个表，我们只需要写入一次，包含所有脏数据
            // 注意：这里我们假设每个表只有一个批次，或者最后一个批次包含完整的表数据
            if (i === 0) {
              // 只处理第一个批次，写入完整的表数据
              // 我们需要确保batchData包含完整的表数据
              const batchData = batchItems.map(({ data }) => data);
              const cacheKeys = batchItems.map(({ cacheKey }) => cacheKey);
              
              // 执行批量写入
              const success = await this.writeWithRetry(tableName, batchData, cacheKeys.join(','));
              
              if (success) {
                // 使用批量标记方法提高性能
                this.cacheService.markAsCleanBulk(cacheKeys);
                
                // 更新统计信息
                const totalItems = batchData.length;
                this.stats.totalItemsSynced += totalItems;
                successfulWrites.push(...cacheKeys);
              } else {
                // 批量写入失败，所有项目都标记为失败
                failedWrites.push(...cacheKeys);
                logger.error('[AutoSyncService] All retries failed for batch items', cacheKeys, 'for table', tableName);
              }
            }
          } catch (error) {
            logger.error('[AutoSyncService] Unexpected error syncing batch for table', tableName, ':', error);
            // 批量处理失败，所有项目都标记为失败
            batchItems.forEach(({ cacheKey }) => {
              failedWrites.push(cacheKey);
            });
          }
        }
        
        logger.info('[AutoSyncService] Completed sync for table', tableName);
      }

      // 更新统计信息
      this.stats.syncCount++;
      this.stats.lastSyncTime = Date.now();
      this.stats.successfulItemsSynced += successfulWrites.length;
      this.stats.failedItemsSynced += failedWrites.length;

      const syncTime = Date.now() - startTime;
      // 平滑更新平均同步耗时
      this.stats.avgSyncTime = (this.stats.avgSyncTime * (this.stats.syncCount - 1) + syncTime) / this.stats.syncCount;

      logger.info('[AutoSyncService] Sync completed:', {
        totalItems: successfulWrites.length + failedWrites.length,
        successfulItems: successfulWrites.length,
        failedItems: failedWrites.length,
        syncTime,
      });

      // 触发同步完成事件
      this.emit('syncComplete', {
        itemsCount: successfulWrites.length + failedWrites.length,
        successfulItems: successfulWrites.length,
        failedItems: failedWrites.length,
        syncTime,
        stats: { ...this.stats },
      });
    } catch (error) {
      logger.error('[AutoSyncService] Sync failed with critical error:', error);
      this.stats.failedSyncCount++;
      
      const syncTime = Date.now() - startTime;
      // 触发同步错误事件
      this.emit('syncError', {
        syncTime,
        error: error as Error,
        stats: { ...this.stats },
      });
      // 触发同步失败事件（向后兼容）
      this.emit('syncFailed', {
        syncTime,
        error: error as Error,
        stats: { ...this.stats },
      });
    } finally {
      this.isSyncing = false;
      // 通知等待的关闭操作
      if (this.syncCompleteResolve) {
        this.syncCompleteResolve();
        this.syncCompleteResolve = null;
      }
    }
  }

  /**
   * 获取同步统计信息
   * @returns 同步统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 获取当前同步配置
   * @returns 同步配置
   */
  getConfig(): AutoSyncConfig {
    return { ...this.config };
  }

  /**
   * 更新同步配置
   * @param newConfig 新的同步配置
   */
  async updateConfig(newConfig: Partial<AutoSyncConfig>): Promise<void> {
    // 创建临时的完整配置用于验证
    const tempConfig = {
      ...this.config,
      ...newConfig,
    };
    
    // 验证完整配置
    this._validateConfig(tempConfig);

    this.config = tempConfig;

    logger.info('[AutoSyncService] Updated sync configuration', this.config);

    // 如果配置改变，重启定时器
    if (newConfig.interval !== undefined && this.syncTimer) {
      await this.stop();
      // 不强制从全局配置更新，保留当前实例配置
      this.start(false);
    }

    // 如果启用状态改变
    if (newConfig.enabled !== undefined) {
      if (newConfig.enabled && !this.syncTimer) {
        // 不强制从全局配置更新，保留当前实例配置
        this.start(false);
      } else if (!newConfig.enabled && this.syncTimer) {
        await this.stop();
      }
    }
  }

  /**
   * 添加事件监听器
   */
  on(event: AutoSyncEvent, listener: AutoSyncEventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * 移除事件监听器
   */
  off(event: AutoSyncEvent, listener: AutoSyncEventListener): void {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event)!.delete(listener);
      if (this.eventListeners.get(event)!.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * 添加一次性事件监听器
   */
  once(event: AutoSyncEvent, listener: AutoSyncEventListener): void {
    const onceListener = (data: AutoSyncEventData) => {
      listener(data);
      this.off(event, onceListener);
    };
    this.on(event, onceListener);
  }

  /**
   * 触发事件
   */
  private emit(event: AutoSyncEvent, data: Omit<AutoSyncEventData, 'event'>): void {
    if (this.eventListeners.has(event)) {
      const fullData = { event, ...data };
      for (const listener of this.eventListeners.get(event)!) {
        try {
          listener(fullData);
        } catch (error) {
          logger.error('[AutoSyncService] Error in event listener:', error);
        }
      }
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    logger.info('[AutoSyncService] Starting cleanup...');
    this.isShuttingDown = true;
    await this.stop();
    // 清理所有事件监听器
    this.eventListeners.clear();
    // 重置关闭状态，允许后续重新启动
    this.isShuttingDown = false;
    logger.info('[AutoSyncService] Cleanup completed');
  }
}
