//src/core/storageAdapter.ts
import { Directory } from "expo-file-system";
import type {
    FilterCondition,
    StorageErrorCode,
    WriteResult,
    ReadOptions,
    CreateTableOptions,
    WriteOptions,
} from "../types/storage";


//———————————— Storage Adapter Interface / 存储适配器接口 ————————————
export interface StorageAdapter {
    /**
     * zh-CN:
     * 创建表
     * 目录：dir
     * 选项：options:[intermediates,chunkSize]
     *              intermediates : 是否创建中间目录（没有则创建）
     *              chunkSize : 分片大小（如果文件大小超过此值，则采取分片写入）
     * en:
     * create a table with name tableName
     * dir:dir
     * options:[intermediates,chunkSize]
     *              intermediates : whether to create intermediate directories(if not exist)
     *              chunkSize : chunk size(if file size exceeds this value)
     * ————————
     * @param dir table directory / 表目录 包含 tablename
 
     * @returns Promise<void>
     */
    createTable(dir: Directory,options?: CreateTableOptions): Promise<void>;

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
    read(
        tableName: string,
        options?: ReadOptions
    ): Promise<Record<string, any>[]>;
}

// StorageError 存储层错误
export class StorageError extends Error {
    constructor(
        message: string,
        public readonly code: StorageErrorCode,
        public readonly cause?: unknown
    ) {
        super(message);
        this.name = "StorageError";
    }
}



