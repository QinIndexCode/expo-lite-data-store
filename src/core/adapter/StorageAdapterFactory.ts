import { IMetadataManager } from '../../types/metadataManagerInfc';
import { IStorageAdapter } from '../../types/storageAdapterInfc';
import { meta } from '../meta/MetadataManager';
import { FileSystemStorageAdapter } from './FileSystemStorageAdapter';
import { EncryptedStorageAdapter } from '../EncryptedStorageAdapter';

export enum StorageAdapterType {
  FILE_SYSTEM = 'file_system',
  ENCRYPTED = 'encrypted',
}

export interface StorageAdapterConfig {
  type: StorageAdapterType;
  metadataManager?: IMetadataManager;
  requireAuthOnAccess?: boolean;
  [key: string]: unknown;
}

export class StorageAdapterFactory {
  static createAdapter(config: StorageAdapterConfig): IStorageAdapter {
    switch (config.type) {
      case StorageAdapterType.FILE_SYSTEM:
        return new FileSystemStorageAdapter(config.metadataManager ?? meta);
      case StorageAdapterType.ENCRYPTED:
        return new EncryptedStorageAdapter({
          requireAuthOnAccess: config.requireAuthOnAccess ?? false,
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
}
