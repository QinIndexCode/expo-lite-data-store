//src/core/storageAdapter.ts
import { Directory, Paths, File } from "expo-file-system";
// 存储适配器
const RootDir = new Directory(Paths.document, "expo-litedatastore");
const DefaultChunkSize = 10 * 1024 * 1024; //后续可配置
//———————————— types /类型 ————————————
// 过滤条件类型 / Filter Condition Type

export type FilterCondition =
    | ((item: Record<string, any>) => boolean) // custom filter function/自定义过滤函数
    | Partial<Record<string, any>> // 简单字段匹配，如 { age: 18, status: 'active' }
    | { $or?: FilterCondition[]; $and?: FilterCondition[] }; // 逻辑组合，如 { $or: [{ age: 18 }, { status: 'active' }] }
// 存储错误码类型 / Storage Error Code Type
export type StorageErrorCode =
    | "TABLE_NOT_FOUND" // 表不存在
    | "TABLE_ALREADY_EXISTS" // 表已存在
    | "WRITE_FAILED" // 写入失败（含分片写入异常）
    | "READ_FAILED" // 读取失败（含分片读取异常）
    | "DISK_FULL" // 磁盘空间不足
    | "CORRUPTED_DATA" // 数据损坏（JSON 解析失败、校验和不匹配等）
    | "CHUNK_INTEGRITY_FAILED" // 分片完整性校验失败
    | "PERMISSION_DENIED" // 无文件系统权限
    | "TIMEOUT" // 操作超时
    | "UNKNOWN"; // 未分类的未知错误




    
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
     * @param options options Options for creation / 创建选项
     * @param options.intermediates create intermediates directories(if not exist) / 是否创建中间目录（没有则创建）
     * @param options.chunkSize chunk size(if file size exceeds this value) / 分片大小（如果文件大小超过此值，则采取分片写入）
     * @returns Promise<void>
     */
    createTable(
        dir: Directory,
        options?: {
            intermediates?: boolean; //default:true
            chunkSize?: number; //default:10MB
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
     * @param options options Options for writing / 写入选项
     * @param options.mode write mode(append:append write,overwrite:overwrite write) / 写入模式（追加写入或覆盖写入）
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
        options?: { mode?: "append" | "overwrite" }
    ): Promise<{
        written: number; // 实际写入的条数
        totalAfterWrite: number; // 写入后表总条数
        chunked: boolean; // 是否触发了分片
        chunks?: number; // 如果分片了，有几个 chunk
    }>;

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
     * @param options options Options for reading / 读取选项
     * @param options.skip skip first N items / 跳过前N项
     * @param options.limit read limit / 读取上限
     * @param options.filter client-side filter function / 客户端过滤函数
     * @returns Promise<Record<string, any>[]>
     */
    read(
        tableName: string,
        options?: {
            skip?: number; // skip first N items / 跳过前N项
            limit?: number; // read limit / 读取上限
            filter?:
                | ((item: Record<string, any>) => boolean) // 老方式，保留兼容
                | Partial<Record<string, any>> // { age: 18, status: 'active' }
                | { $or?: FilterCondition[]; $and?: FilterCondition[] } // 支持逻辑组合
                | { [key: string]: any }; // 任意字段匹配
        }
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

//———————————— StorageAdapterImplment / 存储适配器实现 ————————————
// export class StorageAdapterImplment implements StorageAdapter {
//     constructor(
//         private readonly dir: Directory,
//         private readonly chunkSize: number = 10 * 1024 * 1024 // 10MB
//     ) {}
// }


