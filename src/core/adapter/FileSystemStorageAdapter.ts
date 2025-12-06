// src/core/adapter/FileSystemStorageAdapter.ts
import config from '../../liteStore.config';
import { StorageTaskProcessor } from '../../taskQueue/StorageTaskProcessor';
import { taskQueue } from '../../taskQueue/taskQueue';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { IStorageAdapter } from '../../types/storageAdapterInfc';
import { StorageError } from '../../types/storageErrorInfc';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from '../../types/storageTypes';
import { FileOperationManager } from '../FileOperationManager';
import { CacheConfig, CacheManager, CacheStrategy } from '../cache/CacheManager';
import { CACHE } from '../constants';
import { DataReader } from '../data/DataReader';
import { DataWriter } from '../data/DataWriter';
import { IndexManager } from '../index/IndexManager';
import { MetadataManager } from '../meta/MetadataManager';
import { CacheMonitor } from '../monitor/CacheMonitor';
import { performanceMonitor } from '../monitor/PerformanceMonitor';
import { CacheService } from '../service/CacheService';
import { TransactionService } from '../service/TransactionService';
import { AutoSyncService } from '../service/AutoSyncService';

export class FileSystemStorageAdapter implements IStorageAdapter {
  private metadataManager: IMetadataManager;
  private indexManager: IndexManager;
  private fileOperationManager: FileOperationManager;
  private cacheManager: CacheManager;
  private cacheService: CacheService;
  private transactionService: TransactionService;
  private dataReader: DataReader;
  private dataWriter: DataWriter;
  private cacheMonitor: CacheMonitor;
  private autoSyncService: AutoSyncService;

  /**
   * 构造函数，接受元数据管理器实例
   * @param metadataManager 元数据管理器实例，如果未提供则创建新实例（保持向后兼容）
   * @param options 可选配置项
   */
  constructor(
    metadataManager?: IMetadataManager,
    options?: {
      cacheConfig?: Partial<CacheConfig>;
    }
  ) {
    // 使用依赖注入，如果没有提供则创建新实例（保持向后兼容）
    this.metadataManager = metadataManager || new MetadataManager();

    // 初始化核心组件
    this.indexManager = new IndexManager(this.metadataManager);
    this.fileOperationManager = new FileOperationManager(config.chunkSize, this.metadataManager);

    // 初始化服务，支持自定义缓存配置
    const defaultCacheConfig: CacheConfig = {
      strategy: CacheStrategy.LRU,
      maxSize: CACHE.DEFAULT_MAX_SIZE,
      defaultExpiry: CACHE.DEFAULT_EXPIRY, // 1小时
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
      maxMemoryUsage: 50 * 1024 * 1024, // 默认50MB内存限制
      memoryThreshold: CACHE.MEMORY_THRESHOLD, // 80%阈值触发清理
      avalancheRandomExpiry: CACHE.AVALANCHE_PROTECTION_RANGE, // 0-5分钟随机过期
    };

    this.cacheManager = new CacheManager({
      ...defaultCacheConfig,
      ...options?.cacheConfig,
    });

    this.cacheService = new CacheService(this.cacheManager);
    this.transactionService = new TransactionService();

    // 初始化性能监控（仅在非测试环境启动）
    this.cacheMonitor = new CacheMonitor(this.cacheManager);
    // 默认启动缓存监控，每分钟记录一次
    // 测试环境中不自动启动，避免影响测试性能
    if (!(typeof process !== 'undefined' && process.env.NODE_ENV === 'test')) {
      this.cacheMonitor.startMonitoring(60000); // 每分钟记录一次
    }

    // 初始化数据访问组件
    this.dataReader = new DataReader(this.metadataManager, this.indexManager, this.cacheManager);

    this.dataWriter = new DataWriter(this.metadataManager, this.indexManager, this.fileOperationManager);

    // 初始化任务队列
    this._initializeTaskQueue();

    // 初始化自动同步服务
    this.autoSyncService = new AutoSyncService(this.cacheService, this);

    // 在非测试环境中启动自动同步服务
    if (!(typeof process !== 'undefined' && process.env.NODE_ENV === 'test')) {
      this.autoSyncService.start();
    }

    // 测试环境下的特殊处理已在_initializeTaskQueue中处理
  }

