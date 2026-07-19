import storage from './adapter/FileSystemStorageAdapter';
import { EncryptedStorageAdapter } from './EncryptedStorageAdapter';
import type { IStorageAdapter } from '../types/storageAdapterInfc';

export class DbInstanceManager {
  private static instance: DbInstanceManager;
  private defaultInstance: IStorageAdapter = storage;
  private encryptedInstances: Map<boolean, EncryptedStorageAdapter> = new Map();

  private constructor() {}

  public static getInstance(): DbInstanceManager {
    return DbInstanceManager.instance ?? (DbInstanceManager.instance = new DbInstanceManager());
  }

  public getDbInstance(encrypted: boolean = false, requireAuthOnAccess: boolean = false): IStorageAdapter {
    if (!encrypted) {
      return this.defaultInstance;
    }

    const instanceKey = requireAuthOnAccess;
    if (!this.encryptedInstances.has(instanceKey)) {
      this.encryptedInstances.set(instanceKey, new EncryptedStorageAdapter({ requireAuthOnAccess }));
    }

    return this.encryptedInstances.get(instanceKey)!;
  }

  public getDefaultInstance(): IStorageAdapter {
    return this.defaultInstance;
  }
}

export const dbManager = DbInstanceManager.getInstance();

export const db = dbManager.getDbInstance();

/** Exposes unencrypted storage for diagnostics. */
export const plainStorage = storage;
