// src/core/adapter/StorageAdapterFactory.ts
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { IStorageAdapter } from '../../types/storageAdapterInfc';
import { meta } from '../meta/MetadataManager';
import { FileSystemStorageAdapter } from './FileSystemStorageAdapter';

/**
 * 存储适配器类型枚举
 */
export enum StorageAdapterType {
  FILE_SYSTEM = 'file_system',
  ENCRYPTED = 'encrypted',
}

/**
 * 存储适配器配置接口
 */
export interface StorageAdapterConfig {
  /**
   * 存储适配器类型
   */
  type: StorageAdapterType;
  /**
   * 元数据管理器实例
   */
  metadataManager?: IMetadataManager;
  /**
   * 其他配置选项
   */
  [key: string]: any;
}

/**
 * 存储适配器工厂类
 *
 * 设计模式：工厂模式
 * 用途：创建不同类型的存储适配器实例，提高代码的扩展性和灵活性
 * 优势：
 * - 封装了适配器的创建逻辑
 * - 支持多种适配器类型
 * - 便于扩展新的适配器类型
 * - 统一的创建接口
 */
export class StorageAdapterFactory {
  /**
   * 创建存储适配器实例
   *
   * @param config - 适配器配置
   * @returns 存储适配器实例
   */
  static createAdapter(config: StorageAdapterConfig): IStorageAdapter {
    switch (config.type) {
      case StorageAdapterType.FILE_SYSTEM:
        return new FileSystemStorageAdapter(config.metadataManager || meta);
      case StorageAdapterType.ENCRYPTED:
        // 加密存储适配器的实现，目前尚未完全实现
        // return new EncryptedStorageAdapter(config.metadataManager || meta, config.encryptionKey);
        throw new Error('Encrypted storage adapter is not yet implemented');
      default:
        throw new Error(`Unknown storage adapter type: ${config.type}`);
    }
  }

  /**
   * 创建默认的文件系统存储适配器
   *
   * @param metadataManager - 元数据管理器实例，可选
   * @returns 文件系统存储适配器实例
   */
  static createDefaultAdapter(metadataManager?: IMetadataManager): IStorageAdapter {
    return new FileSystemStorageAdapter(metadataManager || meta);
  }
}
