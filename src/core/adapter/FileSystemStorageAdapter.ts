// src/core/adapter/FileSystemStorageAdapter.ts
// 文件系统存储适配器
// 实现了IStorageAdapter接口，负责处理数据库的文件系统存储操作
// 支持事务管理、缓存机制、索引管理和自动同步功能
// 创建于: 2025-11-23
// 最后修改: 2025-12-17

import { configManager } from '../config/ConfigManager';
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

import { ErrorHandler } from '../../utils/errorHandler';
import { QueryEngine } from '../query/QueryEngine';
/**
 * 文件系统存储适配器
 * 实现了IStorageAdapter接口，负责处理数据库的文件系统存储操作
   * 支持事务管理、缓存机制、索引管理
 */
export class FileSystemStorageAdapter implements IStorageAdapter {
  /** 元数据管理器 */
  private metadataManager: IMetadataManager;
  /** 索引管理器 */
  private indexManager: IndexManager;
  /** 文件操作管理器 */
  private fileOperationManager: FileOperationManager;
  /** 缓存管理器 */
  private cacheManager: CacheManager;
  /** 缓存服务 */
  private cacheService: CacheService;
  /** 事务服务 */
  private transactionService: TransactionService;
  /** 自动同步服务 */
  private autoSyncService: AutoSyncService;
  /** 数据读取器 */
  private dataReader: DataReader;
  /** 数据写入器 */
  private dataWriter: DataWriter;
  /** 缓存监控器 */
  private cacheMonitor: CacheMonitor;


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
    const currentConfig = configManager.getConfig();
    this.fileOperationManager = new FileOperationManager(currentConfig.chunkSize, this.metadataManager);

    // 初始化服务，支持自定义缓存配置
    const defaultCacheConfig: CacheConfig = {
      strategy: CacheStrategy.LRU,
      maxSize: currentConfig.cache.maxSize || CACHE.DEFAULT_MAX_SIZE,
      defaultExpiry: currentConfig.cache.defaultExpiry || CACHE.DEFAULT_EXPIRY, // 1小时
      enablePenetrationProtection: true,
      enableBreakdownProtection: true,
      enableAvalancheProtection: true,
      maxMemoryUsage: 50 * 1024 * 1024, // 默认50MB内存限制
      memoryThreshold: currentConfig.cache.memoryWarningThreshold || CACHE.MEMORY_THRESHOLD, // 80%阈值触发清理
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

    // 初始化自动同步服务（使用单例模式）
    this.autoSyncService = AutoSyncService.getInstance(this.cacheService, this);
    // 无论环境如何，都启动自动同步服务
    // 移除测试环境检测，确保自动同步服务总是被启动
    // 初始化时从全局配置获取最新配置
    this.autoSyncService.start(true);

    // 初始化任务队列
    this._initializeTaskQueue();


  }

  /**
   * 初始化任务队列
   * 注册存储任务处理器并启动任务队列（非测试环境）
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
   * 停止任务队列、自动同步服务和缓存监控
   */
  async cleanup(): Promise<void> {
    // 停止任务队列
    await taskQueue.stop({ force: true });
    await taskQueue.cleanup();

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
  /**
   * 创建表
   * @param tableName 表名
   * @param options 创建表选项
   * @throws {Error} 当表名无效时抛出
   * @returns Promise<void>
   */
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
    // 输入验证：表名不能为空且必须是字符串
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }

