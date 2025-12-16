// src/core/file/FileHandlerFactory.ts
// 文件处理器工厂类，用于创建不同类型的文件处理器
// 创建于: 2025-11-28
// 最后修改: 2025-12-11

import { IMetadataManager } from '../../types/metadataManagerInfc';
import ROOT from '../../utils/ROOTPath';
import { ChunkedFileHandler } from './ChunkedFileHandler';
import { SingleFileHandler } from './SingleFileHandler';

/**
 * 文件处理器工厂类，用于创建不同类型的文件处理器
 */
export class FileHandlerFactory {
  /**
   * 分片大小
   */
  private chunkSize: number;

  /**
   * 元数据管理器实例
   */
  private metadataManager: IMetadataManager;

  /**
   * 构造函数
   * @param chunkSize 分片大小
   * @param metadataManager 元数据管理器实例
   */
  constructor(chunkSize: number, metadataManager: IMetadataManager) {
    this.chunkSize = chunkSize;
    this.metadataManager = metadataManager;
  }

  /**
   * 获取单文件处理器
   * @param tableName 表名
   * @returns 单文件处理器实例
   */
  getSingleFileHandler(tableName: string): SingleFileHandler {
    const filePath = `${ROOT}/${tableName}.ldb`;
    return new SingleFileHandler(filePath);
  }

  /**
   * 获取分片文件处理器
   * @param tableName 表名
   * @returns 分片文件处理器实例
   */
  getChunkedFileHandler(tableName: string): ChunkedFileHandler {
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  /**
   * 判断是否应该使用分片模式
   * @param data 要写入的数据
   * @returns 是否应该使用分片模式
   */
  shouldUseChunkedMode(data: Record<string, any>[]): boolean {
    // 根据数据量决定是否使用分片模式
    const estimatedSize = data.reduce((acc, item) => acc + JSON.stringify(item).length, 0);
    return estimatedSize > (this.chunkSize || 1024 * 1024) / 2;
  }
  
  /**
   * 更新分片大小
   * @param chunkSize 新的分片大小
   */
  updateChunkSize(chunkSize: number): void {
    if (typeof chunkSize === 'number' && chunkSize > 0) {
      this.chunkSize = chunkSize;
    }
  }
}
