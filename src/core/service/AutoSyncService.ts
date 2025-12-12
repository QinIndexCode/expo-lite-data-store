// src/core/service/AutoSyncService.ts
import { FileSystemStorageAdapter } from '../adapter/FileSystemStorageAdapter';
import config from '../../liteStore.config';
import { CacheService } from './CacheService';

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
 */
export class AutoSyncService {
  /** 缓存服务实例 */
  private cacheService: CacheService;
  /** 存储适配器实例 */
  private storageAdapter: FileSystemStorageAdapter;
  /** 同步配置 */
  private config: AutoSyncConfig;
  /** 同步定时器ID */
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  /** 是否正在同步中 */
  private isSyncing = false;
  /** 同步统计信息 */
  private stats = {
    /** 总同步次数 */
    syncCount: 0,
    /** 总同步项数 */
    totalItemsSynced: 0,
    /** 上次同步时间 */
    lastSyncTime: 0,
    /** 平均同步耗时（毫秒） */
    avgSyncTime: 0,
  };

  /**
   * 构造函数
   * @param cacheService 缓存服务实例
   * @param storageAdapter 存储适配器实例
   */
  constructor(cacheService: CacheService, storageAdapter: FileSystemStorageAdapter) {
    this.cacheService = cacheService;
    this.storageAdapter = storageAdapter;

    // 初始化配置
    this.config = {
      enabled: config.cache.autoSync?.enabled ?? true,
      interval: config.cache.autoSync?.interval ?? 5000,
      minItems: config.cache.autoSync?.minItems ?? 1,
      batchSize: config.cache.autoSync?.batchSize ?? 100,
    };
  }

  /**
   * 启动自动同步服务
   */
  start(): void {
    if (this.syncTimer || !this.config.enabled) {
      return;
    }

    console.log('[AutoSyncService] 启动自动同步服务', this.config);

    // 立即执行一次同步
    this.sync();

    // 设置定时同步
    this.syncTimer = setInterval(() => {
      this.sync();
    }, this.config.interval);
  }

  /**
   * 停止自动同步服务
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('[AutoSyncService] 停止自动同步服务');
    }
  }

  /**
   * 手动触发同步
   */
  async sync(): Promise<void> {
    if (this.isSyncing) {
      console.log('[AutoSyncService] 跳过同步，已有同步正在进行');
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      // 获取所有脏数据
      const dirtyData = this.cacheService.getDirtyData();
      const dirtyCount = dirtyData.size;

      console.log('[AutoSyncService] 检测到', dirtyCount, '个脏数据项');

      // 检查是否达到同步阈值
      if (dirtyCount < this.config.minItems) {
        console.log('[AutoSyncService] 脏数据数量未达到阈值，跳过同步');
        return;
      }

      // 直接处理脏数据映射，无需按表分组
      // 遍历所有脏数据
      for (const [cacheKey, data] of dirtyData.entries()) {
        // 从缓存键中提取表名
        const tableName = cacheKey.split('_')[0];

        console.log('[AutoSyncService] 同步表', tableName, '的所有数据');

        // 写入磁盘，使用overwrite模式确保数据一致性
        // 因为缓存中存储的是完整的表数据，所以需要使用overwrite模式
        await this.storageAdapter.write(tableName, data, { mode: 'overwrite', directWrite: true });

        // 直接使用缓存键标记为干净数据
        this.cacheService.markAsClean(cacheKey);

        // 更新统计信息
        this.stats.totalItemsSynced += Array.isArray(data) ? data.length : 1;
        console.log('[AutoSyncService] 完成同步表', tableName, '的所有数据');
      }

      // 更新统计信息
      this.stats.syncCount++;
      this.stats.lastSyncTime = Date.now();

      const syncTime = Date.now() - startTime;
      // 平滑更新平均同步耗时
      this.stats.avgSyncTime = (this.stats.avgSyncTime * (this.stats.syncCount - 1) + syncTime) / this.stats.syncCount;

      console.log('[AutoSyncService] 同步完成，耗时', syncTime, 'ms');
    } catch (error) {
      console.error('[AutoSyncService] 同步失败:', error);
    } finally {
      this.isSyncing = false;
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
  updateConfig(newConfig: Partial<AutoSyncConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    console.log('[AutoSyncService] 更新同步配置', this.config);

    // 如果配置改变，重启定时器
    if (newConfig.interval !== undefined && this.syncTimer) {
      this.stop();
      this.start();
    }

    // 如果启用状态改变
    if (newConfig.enabled !== undefined) {
      if (newConfig.enabled && !this.syncTimer) {
        this.start();
      } else if (!newConfig.enabled && this.syncTimer) {
        this.stop();
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stop();
  }
}
