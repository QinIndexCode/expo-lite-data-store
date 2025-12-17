// src/types/storageTypes.ts
// 存储类型定义，包含过滤条件、读写选项和元数据结构
// 创建于: 2025-11-19
// 最后修改: 2025-12-11

/**
 * 过滤条件类型
 * 支持函数过滤、部分对象匹配和复合条件（AND/OR）
 */
export type FilterCondition =
  | ((item: Record<string, any>) => boolean) // 函数过滤条件
  | Partial<Record<string, any>> // 部分对象匹配
  | { $or?: FilterCondition[]; $and?: FilterCondition[] }; // 复合条件

/**
 * 写入结果类型
 * 包含写入操作的详细信息
 */
export type WriteResult = {
  written: number; // 本次写入的字节数
  totalAfterWrite: number; // 写入后的总字节数
  chunked: boolean; // 是否采用分片写入
  chunks?: number; // 分片数（仅在分片写入时存在）
};

/**
 * 读取选项类型
 * 用于配置数据读取的各种参数
 */
export type ReadOptions = {
  skip?: number; // 跳过的记录数
  limit?: number; // 读取的记录数限制
  filter?: FilterCondition; // 过滤条件
  sortBy?: string | string[]; // 排序字段，支持单字段或多字段
  order?: 'asc' | 'desc' | ('asc' | 'desc')[]; // 排序方向，与sortBy对应
  sortAlgorithm?: 'default' | 'fast' | 'counting' | 'merge' | 'slow'; // 排序算法
  bypassCache?: boolean; // 是否绕过缓存，直接从磁盘读取
};

/**
 * 创建表选项类型
 * 用于配置表的创建参数
 */
export type CreateTableOptions = {
  columns?: Record<string, string>; // 列定义，键为列名，值为数据类型
  intermediates?: boolean; // 是否自动创建中间目录
  chunkSize?: number; // 分片大小阈值，超过此值将使用分片写入
  encrypted?: boolean; // 是否启用加密存储，默认为 false
  requireAuthOnAccess?: boolean; // 是否需要生物识别验证，默认为 false
};

/**
 * 写入选项类型
 * 用于配置数据写入的各种参数
 */
export type WriteOptions = {
  mode?: 'append' | 'overwrite'; // 写入模式：追加或覆盖
  forceChunked?: boolean; // 是否强制使用分片写入
  encrypted?: boolean; // 是否启用加密存储，默认为 false
  requireAuthOnAccess?: boolean; // 是否需要生物识别验证，默认为 false
};

/**
 * 表元数据接口
 * 存储表的基本信息和统计数据
 */
export interface TableMeta {
  mode: 'single' | 'chunked'; // 存储模式：单文件或分片
  count: number; // 表中的记录数
  size?: number; // 表的总字节数
  chunk?: number; // 分片大小（仅在分片模式下存在）
  updateAt: number; // 最后更新时间戳（毫秒）
  encrypted?: boolean; // 是否启用加密存储
  requireAuthOnAccess?: boolean; // 是否需要生物识别验证
}

/**
 * 目录元数据类型
 * 存储整个数据库的表信息和版本
 */
export type Catalog = {
  tables: Record<string, TableMeta>; // 所有表的元数据，键为表名
  version: number; // 目录版本号
};