  /**
   * 初始化任务队列
   */
  private _initializeTaskQueue(): void {
    const storageTaskProcessor = new StorageTaskProcessor(this);
    taskQueue.addProcessor(storageTaskProcessor);
    // 在测试环境中不自动启动任务队列，避免测试挂起
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
      taskQueue.start();
    }
  }

  /**
   * 清理资源（用于测试）
   */
  async cleanup(): Promise<void> {
    // 停止任务队列
    await taskQueue.stop({ force: true });
    await taskQueue.cleanup();
    // 清理自动同步服务
    if (this.autoSyncService) {
      this.autoSyncService.stop();
    }
    // 清理缓存监控
    if (this.cacheMonitor) {
      this.cacheMonitor.stopMonitoring();
    }
    // 清理缓存管理器
    if (this.cacheManager) {
      this.cacheManager.cleanup();
    }
  }

  // ==================== 表管理 ====================
  async createTable(
    tableName: string,
    options: CreateTableOptions & {
      columns?: Record<string, string | { type: string; isHighRisk?: boolean }>;
      initialData?: Record<string, any>[];
      mode?: 'single' | 'chunked';
      isHighRisk?: boolean;
      highRiskFields?: string[];
    } = {}
  ): Promise<void> {
    return this.dataWriter.createTable(tableName, options);
  }

  async deleteTable(tableName: string): Promise<void> {
    const result = await this.dataWriter.deleteTable(tableName);
    // 清除与该表相关的所有缓存
    this.cacheService.clearTableCache(tableName);
    return result;
  }

  async hasTable(tableName: string): Promise<boolean> {
    return this.dataWriter.hasTable(tableName);
  }

  async listTables(): Promise<string[]> {
    return this.metadataManager.allTables();
  }

  // ==================== 数据读写 ====================
  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<WriteResult> {
    const startTime = Date.now();
    const dataSize = Array.isArray(data) ? data.length : 1;

    try {
      // 事务处理逻辑
      if (this.transactionService.isInTransaction()) {
        // 保存数据快照（只在第一次操作该表时保存），用于事务回滚
        // 检查是否已经保存过该表的快照
        // 注意：这里通过检查operations中是否已有该表的操作来判断，避免直接访问事务服务的内部状态
        // 实际实现中，TransactionService.saveSnapshot方法已经确保每个表只保存一次快照
        const currentData = await this.read(tableName);
        this.transactionService.saveSnapshot(tableName, currentData);

        // 将操作添加到事务操作队列
        this.transactionService.addOperation({
          tableName,
          type: 'write',
          data,
          options,
        });

        // 事务中返回模拟结果，不实际修改数据
        const currentCount = await this.count(tableName);
        return {
          written: Array.isArray(data) ? data.length : 1,
          totalAfterWrite: currentCount + (Array.isArray(data) ? data.length : 1),
          chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
        };
      }

      // 不在事务中，直接执行写入操作
      const result = await this.dataWriter.write(tableName, data, options);

      // 测试环境中手动触发同步，确保数据写入能同步到磁盘
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        await this.autoSyncService.sync();
      }

      // 记录性能指标
      performanceMonitor.record({
        operation: 'write',
        duration: Date.now() - startTime,
        timestamp: Date.now(),
        success: true,
        dataSize,
      });

      return result;
    } catch (error) {
      // 记录失败的性能指标
      performanceMonitor.record({
        operation: 'write',
        duration: Date.now() - startTime,
        timestamp: Date.now(),
        success: false,
        dataSize,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    return this.dataReader.read(tableName, options);
  }

  async count(tableName: string): Promise<number> {
    return this.dataWriter.count(tableName);
  }

  // ==================== 查询方法 ====================
  async findOne(tableName: string, filter: Record<string, any>): Promise<Record<string, any> | null> {
    return this.dataReader.findOne(tableName, filter);
  }

  async findMany(
    tableName: string,
    filter?: Record<string, any>,
    options?: {
      skip?: number;
      limit?: number;
      sortBy?: string | string[];
      order?: 'asc' | 'desc' | ('asc' | 'desc')[];
      sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
    }
  ): Promise<Record<string, any>[]> {
    return this.dataReader.findMany(tableName, filter, options);
  }

  // ==================== 删除数据 ====================
  async delete(tableName: string, where: Record<string, any>): Promise<number> {
    // 事务处理逻辑
    if (this.transactionService.isInTransaction()) {
      // 保存数据快照（只在第一次操作该表时保存），用于事务回滚
      const currentData = await this.read(tableName);
      this.transactionService.saveSnapshot(tableName, currentData);

      // 将操作添加到事务操作队列
      this.transactionService.addOperation({
        tableName,
        type: 'delete',
        data: where,
      });

      // 事务中返回模拟结果，不实际修改数据
      return 0;
    }

    // 不在事务中，直接执行删除操作
    const result = await this.dataWriter.delete(tableName, where);

    // 测试环境中手动触发同步，确保数据删除能写入磁盘
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
      await this.autoSyncService.sync();
    }

    return result;
  }

  // ==================== 批量操作 ====================
  async bulkWrite(
    tableName: string,
    operations: Array<{
      type: 'insert' | 'update' | 'delete';
      data: Record<string, any> | Record<string, any>[];
    }>
  ): Promise<WriteResult> {
    const startTime = Date.now();
    // 如果在事务中，将操作添加到事务队列
    if (this.transactionService.isInTransaction()) {
      // 保存数据快照（只在第一次操作该表时保存）
      const currentData = await this.read(tableName);
      this.transactionService.saveSnapshot(tableName, currentData);

      // 添加到事务操作队列
      this.transactionService.addOperation({
        tableName,
        type: 'bulkWrite',
        data: operations,
      });

      // 事务中返回模拟结果
      const currentCount = await this.count(tableName);
      return {
        written: operations.length,
        totalAfterWrite: currentCount + operations.length,
        chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
      };
    }

    // 直接执行批量操作，不使用任务队列，避免无限递归
    // 优化：支持分批次处理大数据集，减少内存占用

    // 配置：每批次处理的数据量
    const BATCH_SIZE = 1000;

    // 读取当前数据
    const currentData = await this.read(tableName);
    let finalData = [...currentData];
    let writtenCount = 0;

    // 批量处理操作，按批次处理
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const batchOperations = operations.slice(i, i + BATCH_SIZE);

      // 优化：使用Map提高查找性能，减少O(n)查找操作
      const dataMap = new Map<string | number, Record<string, any>>();

      // 将现有数据转换为Map，提高查找效率
      finalData.forEach((item: Record<string, any>) => {
        if (item.id !== undefined) {
          dataMap.set(item.id, item);
        }
      });

      // 处理当前批次的操作
      for (const op of batchOperations) {
        const items = Array.isArray(op.data) ? op.data : [op.data];

        switch (op.type) {
          case 'insert':
            items.forEach((item: Record<string, any>) => {
              if (item['id'] !== undefined) {
                dataMap.set(item.id, item);
              }
              writtenCount++;
            });
            break;
          case 'update':
            items.forEach((item: Record<string, any>) => {
              if (item.id !== undefined) {
                const existing = dataMap.get(item['id']);
                if (existing) {
                  dataMap.set(item['id'], { ...existing, ...item });
                  writtenCount++;
                }
              }
            });
            break;
          case 'delete':
            items.forEach((item: Record<string, any>) => {
              if (item['id'] !== undefined && dataMap.has(item['id'])) {
                dataMap.delete(item['id']);
                writtenCount++;
              }
            });
            break;
        }
      }

      // 将Map转换回数组，合并有id和无id的数据
      const mapData = Array.from(dataMap.values());
      // 保留没有id的数据
      const itemsWithoutId = finalData.filter((item: Record<string, any>) => item['id'] === undefined);

      // 更新finalData，准备处理下一批次
      finalData = [...mapData, ...itemsWithoutId];
    }

    // 写入更新后的数据
    const result = await this.write(tableName, finalData, { mode: 'overwrite' });

    // 记录性能指标
    performanceMonitor.record({
      operation: 'bulkWrite',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: finalData.length,
    });

    // 测试环境中手动触发同步，确保批量写入能同步到磁盘
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
      await this.autoSyncService.sync();
    }

    return {
      ...result,
      written: writtenCount,
    };
  }

  // ==================== 事务管理 ====================
  /**
   * 开始事务
   */
  async beginTransaction(): Promise<void> {
    await this.transactionService.beginTransaction();
  }

  /**
   * 提交事务
   */
  async commit(): Promise<void> {
    await this.transactionService.commit(
      (tableName, data, options) => this.dataWriter.write(tableName, data, options),
      (tableName, where) => this.dataWriter.delete(tableName, where),
      (tableName, operations) => this.bulkWrite(tableName, operations)
    );
  }

  /**
   * 回滚事务
   */
  async rollback(): Promise<void> {
    await this.transactionService.rollback();
  }

  // ==================== 模式迁移 ====================
  async migrateToChunked(tableName: string): Promise<void> {
    // 直接执行迁移操作，不使用任务队列，避免无限递归
    // 读取当前表数据
    const data = await this.read(tableName);

    // 获取当前表的元数据
    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) {
      throw new StorageError(`Table ${tableName} not found`, 'TABLE_NOT_FOUND', {
        details: `Failed to migrate table ${tableName} to chunked mode: table not found`,
        suggestion: 'Check if the table name is correct',
      });
    }

    // 生成临时表名，避免与原表冲突
    const tempTableName = `${tableName}_temp_${Date.now()}`;

    try {
      // 1. 创建临时分片表
      await this.createTable(tempTableName, {
        mode: 'chunked',
        initialData: data,
        isHighRisk: tableMeta.isHighRisk,
        highRiskFields: tableMeta.highRiskFields,
      });

      // 2. 验证临时表数据完整性
      const tempTableData = await this.read(tempTableName);
      if (tempTableData.length !== data.length) {
        throw new StorageError(
          `Data integrity check failed during migration`,
          'DATA_INCOMPLETE', // 数据不完整
          {
            details: `Failed to migrate table ${tableName} to chunked mode: data count mismatch`,
            suggestion: "Try migrating again or check if there's enough storage space",
          }
        );
      }

      // 3. 删除原表
      await this.deleteTable(tableName);

      // 4. 创建新的分片表，使用原表名
      await this.createTable(tableName, {
        mode: 'chunked',
        initialData: tempTableData,
        isHighRisk: tableMeta.isHighRisk,
        highRiskFields: tableMeta.highRiskFields,
      });

      // 5. 验证新表数据完整性
      const newTableData = await this.read(tableName);
      if (newTableData.length !== data.length) {
        throw new StorageError(
          `Data integrity check failed after migration`,
          'DATA_INCOMPLETE', // 数据不完整
          {
            details: `Failed to migrate table ${tableName} to chunked mode: final data count mismatch`,
            suggestion: "Try migrating again or check if there's enough storage space",
          }
        );
      }

      // 6. 清理临时表
      await this.deleteTable(tempTableName);
    } catch (error) {
      // 如果迁移过程中发生错误，尝试恢复原表
      if (await this.hasTable(tempTableName)) {
        // 验证临时表是否存在且数据完整
        const tempTableData = await this.read(tempTableName);
        if (tempTableData.length === data.length) {
          // 如果原表已删除但新表创建失败，尝试从临时表恢复
          if (!(await this.hasTable(tableName))) {
            await this.createTable(tableName, {
              mode: tableMeta.mode || 'single',
              initialData: tempTableData,
              isHighRisk: tableMeta.isHighRisk,
              highRiskFields: tableMeta.highRiskFields,
            });
          }
        }
        // 清理临时表
        await this.deleteTable(tempTableName);
      }

      // 重新抛出错误
      throw error;
    }
  }
}

// 全局存储实例（延迟初始化，避免在测试环境中自动启动任务队列）
let storageInstance: FileSystemStorageAdapter | null = null;

function getStorageInstance(): FileSystemStorageAdapter {
  if (!storageInstance) {
    storageInstance = new FileSystemStorageAdapter();
  }
  return storageInstance;
}

// 导出默认实例（延迟创建，使用 getter 函数）
const storage = (() => {
  // 在测试环境中，返回一个可以延迟创建的代理对象
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return new Proxy({} as FileSystemStorageAdapter, {
      get(_, prop) {
        return getStorageInstance()[prop as keyof FileSystemStorageAdapter];
      },
    });
  }
  // 生产环境直接创建
  return getStorageInstance();
})();

export default storage;
