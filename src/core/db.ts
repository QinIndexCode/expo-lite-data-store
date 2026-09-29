import storage from './adapter/FileSystemStorageAdapter';
import { EncryptedStorageAdapter } from './EncryptedStorageAdapter';
import type { IStorageAdapter } from '../types/storageAdapterInfc';
import { StorageAdapterFactory } from './adapter/StorageAdapterFactory';
import { configManager } from './config/ConfigManager';
import { readPersistedEnginePreference, type PersistedEngine } from './config/EnginePreference';
import { loadOptionalExpoModule } from '../utils/expoModuleLoader';

export class DbInstanceManager {
  private static instance: DbInstanceManager;
  private adapterInstances: Map<string, IStorageAdapter> = new Map();
  private persistedEnginePreference: PersistedEngine | null = null;

  private constructor() {}

  public static getInstance(): DbInstanceManager {
    return DbInstanceManager.instance ?? (DbInstanceManager.instance = new DbInstanceManager());
  }

  public resolveActiveEngine(): 'file-system' | 'sqlite' {
    const configuredEngine = configManager.getConfig().engine ?? 'file-system';
    if (configuredEngine === 'sqlite') {
      return 'sqlite';
    }
    if (configuredEngine === 'auto') {
      const sqliteModule = loadOptionalExpoModule('expo-sqlite');
      if (sqliteModule) {
        return 'sqlite';
      }
      return 'file-system';
    }
    // Explicit runtime engine choices always win. Only the untouched default
    // defers to the persisted migration marker, so a programmatic
    // setConfig({ engine: 'file-system' }) can always switch back.
    if (!configManager.hasExplicitEngineChoice() && this.persistedEnginePreference === 'sqlite') {
      return 'sqlite';
    }
    return 'file-system';
  }

  /** Loads the persisted engine marker into the in-memory resolution mirror. */
  public async loadPersistedEnginePreference(): Promise<void> {
    this.persistedEnginePreference = await readPersistedEnginePreference();
  }

  /** Updates the in-memory engine mirror after the marker file was rewritten. */
  public setPersistedEnginePreference(engine: PersistedEngine | null): void {
    this.persistedEnginePreference = engine;
  }

  public getDbInstance(encrypted: boolean = false, requireAuthOnAccess: boolean = false): IStorageAdapter {
    const engineType = this.resolveActiveEngine();
    const cacheKey = `${engineType}:${encrypted}:${requireAuthOnAccess}`;

    const existing = this.adapterInstances.get(cacheKey);
    if (existing) {
      return existing;
    }

    let adapter: IStorageAdapter;
    if (engineType === 'sqlite') {
      if (!encrypted) {
        adapter = StorageAdapterFactory.createSQLiteAdapter();
      } else {
        adapter = StorageAdapterFactory.createEncryptedSQLiteAdapter({ requireAuthOnAccess });
      }
    } else {
      if (!encrypted) {
        adapter = storage;
      } else {
        adapter = new EncryptedStorageAdapter({ requireAuthOnAccess });
      }
    }

    this.adapterInstances.set(cacheKey, adapter);
    return adapter;
  }

  public getDefaultInstance(): IStorageAdapter {
    return this.getDbInstance(false, false);
  }

  public async resetInstances(): Promise<void> {
    const instances = Array.from(this.adapterInstances.values());
    this.adapterInstances.clear();
    for (const adapter of instances) {
      if (typeof adapter.cleanup === 'function') {
        try {
          await adapter.cleanup();
        } catch {
          // ignore cleanup errors during instance reset
        }
      }
    }
  }
}

export const dbManager = DbInstanceManager.getInstance();

export const db: IStorageAdapter = new Proxy({} as IStorageAdapter, {
  get(_target, prop, receiver): unknown {
    const activeInstance = dbManager.getDbInstance();
    const targetObj = activeInstance as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(targetObj, prop, receiver);
    if (typeof value === 'function') {
      return (...args: unknown[]): unknown =>
        Reflect.apply(value as (...callArgs: unknown[]) => unknown, activeInstance, args);
    }
    return value;
  },
});

/** Exposes unencrypted storage for diagnostics. */
export const plainStorage = storage;
