// src/core/data/DataWriter.ts
import * as FileSystem from 'expo-file-system';
import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { StorageError } from '../../types/storageErrorInfc';
import type { CreateTableOptions, WriteOptions, WriteResult } from '../../types/storageTypes';
import { ErrorHandler } from '../../utils/errorHandler';
import ROOT from '../../utils/ROOTPath';
import withTimeout from '../../utils/withTimeout';
import logger from '../../utils/logger';

import { ChunkedFileHandler } from '../file/ChunkedFileHandler';
import { SingleFileHandler } from '../file/SingleFileHandler';
import { FileOperationManager } from '../FileOperationManager';
import { IndexManager } from '../index/IndexManager';
import type { ColumnSchema } from '../meta/MetadataManager';
import { QueryEngine } from '../query/QueryEngine';
export class DataWriter {
  private chunkSize: number;
  private indexManager: IndexManager;
  private metadataManager: IMetadataManager;
  private fileOperationManager: FileOperationManager;
  // 元数据校验缓存：记录上次校验的表和时间，避免频繁全表扫描
  private countValidationCache = new Map<string, { lastCheckTime: number; isAccurate: boolean }>();
  // 校验间隔：5分钟内不重复校验同一个表（可根据业务调整）
  private readonly VALIDATION_INTERVAL = 5 * 60 * 1000;
  // 并发控制：互斥锁，防止并发操作导致的数据不一致
  private operationLocks = new Map<string, Promise<void>>();
  private lockPromises = new Map<string, () => void>();

  constructor(
    metadataManager: IMetadataManager,
    indexManager: IndexManager,
    fileOperationManager: FileOperationManager
  ) {
    this.metadataManager = metadataManager;
    this.indexManager = indexManager;
    this.fileOperationManager = fileOperationManager;
    this.chunkSize = configManager.getConfig().chunkSize;
  }

  private static readonly supportedColumnTypes: ColumnSchema[string][] = [
    'string',
    'number',
    'boolean',
    'date',
    'blob',
  ];

  private normalizeColumnSchema(
    columns?: Record<string, string | { type: string; isHighRisk?: boolean }>
  ): ColumnSchema {
    const schema: ColumnSchema = {};
    if (!columns) return schema;

    for (const [column, definition] of Object.entries(columns)) {
      let type: string;
      let isHighRisk = false;

      // 处理不同类型的列定义
      if (typeof definition === 'string') {
        type = definition;
      } else {
        type = definition.type;
        isHighRisk = definition.isHighRisk || false;
      }

      if (!DataWriter.supportedColumnTypes.includes(type as any)) {
        throw ErrorHandler.createGeneralError(
          `Unsupported column type: ${column}: ${type}`,
          'TABLE_COLUMN_INVALID',
          undefined,
          `Column '${column}' has an unsupported type '${type}'`,
          'Please use one of the supported types: string, number, boolean, date, blob'
        );
      }

      // 根据是否为高危字段，使用不同的存储格式
      if (isHighRisk) {
        schema[column] = {
          type: type as 'string' | 'number' | 'boolean' | 'date' | 'blob',
          isHighRisk,
        };
      } else {
        schema[column] = type as ColumnSchema[string];
      }
    }
    return schema;
  }

  private getSingleFile(tableName: string): SingleFileHandler {
    // 在 Node / Jest 环境下，使用字符串路径即可，避免使用 Web File 构造函数导致的 ERR_INVALID_ARG_TYPE
    const filePath = `${ROOT}${tableName}.ldb`;
    return new SingleFileHandler(filePath);
  }

