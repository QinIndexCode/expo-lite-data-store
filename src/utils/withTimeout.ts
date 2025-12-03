/**
 * 超时处理工具
 * 为Promise添加超时机制，防止操作无限期等待
 */
import { StorageError } from "../types/storageErrorInfc";
import config from "../liteStore.config";

/**
 * 为Promise添加超时机制
 * @template T Promise的返回类型
 * @param promise 要添加超时的Promise
 * @param ms 超时时间（毫秒），默认使用配置文件中的timeout值
 * @param operation 操作描述，用于生成超时错误信息
 * @returns Promise<T> 带有超时机制的Promise
 * @throws StorageError 当操作超时时抛出超时错误
 * @example
 * // 为文件读取操作添加超时
 * const result = await withTimeout(
 *   fileHandler.read(),
 *   5000, // 5秒超时
 *   "file read operation"
 * );
 */
export default function withTimeout<T>(
    promise: Promise<T>,
    ms = config.timeout,
    operation = "chunked file operation"
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
                () =>
                    reject(new StorageError(`${operation} timeout`, "TIMEOUT")),
                ms
            );
        }),
    ]).then(result => {
        // 清理定时器
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        return result;
    }).catch(error => {
        // 清理定时器
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        throw error;
    });
}