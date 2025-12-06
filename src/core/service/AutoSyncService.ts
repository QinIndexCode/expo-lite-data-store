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

      // 按表分组，批量同步
      const tableDataMap = this.groupDataByTable(dirtyData);

      for (const [tableName, dataItems] of tableDataMap.entries()) {
        console.log('[AutoSyncService] 同步表', tableName, '的', dataItems.length, '个项目');

        // 分批次同步，避免单次操作过大
        for (let i = 0; i < dataItems.length; i += this.config.batchSize) {
          const batch = dataItems.slice(i, i + this.config.batchSize);

          // 写入磁盘
          await this.storageAdapter.write(tableName, batch, { mode: 'overwrite' });

          // 标记为干净数据
          batch.forEach(item => {
            // 假设每个项目都有id字段作为缓存键
            const cacheKey = `${tableName}_${item.id}`;
            this.cacheService.markAsClean(cacheKey);
          });

          // 更新统计信息
          this.stats.totalItemsSynced += batch.length;
          console.log('[AutoSyncService] 完成同步表', tableName, '的', batch.length, '个项目');
        }
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
   * 按表分组脏数据
   * @param dirtyData 脏数据映射
   * @returns 按表分组的数据
   */
  private groupDataByTable(dirtyData: Map<string, any>): Map<string, any[]> {
    const tableDataMap = new Map<string, any[]>();

    for (const [cacheKey, data] of dirtyData.entries()) {
      // 从缓存键中提取表名，假设缓存键格式为 "tableName_id"
      const tableName = cacheKey.split('_')[0];

      if (!tableDataMap.has(tableName)) {
        tableDataMap.set(tableName, []);
      }

      tableDataMap.get(tableName)?.push(data);
    }

    return tableDataMap;
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