  private getChunkedHandler(tableName: string): ChunkedFileHandler {
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  private shouldUseChunkedMode(data: Record<string, any>[]): boolean {
    // 根据数据量决定是否使用分片模式
    const estimatedSize = data.reduce((acc, item) => acc + JSON.stringify(item).length, 0);
    return estimatedSize > (this.chunkSize || 1024 * 1024) / 2;
  }

  /**
   * 获取操作锁，确保同一表的并发操作串行执行
   */
  private async acquireLock(tableName: string): Promise<void> {
    // 如果已经有锁，等待它释放
    while (this.operationLocks.has(tableName)) {
      await this.operationLocks.get(tableName);
    }

    // 创建新的锁
    let resolveLock: () => void;
    const lockPromise = new Promise<void>(resolve => {
      resolveLock = resolve;
    });

    this.operationLocks.set(tableName, lockPromise);
    this.lockPromises.set(tableName, resolveLock!);
  }

  /**
   * 释放操作锁，允许后续操作执行
   */
  private releaseLock(tableName: string): void {
    const resolveLock = this.lockPromises.get(tableName);
    if (resolveLock) {
      resolveLock();
      this.operationLocks.delete(tableName);
      this.lockPromises.delete(tableName);
    }
  }

  // ==================== 创建表（支持单文件和分片模式） ====================
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
    return ErrorHandler.handleAsyncError(
      async () => {
        if (!tableName?.trim()) {
          throw ErrorHandler.createGeneralError(
            'Table name cannot be empty',
            'TABLE_NAME_INVALID',
            undefined,
            'Table name must be a non-empty string',
            'Please provide a valid table name'
          );
        }
        
        // 获取锁，确保同一表的并发创建操作串行执行
        await this.acquireLock(tableName);
        
        try {
          // 再次检查表是否已存在，防止获取锁期间其他操作创建了表
          if (this.metadataManager.get(tableName)) {
            return; // 幂等
          }

          // 检查文件系统访问权限
          await this.fileOperationManager.checkPermissions();

          const { columns = {}, initialData = [], mode = 'single' } = options;

          // 根据数据量或手动指定决定使用哪种模式
          const actualMode = mode === 'chunked' || this.shouldUseChunkedMode(initialData) ? 'chunked' : 'single';

          if (actualMode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            await withTimeout(handler.append(initialData), 10000, `create chunked table ${tableName}`);
          } else {
            const handler = this.getSingleFile(tableName);
            await withTimeout(handler.write(initialData), 10000, `create single file table ${tableName}`);
          }

          // 注册元数据（不覆盖 createdAt）
          this.metadataManager.update(tableName, {
            mode: actualMode,
            path: actualMode === 'chunked' ? `${tableName}/` : `${tableName}.ldb`,
            count: initialData.length,
            chunks: actualMode === 'chunked' ? 1 : 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            columns: this.normalizeColumnSchema(columns),
            isHighRisk: options.isHighRisk || false,
            highRiskFields: options.highRiskFields || [],
            encryptedFields: options.encryptedFields || [],
          });
        } finally {
          // 释放锁，允许后续操作执行
          this.releaseLock(tableName);
        }
      },
      error => {
        // 在包装成 StorageError 之前打印 DataWriter 级别的详细上下文
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
          logger.error('[DataWriter.createTable] failed:', {
            tableName,
            options,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        return ErrorHandler.createTableError('create', tableName, error);
      }
    );
  }

  // ==================== 删除表（彻底清理） ====================
  async deleteTable(tableName: string): Promise<void> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 获取锁，确保同一表的并发删除操作串行执行
        await this.acquireLock(tableName);
        
        try {
          const tableMeta = this.metadataManager.get(tableName);

          if (tableMeta?.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            await withTimeout(handler.clear(), 10000, `delete chunked table ${tableName}`);
          } else {
            await withTimeout(
              Promise.allSettled([
                this.getSingleFile(tableName).delete(),
                FileSystem.deleteAsync(FileSystem.documentDirectory + ROOT + tableName, { idempotent: true }),
              ]),
              10000,
              `delete table ${tableName}`
            );
          }

          // 清除索引
          this.indexManager.clearTableIndexes(tableName);
          
          // 删除元数据
          this.metadataManager.delete(tableName);
        } finally {
          // 释放锁，允许后续操作执行
          this.releaseLock(tableName);
        }
      },
      error => ErrorHandler.createTableError('delete', tableName, error)
    );
  }

  // ==================== 写入（自动创建 + 超时） ====================
  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<WriteResult> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 统一处理单条数据和多条数据，转换为数组格式
        const items = Array.isArray(data) ? data : [data];

        // 只有非覆盖模式下的空数据才直接返回
        if (items.length === 0 && options?.mode !== 'overwrite') {
          return await this.handleEmptyData(tableName);
        }

        // 验证写入数据的有效性，确保数据格式正确
        if (items.length > 0) {
          this.validateWriteData(items);
        }

        // 自动创建表（如果不存在）
        await this.ensureTableExists(tableName);

        // 获取锁，确保同一表的并发写入操作串行执行
        await this.acquireLock(tableName);
        
        try {
          // 检查文件系统访问权限
          await this.fileOperationManager.checkPermissions();

          // 获取表的元数据，确定存储模式
          const tableMeta = this.metadataManager.get(tableName);

          // 根据存储模式执行写入操作
          const writeResult = await this.executeWriteOperation(tableName, items, options, tableMeta);

          // 更新索引
          await this.updateIndexes(tableName, items, options?.mode === 'overwrite');

          // 更新表的元数据
          await this.updateTableMetadata(tableName, writeResult.final.length);

          // 返回写入结果
          return {
            written: items.length,
            totalAfterWrite: writeResult.final.length,
            chunked: writeResult.isChunked,
          };
        } finally {
          // 释放锁，允许后续操作执行
          this.releaseLock(tableName);
        }
      },
      error => ErrorHandler.createFileError('write', `table ${tableName}`, error)
    );
  }

  /**
   * 处理空数据写入
   */
  private async handleEmptyData(tableName: string): Promise<WriteResult> {
    return {
      written: 0,
      totalAfterWrite: await this.count(tableName),
      chunked: false,
    };
  }

  /**
   * 确保表存在，如果不存在则创建
   */
  private async ensureTableExists(tableName: string): Promise<void> {
    if (!(await this.hasTable(tableName))) {
      await this.createTable(tableName);
    }
  }

  /**
   * 根据存储模式执行写入操作
   */
  private async executeWriteOperation(
    tableName: string,
    items: Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean },
    tableMeta?: any
  ): Promise<{ final: Record<string, any>[]; isChunked: boolean }> {
    let final: Record<string, any>[];
    let isChunked = false;

    // 分片模式处理逻辑
    if (tableMeta?.mode === 'chunked') {
      final = await this.writeToChunkedTable(tableName, items, options);
      isChunked = true;
    }
    // 单文件模式处理逻辑
    else {
      final = await this.writeToSingleFileTable(tableName, items, options);
    }

    return { final, isChunked };
  }

  /**
   * 写入分片表
   */
  private async writeToChunkedTable(
    tableName: string,
    items: Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<Record<string, any>[]> {
    const handler = this.getChunkedHandler(tableName);
    let final: Record<string, any>[];

    if (options?.mode === 'overwrite') {
      // 覆盖模式：直接写入新数据，无需先读取现有数据
      await withTimeout(
        handler.write(items), // 使用更高效的write方法替代clear+append
        10000,
        `write to chunked table ${tableName}`
      );
      final = items;
    } else {
      // 追加模式：读取现有数据，追加新数据
      final = [...(await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`)), ...items];

      // 追加数据到分片文件
      await withTimeout(handler.append(items), 10000, `append to chunked table ${tableName}`);
    }

    return final;
  }

  /**
   * 写入单文件表
   */
  private async writeToSingleFileTable(
    tableName: string,
    items: Record<string, any>[],
    options?: WriteOptions & { directWrite?: boolean }
  ): Promise<Record<string, any>[]> {
    const handler = this.getSingleFile(tableName);

    // 读取现有数据（覆盖模式下为空）
    const existing =
      options?.mode === 'overwrite'
        ? []
        : await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);

    // 合并现有数据和新数据（覆盖模式下只有新数据）
    const final = options?.mode === 'overwrite' ? items : [...existing, ...items];

    // 写入数据到单文件
    await withTimeout(handler.write(final), 10000, `write to single file table ${tableName}`);

    return final;
  }

  /**
   * 更新索引
   */
  private async updateIndexes(tableName: string, items: Record<string, any>[], isOverwrite: boolean): Promise<void> {
    try {
      // 覆盖模式下，先为新数据构建完整索引，再替换现有索引，确保原子性
      if (isOverwrite) {
        // 1. 清除现有索引
        this.indexManager.clearTableIndexes(tableName);
        
        // 2. 为所有新数据添加索引
        for (const item of items) {
          // 确保数据有id字段，否则跳过索引更新
          if (item.id !== undefined) {
            this.indexManager.addToIndex(tableName, item);
          }
        }
      } else {
        // 追加模式下，逐个添加新数据的索引
        for (const item of items) {
          // 确保数据有id字段，否则跳过索引更新
          if (item.id !== undefined) {
            this.indexManager.addToIndex(tableName, item);
          }
        }
      }
    } catch (error) {
      // 索引更新失败时，记录日志但不影响主流程
      logger.error(`[DataWriter.updateIndexes] Failed to update indexes for table ${tableName}:`, error);
      // 覆盖模式下索引更新失败，可能导致索引不一致，需要重新构建索引
      if (isOverwrite) {
        logger.warn(`[DataWriter.updateIndexes] Reverting to full index rebuild for table ${tableName}`);
        // 清理损坏的索引
        this.indexManager.clearTableIndexes(tableName);
      }
    }
  }

  /**
   * 更新表的元数据
   */
  private async updateTableMetadata(tableName: string, newCount: number): Promise<void> {
    this.metadataManager.update(tableName, {
      count: newCount,
      updatedAt: Date.now(),
    });
  }

  /**
   * 验证写入数据的有效性
   */
  private validateWriteData(data: Record<string, any>[]): void {
    ErrorHandler.handleSyncError(
      () => {
        if (!Array.isArray(data)) {
          throw ErrorHandler.createGeneralError(
            'Invalid data format',
            'FILE_CONTENT_INVALID',
            undefined,
            `Expected array of records, received ${typeof data}`,
            'Please provide an array of records or a single record'
          );
        }

        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          if (typeof item !== 'object' || item === null) {
            throw ErrorHandler.createGeneralError(
              `Invalid data item at index ${i}`,
              'FILE_CONTENT_INVALID',
              undefined,
              `Expected object, received ${typeof item}`,
              'Please provide valid objects for all items'
            );
          }

          // 检查是否包含有效字段
      if (Object.keys(item).length === 0) {
        throw ErrorHandler.createGeneralError(
          `Empty object at index ${i}`,
          'FILE_CONTENT_INVALID',
          undefined,
          'Object must contain at least one field',
          'Please provide objects with valid fields'
        );
      }

      // 检查是否所有字段都是undefined（无效数据）
      const hasValidValue = Object.values(item).some(value => value !== undefined);
      if (!hasValidValue) {
        throw ErrorHandler.createGeneralError(
          `Invalid object at index ${i}`,
          'FILE_CONTENT_INVALID',
          undefined,
          'Object must contain at least one valid (non-undefined) value',
          'Please provide objects with valid values for at least one field'
        );
      }

          // 检查字段类型
          for (const [key, value] of Object.entries(item)) {
            if (value === undefined) {
              throw ErrorHandler.createGeneralError(
                `Undefined value for field '${key}' at index ${i}`,
                'FILE_CONTENT_INVALID',
                undefined,
                'Fields cannot have undefined values',
                'Please provide valid values for all fields'
              );
            }
          }
        }
      },
      error => error as StorageError
    );
  }

  async hasTable(tableName: string): Promise<boolean> {
    return this.metadataManager.get(tableName) !== undefined;
  }

  async count(tableName: string): Promise<number> {
    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) {
      // 表不存在，返回0
      return 0;
    }

    // 获取元数据中的计数（O(1)操作，高性能）
    const metadataCount = this.metadataManager.count(tableName);

    // 懒同步策略：定期验证元数据的准确性，但不每次都验证
    // 这样既能保证高性能，又能检测错误
    await this.validateCountAsync(tableName);

    return metadataCount;
  }

  /**
   * 异步校验计数的准确性（后台运行，不阻塞主流程）
   * 采用懒同步策略：
   * 1. 检查上次校验的时间，如果距离现在不足5分钟，跳过验证
   * 2. 只对最近修改过的表进行校验（通过updatedAt判断）
   * 3. 校验失败时自动修复元数据
   */
  private async validateCountAsync(tableName: string): Promise<void> {
    // 避免频繁验证：检查缓存中是否最近已验证过
    const validationInfo = this.countValidationCache.get(tableName);
    const now = Date.now();

    if (validationInfo && now - validationInfo.lastCheckTime < this.VALIDATION_INTERVAL) {
      // 最近已验证过，且间隔不足，跳过本次验证
      return;
    }

    // 执行校验（使用Try-Catch，避免校验失败影响主流程）
    try {
      const tableMeta = this.metadataManager.get(tableName);
      if (!tableMeta) return;

      // 只校验最近修改的表（最后修改时间在5分钟内）
      // 这样避免对很久没改过的表进行不必要的校验
      if (now - tableMeta.updatedAt > 24 * 60 * 60 * 1000) {
        // 24小时内没修改的表，不需要频繁校验
        this.countValidationCache.set(tableName, { lastCheckTime: now, isAccurate: true });
        return;
      }

      // 读取实际数据并计算真实计数
      const actualCount = await this.getActualCount(tableName);
      const metadataCount = this.metadataManager.count(tableName);

      // 记录本次校验
      this.countValidationCache.set(tableName, {
        lastCheckTime: now,
        isAccurate: actualCount === metadataCount,
      });

      // 如果计数不一致，自动修复元数据
      if (actualCount !== metadataCount) {
        logger.warn(
          `[DataWriter] Count mismatch detected for table '${tableName}': ` +
            `metadata=${metadataCount}, actual=${actualCount}. Auto-correcting...`
        );
        this.metadataManager.update(tableName, {
          count: actualCount,
          updatedAt: now,
        });
      }
    } catch (error) {
      // 校验失败时记录日志但不抛错（避免影响业务）
      logger.error(`[DataWriter] Failed to validate count for table '${tableName}':`, error);
    }
  }

  /**
   * 获取表的实际记录数（通过读取文件计算）
   * 性能：O(1)文件操作 + O(n)内存数据处理
   */
  private async getActualCount(tableName: string): Promise<number> {
    const tableMeta = this.metadataManager.get(tableName);
    if (!tableMeta) return 0;

    try {
      let data: Record<string, any>[];
      if (tableMeta.mode === 'chunked') {
        const handler = this.getChunkedHandler(tableName);
        data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
      } else {
        const handler = this.getSingleFile(tableName);
        data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
      }
      return data.length;
    } catch (error) {
      // 读取失败时返回元数据中的计数（保证不抛错）
      return this.metadataManager.count(tableName);
    }
  }

  /**
   * 强制校验计数准确性（用于特定场景，如故障修复）
   * 这是一个显式操作，不同于懒同步
   */
  async verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }> {
    const metadataCount = this.metadataManager.count(tableName);
    const actualCount = await this.getActualCount(tableName);
    const match = metadataCount === actualCount;

    // 如果不匹配，自动修复
    if (!match) {
      this.metadataManager.update(tableName, {
        count: actualCount,
        updatedAt: Date.now(),
      });
    }

    return { metadata: metadataCount, actual: actualCount, match };
  }

  // ==================== 删除数据 ====================
  async delete(tableName: string, where: Record<string, any>): Promise<number> {
    return ErrorHandler.handleAsyncError(
      async () => {
        // 检查文件系统访问权限
        await this.fileOperationManager.checkPermissions();

        const tableMeta = this.metadataManager.get(tableName);
        if (!tableMeta) {
          // 表不存在，返回0表示没有删除任何记录
          return 0;
        }

        // 获取锁，确保同一表的并发删除操作串行执行
        await this.acquireLock(tableName);
        
        try {
          // 读取所有数据
          let data: Record<string, any>[];
          if (tableMeta.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            data = await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
          } else {
            const handler = this.getSingleFile(tableName);
            data = await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
          }

          // 应用过滤条件，找出要保留的数据（使用QueryEngine处理复杂查询）
          // 直接找出要保留的数据，而不是先找要删除的数据再过滤，这样更高效
          const filteredData = data.filter(item => {
            // 检查item是否不匹配where条件（即要保留的数据）
            return !QueryEngine.filter([item], where).length;
          });

          // 计算删除的记录数
          const deletedCount = data.length - filteredData.length;

          // 如果没有删除任何记录，直接返回
          if (deletedCount === 0) {
            return 0;
          }

          // 写入过滤后的数据（原子操作）
          if (tableMeta.mode === 'chunked') {
            const handler = this.getChunkedHandler(tableName);
            // 使用原子写入方法，避免先clear后append的原子性问题
            await withTimeout(handler.write(filteredData), 10000, `write to chunked table ${tableName}`);
          } else {
            const handler = this.getSingleFile(tableName);
            await withTimeout(handler.write(filteredData), 10000, `write to single file table ${tableName}`);
          }

          // 更新索引 - 添加错误处理，避免索引更新失败导致整个删除操作失败
          try {
            this.indexManager.clearTableIndexes(tableName);
            for (const item of filteredData) {
              // 确保数据有id字段，否则跳过索引更新
              if (item.id !== undefined) {
                this.indexManager.addToIndex(tableName, item);
              }
            }
          } catch (error) {
            // 索引更新失败时记录日志但不影响主流程
            logger.error(`[DataWriter.delete] Failed to update indexes for table ${tableName}:`, error);
            // 清理损坏的索引
            this.indexManager.clearTableIndexes(tableName);
          }

          // 更新元数据
          this.metadataManager.update(tableName, {
            count: filteredData.length,
            updatedAt: Date.now(),
          });

          return deletedCount;
        } finally {
          // 释放锁，允许后续操作执行
          this.releaseLock(tableName);
        }
      },
      error => ErrorHandler.createFileError('delete from', `table ${tableName}`, error)
    );
  }
}
