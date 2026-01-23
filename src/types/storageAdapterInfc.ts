/**
 * Storage Adapter Interface Definition
 * Defines the contract for storage operations in the data store.
 * 
 * @module storageAdapterInfc
 * @since 2025-11-19
 * @version 1.0.0
 */
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from './storageTypes';

//———————————— Storage Adapter Interface / 存储适配器接口 ————————————
export interface IStorageAdapter {
  /**
   * zh-CN:
   * 创建表
   * 目录：dir
   * 选项：options:[intermediates,chunkSize]
   *              intermediates : 是否创建中间目录（没有则创建）
   *              chunkSize : 分片大小（如果文件大小超过此值，则采取分片写入）
   *              columns : 列定义
   *              initialData : 初始数据
   *              mode : 存储模式（single或chunked）
   * en:
   * create a table with name tableName
   * dir:dir
   * options:[intermediates,chunkSize]
   *              intermediates : whether to create intermediate directories(if not exist)
   *              chunkSize : chunk size(if file size exceeds this value)
   *              columns : column definitions
   *              initialData : initial data
   *              mode : storage mode (single or chunked)
   * ————————
   * @param tableName table name / 表名
   * @param options create table options / 创建表选项
   * @returns Promise<void>
   */
  createTable(
    tableName: string,
    options?: CreateTableOptions & {
      columns?: Record<string, string>;
      initialData?: Record<string, any>[];
      mode?: 'single' | 'chunked';
    }
  ): Promise<void>;

  /**
   * zh-CN:
   * 删除表
   * en:
   * delete table
   * ————————
   * @param tableName table name / 表名
   * @param options Operation options, including common options
   * @returns Promise<void>
   */
  deleteTable(tableName: string, options?: any): Promise<void>;

  /**
   * zh-CN:
   * 检查表是否存在
   * en:
   * check if table exists
   * ————————
   * @param tableName table name / 表名
   * @param options Operation options, including common options
   * @returns Promise<boolean>
   */
  hasTable(tableName: string, options?: any): Promise<boolean>;

  /**
   * zh-CN:
   * 获取表列表
   * en:
   * get table list
   * ————————
   * @param options Operation options, including common options
   * @returns Promise<string[]>
   */
  listTables(options?: any): Promise<string[]>;

  /**
   * zh-CN:
   * 覆盖数据（总是使用覆盖模式）
   * en:
   * overwrite data (always uses overwrite mode)
   * ————————
   * @param tableName table name / 表名
   * @param data data to overwrite / 要覆盖的数据
   * @returns Promise<{
   *         written: number; // 实际写入的条数
   *         totalAfterWrite: number; // 写入后表总条数
   *         chunked: boolean; // 是否触发了分片
   *         chunks?: number; // 如果分片了，有几个 chunk
   * }>
   **/

  overwrite(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: Omit<WriteOptions, 'mode'>
  ): Promise<WriteResult>;

