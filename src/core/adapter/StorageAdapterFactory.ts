import { IMetadataManager } from '../../types/metadataManagerInfc';
import { IStorageAdapter } from '../../types/storageAdapterInfc';
import { IStorageEngine } from '../../types/storageEngineInfc';
import { meta } from '../meta/MetadataManager';
import { FileSystemStorageAdapter } from './FileSystemStorageAdapter';
import { SQLiteStorageAdapter } from './SQLiteStorageAdapter';
import { EncryptedStorageAdapter } from '../EncryptedStorageAdapter';

export enum StorageAdapterType {
  FILE_SYSTEM = 'file_system',
  ENCRYPTED = 'encrypted',
  SQLITE = 'sqlite',
  SQLITE_ENCRYPTED = 'sqlite_encrypted',
}

export interface StorageAdapterConfig {
  type: StorageAdapterType;
  metadataManager?: IMetadataManager;
  requireAuthOnAccess?: boolean;
  databaseName?: string;
  engine?: IStorageEngine;
  [key: string]: unknown;
}

export class StorageAdapterFactory {
  static createAdapter(config: StorageAdapterConfig): IStorageAdapter {
    switch (config.type) {
      case StorageAdapterType.FILE_SYSTEM:
        return new FileSystemStorageAdapter(config.metadataManager ?? meta);
      case StorageAdapterType.SQLITE:
        return new SQLiteStorageAdapter(config.metadataManager ?? meta, {
          databaseName: config.databaseName,
        });
      case StorageAdapterType.ENCRYPTED:
        return new EncryptedStorageAdapter({
          requireAuthOnAccess: config.requireAuthOnAccess ?? false,
        });
      case StorageAdapterType.SQLITE_ENCRYPTED:
        return new EncryptedStorageAdapter({
          requireAuthOnAccess: config.requireAuthOnAccess ?? false,
          engine:
            config.engine ??
            new SQLiteStorageAdapter(config.metadataManager ?? meta, {
              databaseName: config.databaseName,
            }),
        });
      default:
        throw new Error(`Unknown storage adapter type: ${config.type}`);
    }
  }

  static createDefaultAdapter(metadataManager?: IMetadataManager): IStorageAdapter {
    return new FileSystemStorageAdapter(metadataManager ?? meta);
  }

  static createEncryptedAdapter(requireAuthOnAccess?: boolean): IStorageAdapter {
    return new EncryptedStorageAdapter({
      requireAuthOnAccess: requireAuthOnAccess ?? false,
    });
  }

  static createSQLiteAdapter(metadataManager?: IMetadataManager, databaseName?: string): IStorageAdapter {
    return new SQLiteStorageAdapter(metadataManager ?? meta, { databaseName });
  }

  static createEncryptedSQLiteAdapter(options?: {
    requireAuthOnAccess?: boolean;
    metadataManager?: IMetadataManager;
    databaseName?: string;
  }): IStorageAdapter {
    return new EncryptedStorageAdapter({
      requireAuthOnAccess: options?.requireAuthOnAccess ?? false,
      engine: new SQLiteStorageAdapter(options?.metadataManager ?? meta, {
        databaseName: options?.databaseName,
      }),
    });
  }
}