    return this.dataWriter.createTable(tableName, options);
  }

  /**
   * 删除表
   * @param tableName 表名
   * @throws {Error} 当表名无效时抛出
   * @returns Promise<void>
   */
  async deleteTable(tableName: string): Promise<void> {
    // 输入验证：表名不能为空且必须是字符串
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }

    const result = await this.dataWriter.deleteTable(tableName);
    // 清除与该表相关的所有缓存
    this.cacheService.clearTableCache(tableName);
    return result;
  }

  /**
   * 检查表是否存在
   * @param tableName 表名
   * @returns Promise<boolean> 表是否存在
   */
  async hasTable(tableName: string): Promise<boolean> {
    return this.dataWriter.hasTable(tableName);
  }

  /**
   * 列出所有表
   * @returns Promise<string[]> 表名数组
   */
  async listTables(): Promise<string[]> {
    return this.metadataManager.allTables();
  }

  // ==================== 数据读写 ====================
  /**
   * 写入数据
   * @param tableName 表名
   * @param data 要写入的数据
   * @param options 写入选项
   * @throws {Error} 当表名或数据无效时抛出
   * @returns Promise<WriteResult> 写入结果
   */
  /**
   * 覆盖数据（总是使用覆盖模式）
   * @param tableName 表名
   * @param data 要覆盖的数据
   * @param options 写入选项（mode将被强制设为overwrite）
   * @returns Promise<WriteResult>
   */
  async overwrite(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 输入验证：表名不能为空且必须是字符串
        if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
          throw new Error('Invalid table name: must be a non-empty string');
        }

        // 输入验证：数据不能为空且必须是对象或对象数组
        if (data === undefined || data === null) {
          throw new Error('Invalid data: must be an object or array of objects');
        }

        // 验证数组中的每个元素都是对象
        if (Array.isArray(data)) {
          for (const item of data) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
              throw new Error('Invalid data: all items in the array must be objects');
            }
          }
        }
        // 验证单个数据是对象
        else if (typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Invalid data: must be an object or array of objects');
        }

        const startTime = Date.now();
        const dataSize = Array.isArray(data) ? data.length : 1;

        // 事务处理逻辑
        if (this.transactionService.isInTransaction()) {
          // 将操作添加到事务操作队列
          this.transactionService.addOperation({
            tableName,
            type: 'overwrite',
            data,
            options,
          });

          // 事务中返回模拟结果，不实际修改数据
          return {
            written: Array.isArray(data) ? data.length : 1,
            totalAfterWrite: Array.isArray(data) ? data.length : 1,
            chunked: this.metadataManager.get(tableName)?.mode === 'chunked',
          };
        }

        // 覆盖模式：直接写入数据
        const finalData = Array.isArray(data) ? data : [data];
        const result = await this.dataWriter.write(tableName, finalData, { ...options, mode: 'overwrite' });

        // 删除与该表相关的所有缓存，确保后续读取能获取到最新数据
        this.cacheService.clearTableCache(tableName);

        // 记录性能指标
        performanceMonitor.record({
          operation: 'overwrite',
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          success: true,
          dataSize,
        });

        return result;
      },
      // 捕获并处理写入操作中的错误
      (cause: unknown) => ErrorHandler.createFileError('overwrite', `table ${tableName}`, cause)
    );
  }

  /**
   * 写入数据（支持追加或覆盖模式，用于向后兼容）
   * @deprecated 请使用 insert（追加模式）或 overwrite（覆盖模式）
   * @param tableName 表名
   * @param data 要写入的数据
   * @param options 写入选项，包括模式（'append' | 'overwrite'）
   * @returns Promise<WriteResult>
   */
  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<WriteResult> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 输入验证：表名不能为空且必须是字符串
        if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
          throw new Error('Invalid table name: must be a non-empty string');
        }

        // 输入验证：数据不能为空且必须是对象或对象数组
        if (data === undefined || data === null) {
          throw new Error('Invalid data: must be an object or array of objects');
        }

        // 验证数组中的每个元素都是对象
        if (Array.isArray(data)) {
          for (const item of data) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
              throw new Error('Invalid data: all items in the array must be objects');
            }
          }
        }
        // 验证单个数据是对象
        else if (typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Invalid data: must be an object or array of objects');
        }

        const startTime = Date.now();
        const dataSize = Array.isArray(data) ? data.length : 1;

        // 事务处理逻辑
        if (this.transactionService.isInTransaction() && !options?.directWrite) {
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

        // 不在事务中，或者directWrite为true，根据directWrite选项决定是同步还是异步写入
        let result;
        let writtenCount = Array.isArray(data) ? data.length : 1;

        // 处理不同的写入模式
        let finalData;
        let existingData;
        if (options?.mode === 'append') {
          // 追加模式：先读取现有数据，再写入合并后的数据
          existingData = await this.dataReader.read(tableName, options);
          finalData = Array.isArray(data) ? [...existingData, ...data] : [...existingData, data];
          result = await this.dataWriter.write(tableName, finalData, { ...options, mode: 'overwrite' });
          // 修正written值为本次实际写入的数据量
          result.written = writtenCount;
        } else {
          // 直接写入模式：直接写入数据
          finalData = Array.isArray(data) ? data : [data];
          result = await this.dataWriter.write(tableName, finalData, options);
        }

        // 如果在事务中且directWrite为true，更新事务数据
        if (this.transactionService.isInTransaction() && options?.directWrite) {
          // 使用刚刚写入的最终数据直接更新事务数据，避免读取缓存的旧数据
          this.transactionService.setTransactionData(tableName, finalData);
        }

        // 删除与该表相关的所有缓存，确保后续读取能获取到最新数据
        this.cacheService.clearTableCache(tableName);

        // 5. 记录性能指标
        performanceMonitor.record({
          operation: 'write',
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          success: true,
          dataSize,
        });

        return result;
      },
      // 捕获并处理写入操作中的错误
      (cause: unknown) => ErrorHandler.createFileError('write', `table ${tableName}`, cause)
    );
  }

  /**
   * 读取数据
   * @param tableName 表名
   * @param options 读取选项
   * @throws {Error} 当表名无效时抛出
   * @returns Promise<Record<string, any>[]> 读取的数据
   */
  async read(tableName: string, options?: ReadOptions & { bypassCache?: boolean }): Promise<Record<string, any>[]> {
    // 输入验证：表名不能为空且必须是字符串
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }

    // 事务中特殊处理：如果在事务中，获取包含未提交操作的最新数据
    if (this.transactionService.isInTransaction()) {
      return this.transactionService.getCurrentTransactionData(tableName, (tableName: string) => this.dataReader.read(tableName, options));
    }

    return this.dataReader.read(tableName, options);
  }

  /**
   * 统计表数据行数
   * @param tableName 表名
   * @returns Promise<number> 数据行数
   */
  async count(tableName: string): Promise<number> {
    return this.dataWriter.count(tableName);
  }

  /**
   * 验证表的计数准确性（用于诊断和修复）
   * 返回元数据计数和实际计数的比较结果
   * @param tableName 表名
   * @throws {Error} 当表名无效时抛出
   * @returns Promise<{ metadata: number; actual: number; match: boolean }> 计数比较结果
   */
  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    // 输入验证：表名不能为空且必须是字符串
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }

    return this.dataWriter.verifyCount(tableName);
  }

  /**
   * 获取表的元数据
   * @param tableName 表名
   * @returns 表的元数据，或者undefined如果表不存在
   */
  getTableMeta(tableName: string): any | undefined {
    return this.metadataManager.get(tableName);
  }

  // ==================== 查询方法 ====================
  /**
   * 查找单条记录
   * @param tableName 表名
   * @param filter 过滤条件
   * @param _options 操作选项，包括common options
   * @throws {Error} 当表名无效时抛出
   * @returns Promise<Record<string, any> | null> 找到的记录或null
   */
  async findOne(tableName: string, filter: Record<string, any>, _options?: any): Promise<Record<string, any> | null> {
    // 输入验证：表名不能为空且必须是字符串
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }
    return this.dataReader.findOne(tableName, filter);
  }

  /**
   * 查找多条记录
   * @param tableName 表名
   * @param filter 过滤条件
   * @param options 查询选项
   * @param _findOptions 操作选项，包括common options
   * @returns Promise<Record<string, any>[]> 找到的记录数组
   */
  async findMany(
    tableName: string,
    filter?: Record<string, any>,
    options?: {
      skip?: number;
      limit?: number;
      sortBy?: string | string[];
      order?: 'asc' | 'desc' | ('asc' | 'desc')[];
      sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
    },
    _findOptions?: any
  ): Promise<Record<string, any>[]> {
    return this.dataReader.findMany(tableName, filter, options);
  }

  // ==================== 删除数据 ====================
  /**
   * 删除数据
   * @param tableName 表名
   * @param where 删除条件
   * @param options 删除选项
   * @throws {Error} 当表名无效时抛出
   * @returns Promise<number> 删除的记录数
   */
  async delete(tableName: string, where: Record<string, any>, options?: { directWrite?: boolean }): Promise<number> {
    // 输入验证：表名不能为空且必须是字符串
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }

    // 事务处理逻辑
    if (this.transactionService.isInTransaction() && !options?.directWrite) {
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

    // 不在事务中，或者directWrite为true，直接执行删除操作，然后清理缓存

    // 1. 执行磁盘删除操作
    const result = await this.dataWriter.delete(tableName, where);



    // 3. 删除与该表相关的所有缓存，确保后续读取能获取到最新数据
    this.cacheService.clearTableCache(tableName);

    return result;
  }

  /**
   * 删除数据（与delete方法功能相同，为了API兼容性）
   * @param tableName 表名
   * @param where 删除条件
   * @throws {Error} 当表名无效时抛出
   * @returns Promise<number> 删除的记录数
   */
  async remove(tableName: string, where: Record<string, any>): Promise<number> {
    return this.delete(tableName, where);
  }

  /**
   * 插入数据（总是追加模式，与write方法的append模式功能相同）
   * @param tableName 表名
   * @param data 要插入的数据
   * @param options 插入选项（mode将被强制设为append）
   * @throws {Error} 当表名或数据无效时抛出
   * @returns Promise<WriteResult> 插入结果
   */
  async insert(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    // 插入操作总是使用append模式，忽略传入的mode选项
    return this.write(tableName, data, { ...options, mode: 'append' });
  }

  /**
   * 更新匹配的数据
   */
  async update(tableName: string, data: Record<string, any>, where: Record<string, any>, options?: { directWrite?: boolean }): Promise<number> {
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }

    // 获取当前表数据
    let allData;
    
    // 事务中特殊处理：如果在事务中，使用getCurrentTransactionData获取包含未提交操作的数据
    if (this.transactionService.isInTransaction()) {
      allData = await this.transactionService.getCurrentTransactionData(tableName, (tableName: string) => this.dataReader.read(tableName));
    } else {
      allData = await this.dataReader.read(tableName);
    }
    
    // 优化：使用QueryEngine.filter一次过滤所有数据，而不是逐行过滤
    const matchedItems = QueryEngine.filter(allData, where);
    const updatedCount = matchedItems.length;
    
    if (updatedCount === 0) {
      return 0;
    }
    
    // 创建匹配项的ID映射，用于快速查找
    const matchedIds = new Set(matchedItems.map(item => item.id || item._id));
    
    // 更新数据
    const finalData = allData.map((item: Record<string, any>) => {
      const itemId = item.id || item._id;
      if (matchedIds.has(itemId)) {
        return QueryEngine.update(item, data);
      }
      return item;
    });

    if (this.transactionService.isInTransaction() && !options?.directWrite) {
      // 将操作添加到事务操作队列
      this.transactionService.addOperation({
        tableName,
        type: 'update',
        data: data,
        where: where,
        options: { mode: 'overwrite' },
      });

      return updatedCount;
    }

    if (updatedCount > 0) {
      // 执行写入操作
      await this.write(tableName, finalData, { mode: 'overwrite', directWrite: options?.directWrite });
      
      // 注意：write方法在directWrite为true时会自动更新事务数据，所以这里不需要再次更新
      // 避免重复更新导致$inc等操作符被执行多次
    }

    return updatedCount;
  }

  /**
   * 清空表数据
   * @param tableName 表名
   * @returns Promise<void>
   */
  async clearTable(tableName: string): Promise<void> {
    // 输入验证：表名不能为空且必须是字符串
    if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
      throw new Error('Invalid table name: must be a non-empty string');
    }

    // 直接写入空数组来清空表，覆盖模式
    await this.write(tableName, [], { mode: 'overwrite' });
  }

  // ==================== 批量操作 ====================
  /**
   * 批量操作
   * @param tableName 表名
   * @param operations 操作数组，使用联合类型确保类型安全
   * @param options 操作选项
   * @returns Promise<WriteResult> 操作结果
   */
  async bulkWrite(
    tableName: string,
    operations: Array<
      | {
          type: 'insert';
          data: Record<string, any> | Record<string, any>[];
        }
      | {
          type: 'update';
          data: Record<string, any>;
          where: Record<string, any>;
        }
      | {
          type: 'delete';
          where: Record<string, any>;
        }
    >,
    options?: { directWrite?: boolean }
  ): Promise<WriteResult> {
    const startTime = Date.now();
    // 如果在事务中且directWrite为false，将操作添加到事务队列
    if (this.transactionService.isInTransaction() && !options?.directWrite) {
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
    const BATCH_SIZE = 1000; // 每批次处理的数据量

    // 读取当前数据
    const currentData = await this.read(tableName);
    let finalData = [...currentData];
    let writtenCount = 0;

    // 批量处理操作，按批次处理
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const batchOperations = operations.slice(i, i + BATCH_SIZE);

      // 优化：使用Map提高查找性能，减少O(n)查找操作
      const dataMap = new Map<string | number, Record<string, any>>();

      // 保存没有id的数据（包括原有数据和新插入的数据）
      let itemsWithoutId = finalData.filter((item: Record<string, any>) => item['id'] === undefined);

      // 将现有数据转换为Map，提高查找效率
      finalData.forEach((item: Record<string, any>) => {
        if (item.id !== undefined) {
          dataMap.set(item.id, item);
        }
      });

      // 处理当前批次的操作
      for (const op of batchOperations) {
        switch (op.type) {
          case 'insert':
            const insertItems = Array.isArray(op.data) ? op.data : [op.data];
            insertItems.forEach((item: Record<string, any>) => {
              if (item['id'] !== undefined) {
                dataMap.set(item.id, item);
              } else {
                // 处理没有id的插入项
                itemsWithoutId.push(item);
              }
              writtenCount++;
            });
            break;
          case 'update':
            if (op.where) {
              // 使用QueryEngine进行复杂条件过滤，确保与findOne/findMany一致
              // 将Map转换为数组进行过滤
              const allData = Array.from(dataMap.values());
              const matchedItems = QueryEngine.filter(allData, op.where);
              
              // 更新所有匹配的记录
              for (const matchedItem of matchedItems) {
                if (matchedItem.id !== undefined) {
                  const updatedItem = QueryEngine.update(matchedItem, op.data);
                  
                  dataMap.set(matchedItem.id, updatedItem);
                  writtenCount++;
                }
              }
            } else {
              // 原逻辑：通过id更新记录
              const updateItems = Array.isArray(op.data) ? op.data : [op.data];
              updateItems.forEach((item: Record<string, any>) => {
                if (item.id !== undefined) {
                  const existing = dataMap.get(item['id']);
                  if (existing) {
                    dataMap.set(item['id'], { ...existing, ...item });
                    writtenCount++;
                  }
                }
              });
            }
            break;
          case 'delete':
            if (op.where) {
              // 使用QueryEngine进行复杂条件过滤，确保与findOne/findMany一致
              // 将Map转换为数组进行过滤
              const allData = Array.from(dataMap.values());
              const matchedItems = QueryEngine.filter(allData, op.where);
              
              // 删除所有匹配的记录
              for (const matchedItem of matchedItems) {
                if (matchedItem.id !== undefined) {
                  dataMap.delete(matchedItem.id);
                  writtenCount++;
                }
              }
            } else {
              // 原逻辑：通过id删除记录（不再使用op.data，因为delete操作只需要where条件）
              const allData = Array.from(dataMap.values());
              for (const item of allData) {
                if (item.id !== undefined) {
                  dataMap.delete(item.id);
                  writtenCount++;
                }
              }
            }
            break;
        }
      }

      // 将Map转换回数组，合并有id和无id的数据
      const mapData = Array.from(dataMap.values());

      // 更新finalData，准备处理下一批次
      finalData = [...mapData, ...itemsWithoutId];
    }

    // 写入更新后的数据
    const result = await this.dataWriter.write(tableName, finalData, { mode: 'overwrite' });

    // 清除该表的缓存
    this.cacheService.clearTableCache(tableName);

    // 记录性能指标
    performanceMonitor.record({
      operation: 'bulkWrite',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
      dataSize: finalData.length,
    });



    return {
      ...result,
      written: writtenCount,
    };
  }

  // ==================== 事务管理 ====================
  /**
   * 开始事务
   * @returns Promise<void>
   * @throws {Error} 当事务已存在时抛出
   */
  async beginTransaction(_options?: any): Promise<void> {
    await this.transactionService.beginTransaction();
  }

  /**
   * 提交事务
   * @param options 事务选项
   * @returns Promise<void>
   * @throws {Error} 当事务不存在时抛出
   */
  async commit(options?: any): Promise<void> {
    await this.transactionService.commit(
      // writeFn - 写入处理函数
      (tableName: string, data: any, opOptions?: any) => this.write(tableName, data, { ...options, ...opOptions, directWrite: true }),
      // deleteFn - 删除处理函数
      (tableName: string, where: any, deleteOptions?: any) => this.delete(tableName, where, { ...options, ...deleteOptions, directWrite: true }),
      // bulkWriteFn - 批量写入处理函数
      (tableName: string, operations: any[], bulkOptions?: any) => this.bulkWrite(tableName, operations, { ...options, ...bulkOptions, directWrite: true }),
      // updateFn - 更新处理函数
      async (tableName: string, data: any, where: any, _updateOptions?: any) => {
        // 事务提交时直接执行更新逻辑，不经过事务检查
        // 注意：这里需要一个直接的更新实现，不经过事务中的数据处理
        // 直接读取原始数据，应用更新，然后写入
        const allData = await this.dataReader.read(tableName);
        const matchedItems = QueryEngine.filter(allData, where);
        const updatedCount = matchedItems.length;
        
        if (updatedCount === 0) {
          return 0;
        }
        
        const matchedIds = new Set(matchedItems.map(item => item.id || item._id));
        const finalData = allData.map((item: Record<string, any>) => {
          const itemId = item.id || item._id;
          if (matchedIds.has(itemId)) {
            return QueryEngine.update(item, data);
          }
          return item;
        });
        
        // 直接写入更新后的数据
        await this.write(tableName, finalData, { mode: 'overwrite', directWrite: true });
        
        return updatedCount;
      }
    );
  }

  /**
   * 回滚事务
   * @param options 事务选项
   * @returns Promise<void>
   * @throws {Error} 当事务不存在时抛出
   */
  async rollback(_options?: any): Promise<void> {
    // 调用事务服务的rollback方法，传入writeFn用于恢复数据
    await this.transactionService.rollback(
      (tableName: string, data: Record<string, any>[], options?: any) => 
        this.dataWriter.write(tableName, data, { ...options, directWrite: true })
    );
  }

  // ==================== 模式迁移 ====================
  /**
   * 将表迁移到分片模式
   * @param tableName 表名
   * @returns Promise<void>
   * @throws {StorageError} 当迁移失败时抛出
   */
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

/**
 * 获取存储实例
 * @returns FileSystemStorageAdapter 存储实例
 */
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
