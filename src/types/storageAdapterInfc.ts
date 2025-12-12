//src/core/storageAdapter.ts
// storage adapter interface / 存储适配器接口
// storage error class / 存储错误类
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
   * delete table tableName
   * ————————
   * @param tableName table name / 表名
   * @returns Promise<void>
   */
  deleteTable(tableName: string): Promise<void>;

  /**
   * zh-CN:
   * 判断表是否存在
   * en:
   * check if table tableName exists
   * ————————
   * @param tableName table name / 表名
   * @returns Promise<boolean>
   */
  hasTable(tableName: string): Promise<boolean>;

  /**
   * zh-CN:
   * 列出所有表名
   * en:
   * list all table names
   * ————————
   * @returns Promise<string[]>
   */
  listTables(): Promise<string[]>;

  /**
   * zh-CN:
   * 写入数据
   * 表名：tableName 需判断是否时分片写入，如果是，则需要根据分片大小分片写入
   * 数据：data
   * 选项：options:[mode]
   *              mode : 写入模式（append:追加写入，overwrite:覆盖写入）
   * en:
   * write data to table tableName
   * data:data
   * options:options
   *              mode : write mode(append:append write,overwrite:overwrite write) / 写入模式（追加写入或覆盖写入）
   * ————————
   * @param tableName table name / 表名
   * @param data data to write / 要写入的数据
   * @returns Promise<{
   *         written: number; // 实际写入的条数
   *         totalAfterWrite: number; // 写入后表总条数
   *         chunked: boolean; // 是否触发了分片
   *         chunks?: number; // 如果分片了，有几个 chunk
   * }>
   **/

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
   * @returns Promise<Record<string, any> | null>
   */
  findOne(tableName: string, filter: Record<string, any>): Promise<Record<string, any> | null>;

  /**
   * zh-CN:
   * 查找多条记录
   * en:
   * find many records
   * ————————
   * @param tableName table name / 表名
   * @param filter filter condition / 过滤条件
   * @param options options including skip, limit, sortBy, order and sortAlgorithm
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
    }
  ): Promise<Record<string, any>[]>;

  /**
   * zh-CN:
   * 批量操作
   * en:
   * bulk operations
   * ————————
   * @param tableName table name / 表名
   * @param operations array of operations / 操作数组
   * @returns Promise<WriteResult>
   */
  bulkWrite(
    tableName: string,
    operations: Array<{
      type: 'insert' | 'update' | 'delete';
      data: Record<string, any> | Record<string, any>[];
    }>
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
   * @returns Promise<number> number of updated records / 更新的记录数
   */
  update(tableName: string, data: Record<string, any>, where: Record<string, any>): Promise<number>;

  /**
   * zh-CN:
   * 删除数据（与delete方法功能相同，为了API兼容性）
   * en:
   * delete data (alias for delete method, for API compatibility)
   * ————————
   * @param tableName table name / 表名
   * @param where delete condition / 删除条件
   * @returns Promise<number> number of deleted records / 删除的记录数
   */
  remove(tableName: string, where: Record<string, any>): Promise<number>;

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
}

// StorageError 存储层错误类
