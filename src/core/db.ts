/**
 * Database Instance Management
 * Responsible for creating and exporting database instances with configurable encryption.
 * 
 * @module db
 * @since 2025-11-23
 * @version 1.0.0
 */

import storage from './adapter/FileSystemStorageAdapter';
import { EncryptedStorageAdapter } from './EncryptedStorageAdapter';
import type { IStorageAdapter } from '../types/storageAdapterInfc';

/**
 * Database instance manager that allows dynamic switching between encrypted and non-encrypted modes.
 */
export class DbInstanceManager {
  private static instance: DbInstanceManager;
  private defaultInstance: IStorageAdapter = storage;
  private encryptedInstances: Map<boolean, EncryptedStorageAdapter> = new Map();

  private constructor() {}

  /**
   * Gets the singleton instance of the DbInstanceManager.
   * 
   * @returns DbInstanceManager Singleton instance
   */
  public static getInstance(): DbInstanceManager {
    return DbInstanceManager.instance ?? (DbInstanceManager.instance = new DbInstanceManager());
  }

  /**
   * Gets the storage instance based on encryption requirements.
   * 
   * @param encrypted Whether to enable encrypted storage (defaults to false)
   * @param requireAuthOnAccess Whether biometric authentication is required (defaults to false)
   * @returns IStorageAdapter Storage instance matching the specified requirements
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
   * Gets the default database instance (for backward compatibility).
   * 
   * @returns IStorageAdapter Default non-encrypted storage instance
   */
  public getDefaultInstance(): IStorageAdapter {
    return this.defaultInstance;
  }
}

/**
 * Database instance manager singleton.
 */
export const dbManager = DbInstanceManager.getInstance();

/**
 * Default database instance (initially non-encrypted).
 */
export const db = dbManager.getDbInstance();

/**
 * Plain storage instance (for debugging purposes).
 * Allows direct viewing of plaintext data during development.
 */
export const plainStorage = storage;
