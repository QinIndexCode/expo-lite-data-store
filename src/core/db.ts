// src/core/db.ts
// 数据库实例初始化文件，负责创建和导出数据库实例
// 根据环境配置决定是否使用加密存储
// 创建于: 2025-11-23
// 最后修改: 2025-12-16

import storage from './adapter/FileSystemStorageAdapter';
import { EncryptedStorageAdapter } from './EncryptedStorageAdapter';
import type { IStorageAdapter } from '../types/storageAdapterInfc';

/**
 * 数据库实例管理器
 * 允许动态切换加密模式
 */
export class DbInstanceManager {
  private static instance: DbInstanceManager;
  private defaultInstance: IStorageAdapter = storage;
  private encryptedInstances: Map<boolean, EncryptedStorageAdapter> = new Map();

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): DbInstanceManager {
    if (!DbInstanceManager.instance) {
      DbInstanceManager.instance = new DbInstanceManager();
    }
    return DbInstanceManager.instance;
  }

  /**
   * 获取存储实例
   * @param encrypted 是否启用加密存储
   * @param requireAuthOnAccess 是否需要生物识别验证
   */
  public getDbInstance(encrypted: boolean = false, requireAuthOnAccess: boolean = false): IStorageAdapter {
    if (!encrypted) {
      return this.defaultInstance;
    }

    // 根据requireAuthOnAccess参数获取或创建对应的加密实例
    const instanceKey = requireAuthOnAccess;
    if (!this.encryptedInstances.has(instanceKey)) {
      this.encryptedInstances.set(instanceKey, new EncryptedStorageAdapter({ requireAuthOnAccess }));
    }

    return this.encryptedInstances.get(instanceKey)!;
  }

  /**
   * 获取当前数据库实例（兼容旧API）
   */
  public getDefaultInstance(): IStorageAdapter {
    return this.defaultInstance;
  }
}

// 创建单例实例
export const dbManager = DbInstanceManager.getInstance();

/**
 * 默认数据库实例（初始为非加密存储）
 */
export const db = dbManager.getDbInstance();

/**
 * 明文存储实例（用于调试）
 * 开发时可以直接查看明文数据，便于调试
 */
export const plainStorage = storage;
