import storage from "./adapter/FileSystemStorageAdapter";
import { EncryptedStorageAdapter } from "./EncryptedStorageAdapter";

/**
 * 是否启用加密存储
 * 生产环境建议设置为 true，开发环境可设置为 false 以便调试
 */
const USE_ENCRYPTION = false; // 上线改 true，调试改 false

/**
 * 默认数据库实例
 * 根据 USE_ENCRYPTION 配置决定使用加密存储还是普通存储
 */
export const db = USE_ENCRYPTION
  ? new EncryptedStorageAdapter()
  : storage;

/**
 * 明文存储实例（用于调试）
 * 开发时可以直接查看明文数据，便于调试
 */
export const plainStorage = storage;