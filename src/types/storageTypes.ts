// src/types/storage.ts
//storage types

export type FilterCondition =
  | ((item: Record<string, any>) => boolean)
  | Partial<Record<string, any>>
  | { $or?: FilterCondition[]; $and?: FilterCondition[] };

export type StorageErrorCode =
  | "TABLE_NOT_FOUND"
  | "TABLE_ALREADY_EXISTS"
  | "WRITE_FAILED"
  | "READ_FAILED"
  | "DISK_FULL"
  | "CORRUPTED_DATA"
  | "CHUNK_INTEGRITY_FAILED"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "UNKNOWN"
  | "META_FILE_READ_ERROR"
  | "META_FILE_WRITE_ERROR";

export type WriteResult = {
    /**
     * 写入的字节数/write bytes
     * @param written written bytes
     * @returns written bytes
     */
  /**
   * 写入后的总字节数 / total bytes after write
   * @param totalAfterWrite total bytes after write
   * @returns total bytes after write
   * @param chunked whether chunked write
   * @returns total bytes after write
   * @param chunks number of chunks (if chunked write)
   * @returns total bytes after write
   */
  written: number; // 写入的字节数/write bytes
  totalAfterWrite: number; // 写入后的总字节数 / total bytes after write
  chunked: boolean; // 是否分片写入 / whether chunked write
  chunks?: number; // 分片数（如果分片写入，则为分片数）/ number of chunks (if chunked write)
};

export type ReadOptions = {
    /**
     * 跳过的记录数 / number of records to skip
     * @param skip number of records to skip
     * @param limit number of records to read
     * @param filter filter condition
     */
  skip?: number; // 跳过的记录数 / number of records to skip
  limit?: number; // 读取的记录数 / number of records to read
  filter?: FilterCondition; // 过滤条件 / filter condition
};

export type CreateTableOptions = {
    /**
     * 表名 / table name
     * @param tableName table name
     * @returns table name
     */
  tableName: string; // 表名 / table name
  intermediates?: boolean; // 是否创建中间目录（没有则创建）建议开启 / whether create intermediates directories (if not exist)
  chunkSize?: number; // 分片大小（如果文件大小超过此值，则采取分片写入）/ chunk size (if file size exceeds this value, chunked write will be used)
};

export type WriteOptions = {
  mode?: "append" | "overwrite"; // 写入模式 / write mode
  forceChunked?: boolean; // 是否强制分片写入（如果文件大小超过分片大小）/ whether force chunked write (if file size exceeds chunk size)
};

// 表元数据选项定义 / table metadata options
export interface TableMeta {
  mode:"single"|"chunked";
  count:number; // 记录数 / number of records
  size?:number; // 总字节数 / total bytes
  chunk?:number; // 分片模式下的分片大小（如果是分片表）/ chunk size (if chunked table)
  updateAt:number; // 最后更新时间 / last update time

}
// 目录元数据选项定义 / catalog metadata options
export type Catalog = {
  tables:Record<string,TableMeta>;
  version:number; // 目录版本号 / catalog version 1.0.0
}
