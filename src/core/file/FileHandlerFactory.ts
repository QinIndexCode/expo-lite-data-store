import { IMetadataManager } from '../../types/metadataManagerInfc';
import { type StorageRecord } from '../../types/storageTypes';
import { assertValidTableName } from '../../utils/tableName';
import { getRootPathSync } from '../../utils/ROOTPath';
import { ChunkedFileHandler } from './ChunkedFileHandler';
import { SingleFileHandler } from './SingleFileHandler';

export class FileHandlerFactory {
  private chunkSize: number;

  private metadataManager: IMetadataManager;

  constructor(chunkSize: number, metadataManager: IMetadataManager) {
    this.chunkSize = chunkSize;
    this.metadataManager = metadataManager;
  }

  getSingleFileHandler(tableName: string): SingleFileHandler {
    assertValidTableName(tableName);
    const filePath = `${getRootPathSync()}${tableName}.ldb`;
    return new SingleFileHandler(filePath);
  }

  getChunkedFileHandler(tableName: string): ChunkedFileHandler {
    assertValidTableName(tableName);
    return new ChunkedFileHandler(tableName, this.metadataManager);
  }

  shouldUseChunkedMode(data: StorageRecord[]): boolean {
    const estimatedSize = data.reduce((acc, item) => acc + JSON.stringify(item).length, 0);
    return estimatedSize > (this.chunkSize || 1024 * 1024) / 2;
  }

  updateChunkSize(chunkSize: number): void {
    if (typeof chunkSize === 'number' && chunkSize > 0) {
      this.chunkSize = chunkSize;
    }
  }
}
