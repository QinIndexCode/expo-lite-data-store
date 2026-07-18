import { getFileSystem } from '../utils/fileSystemCompat';
import { getRootPathSync } from '../utils/ROOTPath';
import { assertValidTableName } from '../utils/tableName';
import withTimeout from '../utils/withTimeout';
import { ChunkedFileHandler } from './file/ChunkedFileHandler';
import { FileHandlerFactory } from './file/FileHandlerFactory';
import { FileInfoCache } from './file/FileInfoCache';
import { PermissionChecker } from './file/PermissionChecker';
import { SingleFileHandler } from './file/SingleFileHandler';
import { IMetadataManager } from '../types/metadataManagerInfc';
import { type StorageRecord } from '../types/storageTypes';
import logger from '../utils/logger';
import { type FileInfoCompat } from '../utils/fileSystemCompat';

export class FileOperationManager {
  private fileInfoCache: FileInfoCache;

  private permissionChecker: PermissionChecker;

  private fileHandlerFactory: FileHandlerFactory;

  constructor(chunkSize: number, metadataManager: IMetadataManager) {
    this.fileInfoCache = new FileInfoCache();
    this.permissionChecker = new PermissionChecker();
    this.fileHandlerFactory = new FileHandlerFactory(chunkSize, metadataManager);
  }

  updateChunkSize(chunkSize: number): void {
    this.fileHandlerFactory.updateChunkSize(chunkSize);
    logger.info('[FileOperationManager] Chunk size updated to:', chunkSize);
  }

  async getFileInfo(path: string): Promise<FileInfoCompat> {
    return this.fileInfoCache.getFileInfo(path);
  }

  clearFileInfoCache(path?: string): void {
    this.fileInfoCache.clearFileInfoCache(path);
  }

  async checkPermissions(): Promise<void> {
    return this.permissionChecker.checkPermissions();
  }

  getSingleFileHandler(tableName: string): SingleFileHandler {
    return this.fileHandlerFactory.getSingleFileHandler(tableName);
  }

  getChunkedFileHandler(tableName: string): ChunkedFileHandler {
    return this.fileHandlerFactory.getChunkedFileHandler(tableName);
  }

  shouldUseChunkedMode(data: StorageRecord[]): boolean {
    return this.fileHandlerFactory.shouldUseChunkedMode(data);
  }

  async readSingleFile(tableName: string): Promise<StorageRecord[]> {
    const handler = this.getSingleFileHandler(tableName);
    return await withTimeout(handler.read(), 10000, `read single file table ${tableName}`);
  }

  async writeSingleFile(tableName: string, data: StorageRecord[]): Promise<void> {
    const handler = this.getSingleFileHandler(tableName);
    await withTimeout(handler.write(data), 10000, `write to single file table ${tableName}`);
  }

  async readChunkedFile(tableName: string): Promise<StorageRecord[]> {
    const handler = this.getChunkedFileHandler(tableName);
    return await withTimeout(handler.readAll(), 10000, `read chunked table ${tableName}`);
  }

  async writeChunkedFile(tableName: string, data: StorageRecord[]): Promise<void> {
    const handler = this.getChunkedFileHandler(tableName);
    await withTimeout(handler.write(data), 10000, `write to chunked table ${tableName}`);
  }

  async clearChunkedFile(tableName: string): Promise<void> {
    const handler = this.getChunkedFileHandler(tableName);
    await withTimeout(handler.clear(), 10000, `clear chunked table ${tableName}`);
  }

  async deleteSingleFile(tableName: string): Promise<void> {
    const handler = this.getSingleFileHandler(tableName);
    await handler.delete();
  }

  async deleteDirectory(tableName: string): Promise<void> {
    assertValidTableName(tableName);
    const directoryPath = `${getRootPathSync()}${tableName}`;
    await getFileSystem().deleteAsync(directoryPath, { idempotent: true });
  }
}
