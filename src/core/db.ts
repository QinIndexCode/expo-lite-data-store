// src/core/db.ts
// 数据库实例初始化文件，负责创建和导出数据库实例
// 根据环境配置决定是否使用加密存储
// 创建于: 2025-11-23
// 最后修改: 2025-12-11

import storage from './adapter/FileSystemStorageAdapter';
import { EncryptedStorageAdapter } from './EncryptedStorageAdapter';

/**
 * 是否启用加密存储
 * 生产环境建议设置为 true，开发环境可设置为 false 以便调试
 * 测试环境自动禁用加密，避免复杂的加密依赖问题
 */
const USE_ENCRYPTION = !(typeof process !== 'undefined' && process.env.NODE_ENV === 'test') && true;

/**
 * 默认数据库实例
 * 根据 USE_ENCRYPTION 配置决定使用加密存储还是普通存储
 */
export const db = USE_ENCRYPTION ? new EncryptedStorageAdapter() : storage;

/**
 * 明文存储实例（用于调试）
 * 开发时可以直接查看明文数据，便于调试
 */
export const plainStorage = storage;