  /**
   * zh-CN:
   * 插入数据（总是使用追加模式）
   * en:
   * insert data (always uses append mode)
   * ————————
   * @param tableName table name / 表名
   * @param data data to insert / 要插入的数据
   * @param options insert options / 插入选项（mode将被强制设为append）
   * @returns Promise<WriteResult>
   */
  insert(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult>;

  /**
   * zh-CN:
   * 写入数据（支持追加或覆盖模式，用于向后兼容）
   * en:
   * write data (supports append or overwrite mode, for backward compatibility)
   * ————————
   * @param tableName table name / 表名
   * @param data data to write / 要写入的数据
   * @param options write options / 写入选项，包括模式（'append' | 'overwrite'）
   * @returns Promise<WriteResult>
   * @deprecated 请使用 insert（追加模式）或 overwrite（覆盖模式）
   */
  write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult>;

  /**
     * zh-CN:
     * 读取数据
     * 表名：tableName
     * 选项：options:[skip,limit,filter]
     *              skip : 跳过前N项
     *              limit : 读取上限
     *              filter : 客户端过滤函数
     * en:
     * read data from table tableName
     * options:options
     *              skip : skip first N items / 跳过前N项
     *              limit : read limit / 读取上限
     *              filter : client-side filter function / 客户端过滤函数
     * ————————
     * @param tableName table name / 表名

     * @returns Promise<Record<string, any>[]>
     */
  read(tableName: string, options?: ReadOptions): Promise<Record<string, any>[]>;

  /**
   * zh-CN:
   * 获取表记录数
   * en:
   * get table record count
   * ————————
   * @param tableName table name / 表名
   * @returns Promise<number>
   */
  count(tableName: string): Promise<number>;

  /**
   * zh-CN:
   * 验证表的计数准确性（诊断和修复用）
   * 返回元数据中的计数和实际计数的比较结果
   * 如果不匹配会自动修复元数据
   * en:
   * verify table count accuracy (for diagnosis and repair)
   * returns comparison result of metadata count and actual count
   * auto-fixes metadata if mismatch detected
   * ————————
   * @param tableName table name / 表名
   * @returns Promise<{metadata: number; actual: number; match: boolean}>
   */
  verifyCount(tableName: string): Promise<{ metadata: number; actual: number; match: boolean }>;

  /**
   * zh-CN:
   * 查找单条记录
   * en:
   * find one record
   * ————————
   * @param tableName table name / 表名
   * @param filter filter condition / 过滤条件
   * @param options Operation options, including common options
   * @returns Promise<Record<string, any> | null>
   */
  findOne(tableName: string, filter: Record<string, any>, options?: any): Promise<Record<string, any> | null>;

  /**
   * zh-CN:
   * 查找多条记录
   * en:
   * find many records
   * ————————
   * @param tableName table name / 表名
   * @param filter filter condition / 过滤条件
   * @param options options including skip, limit, sortBy, order, sortAlgorithm, and common options
   * @param findOptions Additional operation options, including common options
   * @returns Promise<Record<string, any>[]>
   */
  findMany(
    tableName: string,
    filter?: Record<string, any>,
    options?: {
      skip?: number;
      limit?: number;
      sortBy?: string | string[];
      order?: 'asc' | 'desc' | ('asc' | 'desc')[];
      sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow';
      encrypted?: boolean;
      requireAuthOnAccess?: boolean;
    },
    findOptions?: any
  ): Promise<Record<string, any>[]>;

  /**
   * zh-CN:
   * 批量操作
   * en:
   * bulk operations
   * ————————
   * @param tableName table name / 表名
   * @param operations array of operations / 操作数组，使用联合类型确保类型安全
   * @param options Operation options, including common options
   * @returns Promise<WriteResult>
   */
  bulkWrite(
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
    options?: any
  ): Promise<WriteResult>;

  /**
   * zh-CN:
   * 迁移到分片模式
   * en:
   * migrate to chunked mode
   * ————————
   * @param tableName table name / 表名
   * @returns Promise<void>
   */
  migrateToChunked(tableName: string): Promise<void>;

  /**
   * zh-CN:
   * 更新匹配的数据
   * en:
   * update matched records
   * ————————
   * @param tableName table name / 表名
   * @param data data to update / 要更新的数据
   * @param where update condition / 更新条件
   * @param options Operation options, including common options
   * @returns Promise<number> number of updated records / 更新的记录数
   */
  update(tableName: string, data: Record<string, any>, where: Record<string, any>, options?: any): Promise<number>;

  /**
   * zh-CN:
   * 删除数据（与delete方法功能相同，为了API兼容性）
   * en:
   * delete data (alias for delete method, for API compatibility)
   * ————————
   * @param tableName table name / 表名
   * @param where delete condition / 删除条件
   * @param options Operation options, including common options
   * @returns Promise<number> number of deleted records / 删除的记录数
   */
  remove(tableName: string, where: Record<string, any>, options?: any): Promise<number>;

  /**
   * zh-CN:
   * 清空表数据
   * en:
   * clear table data
   * ————————
   * @param tableName table name / 表名
   * @returns Promise<void>
   */
  clearTable(tableName: string): Promise<void>;

  /**
   * zh-CN:
   * 删除数据
   * en:
   * delete data
   * ————————
   * @param tableName table name / 表名
   * @param where delete condition / 删除条件
   * @param options Operation options, including common options
   * @returns Promise<number> number of deleted records / 删除的记录数
   */
  delete(tableName: string, where: Record<string, any>, options?: any): Promise<number>;

  /**
   * zh-CN:
   * 开始事务
   * en:
   * begin transaction
   * ————————
   * @param options Transaction options
   * @returns Promise<void>
   */
  beginTransaction(options?: any): Promise<void>;

  /**
   * zh-CN:
   * 提交事务
   * en:
   * commit transaction
   * ————————
   * @param options Transaction options
   * @returns Promise<void>
   */
  commit(options?: any): Promise<void>;

  /**
   * zh-CN:
   * 回滚事务
   * en:
   * rollback transaction
   * ————————
   * @param options Transaction options
   * @returns Promise<void>
   */
  rollback(options?: any): Promise<void>;
}

// StorageError 存储层错误类
