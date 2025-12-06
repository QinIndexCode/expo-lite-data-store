import * as FileSystem from 'expo-file-system';
import ROOT from '../utils/ROOTPath';
import withTimeout from '../utils/withTimeout';
import { ChunkedFileHandler } from './file/ChunkedFileHandler';
import { FileHandlerFactory } from './file/FileHandlerFactory';
import { FileInfoCache } from './file/FileInfoCache';
import { PermissionChecker } from './file/PermissionChecker';
import { SingleFileHandler } from './file/SingleFileHandler';
import { IMetadataManager } from '../types/metadataManagerInfc';
/**
 * 文件操作管理器类
 * 负责协调文件系统相关的操作，委托给具体的实现类
 */
export class FileOperationManager {
  /**
   * 文件信息缓存
   */
  private fileInfoCache: FileInfoCache;

  /**
   * 权限检查器
   */
  private permissionChecker: PermissionChecker;

  /**
   * 文件处理器工厂
   */
  private fileHandlerFactory: FileHandlerFactory;

  /**
   * 构造函数
   * @param chunkSize 分片大小
   * @param metadataManager 元数据管理器实例
   */
  constructor(chunkSize: number, metadataManager: IMetadataManager) {
    this.fileInfoCache = new FileInfoCache();
    this.permissionChecker = new PermissionChecker();
    this.fileHandlerFactory = new FileHandlerFactory(chunkSize, metadataManager);
  }

  /**
   * 获取文件信息，优先从缓存中获取
   * @param path 文件路径
   * @returns 文件信息
   */
  async getFileInfo(path: string): Promise<any> {
    return this.fileInfoCache.getFileInfo(path);
  }

  /**
   * 清除文件信息缓存
   * @param path 文件路径（可选），如果不提供则清除所有缓存
   */
  clearFileInfoCache(path?: string): void {
    this.fileInfoCache.clearFileInfoCache(path);
  }

  /**
   * 检查文件系统访问权限
   */
  async checkPermissions(): Promise<void> {
    return this.permissionChecker.checkPermissions();
  }

  /**
   * 获取单文件处理器
   * @param tableName 表名
   * @returns 单文件处理器实例
   */
  getSingleFileHandler(tableName: string): SingleFileHandler {
    return this.fileHandlerFactory.getSingleFileHandler(tableName);
  }

  /**
   * 获取分片文件处理器
   * @param tableName 表名
   * @returns 分片文件处理器实例
   */
  getChunkedFileHandler(tableName: string): ChunkedFileHandler {
    return this.fileHandlerFactory.getChunkedFileHandler(tableName);
  }

  /**
   * 判断是否应该使用分片模式
   * @param data 要写入的数据
   * @returns 是否应该使用分片模式
   */
  shouldUseChunkedMode(data: Record<string, any>[]): boolean {
    return this.fileHandlerFactory.shouldUseChunkedMode(data);
  }

  /**
   * 读取单文件数据
   * @param tableName 表名
   * @returns 读取的数据
   */
  async readSingleFile(tableName: string): Promise<Record<string, any>[]> {
    const handler = this.getSingleFileHandler(tableName);
    return await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
  }

  /**
   * 写入单文件数据
   * @param tableName 表名
   * @param data 要写入的数据
   */
  async writeSingleFile(tableName: string, data: Record<string, any>[]): Promise<void> {
    const handler = this.getSingleFileHandler(tableName);
    await withTimeout(handler.write(data), 10000, `write to single file table ${tableName}`);
  }

  /**
   * 读取分片文件数据
   * @param tableName 表名
   * @returns 读取的数据
   */
  async readChunkedFile(tableName: string): Promise<Record<string, any>[]> {
    const handler = this.getChunkedFileHandler(tableName);
    return await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
  }

  /**
   * 写入分片文件数据
   * @param tableName 表名
   * @param data 要写入的数据
   */
  async writeChunkedFile(tableName: string, data: Record<string, any>[]): Promise<void> {
    const handler = this.getChunkedFileHandler(tableName);
    await withTimeout(handler.write(data), 10000, `write to chunked table ${tableName}`);
  }

  /**
   * 清空分片文件
   * @param tableName 表名
   */
  async clearChunkedFile(tableName: string): Promise<void> {
    const handler = this.getChunkedFileHandler(tableName);
    await withTimeout(handler.clear(), 10000, `clear chunked table ${tableName}`);
  }

  /**
   * 删除单文件
   * @param tableName 表名
   */
  async deleteSingleFile(tableName: string): Promise<void> {
    const handler = this.getSingleFileHandler(tableName);
    await handler.delete();
  }

  /**
   * 删除目录
   * @param tableName 表名
   */
  async deleteDirectory(tableName: string): Promise<void> {
    const directoryPath = `${ROOT}/${tableName}`;
    await FileSystem.deleteAsync(directoryPath, { idempotent: true });
  }
}
