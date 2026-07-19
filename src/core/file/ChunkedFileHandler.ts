import { configManager } from '../config/ConfigManager';
import { IMetadataManager } from '../../types/metadataManagerInfc';
import { isStorageRecord, type StorageRecord } from '../../types/storageTypes';
import type { TableSchema } from '../meta/MetadataManager';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import { getRootPathSync } from '../../utils/ROOTPath';
import withTimeout, { withMutationTimeout } from '../../utils/withTimeout';
import { FileHandlerBase } from './FileHandlerBase';
import logger from '../../utils/logger';
import { assertValidTableName } from '../../utils/tableName';
import { StorageError } from '../../types/storageErrorInfc';

const CHUNK_EXT = '.ldb';
const OVERWRITE_JOURNAL_EXT = '.overwrite-journal';
const OVERWRITE_BACKUP_EXT = '.overwrite-backup';
const OVERWRITE_BACKUP_READY_FILE = '.ready';
const APPEND_JOURNAL_EXT = '.append-journal';

interface LegacyOverwriteJournal {
  version: 1;
  tableName: string;
  previousData: StorageRecord[];
  previousHash: string;
  targetHash: string;
  targetCount: number;
  createdAt: number;
}

interface OverwriteJournalV2 {
  version: 2;
  tableName: string;
  previousMetadataExisted: boolean;
  previousDirectoryExisted: boolean;
  previousCount: number;
  previousChunks: number;
  createdAt: number;
}

type OverwriteJournal = LegacyOverwriteJournal | OverwriteJournalV2;

interface AppendJournal {
  version: 1;
  tableName: string;
  previousCount: number;
  previousChunks: number;
  targetChunkIndices: number[];
  targetCount: number;
  createdAt: number;
}

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isJournalEnvelope = (value: unknown): value is { journal: unknown; hash: string } =>
  isStorageRecord(value) && 'journal' in value && typeof value.hash === 'string';

const isLegacyOverwriteJournal = (value: unknown, tableName: string): value is LegacyOverwriteJournal => {
  if (!isStorageRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    value.tableName === tableName &&
    Array.isArray(value.previousData) &&
    value.previousData.every(isStorageRecord) &&
    typeof value.previousHash === 'string' &&
    typeof value.targetHash === 'string' &&
    isNonNegativeSafeInteger(value.targetCount) &&
    isNonNegativeSafeInteger(value.createdAt)
  );
};

const isOverwriteJournalV2 = (value: unknown, tableName: string): value is OverwriteJournalV2 => {
  if (!isStorageRecord(value)) {
    return false;
  }

  const previousCount = value.previousCount;
  const previousChunks = value.previousChunks;
  const previousMetadataExisted = value.previousMetadataExisted;
  const previousDirectoryExisted = value.previousDirectoryExisted;
  return (
    value.version === 2 &&
    value.tableName === tableName &&
    typeof previousMetadataExisted === 'boolean' &&
    typeof previousDirectoryExisted === 'boolean' &&
    isNonNegativeSafeInteger(previousCount) &&
    isNonNegativeSafeInteger(previousChunks) &&
    (previousMetadataExisted || (previousCount === 0 && previousChunks === 0)) &&
    (previousDirectoryExisted || previousChunks === 0) &&
    isNonNegativeSafeInteger(value.createdAt)
  );
};

const isOverwriteJournal = (value: unknown, tableName: string): value is OverwriteJournal =>
  isLegacyOverwriteJournal(value, tableName) || isOverwriteJournalV2(value, tableName);

const isAppendJournal = (value: unknown, tableName: string): value is AppendJournal => {
  if (!isStorageRecord(value) || !Array.isArray(value.targetChunkIndices)) {
    return false;
  }

  const targetChunkIndices = value.targetChunkIndices;
  const previousChunks = value.previousChunks;
  return (
    value.version === 1 &&
    value.tableName === tableName &&
    isNonNegativeSafeInteger(value.previousCount) &&
    isNonNegativeSafeInteger(previousChunks) &&
    targetChunkIndices.every(isNonNegativeSafeInteger) &&
    new Set(targetChunkIndices).size === targetChunkIndices.length &&
    targetChunkIndices.length > 0 &&
    targetChunkIndices.every((chunkIndex, position) => chunkIndex === previousChunks + position) &&
    isNonNegativeSafeInteger(value.targetCount) &&
    value.targetCount > 0 &&
    isNonNegativeSafeInteger(value.createdAt)
  );
};

/**
 * Chunked file handler for large tables.
 */
export class ChunkedFileHandler extends FileHandlerBase {
  private static readonly chunkMutationEpochs = new Map<string, number>();

  private tableName: string;
  private tableDirPath: string;
  private metadataManager: IMetadataManager;
  private chunkCache = new Map<number, StorageRecord[]>();
  private readonly maxCacheSize = 10;
  private observedChunkMutationEpoch: number;

  constructor(tableName: string, metadataManager: IMetadataManager) {
    super();
    assertValidTableName(tableName);
    this.tableName = tableName;
    this.tableDirPath = `${getRootPathSync()}${tableName}/`;
    this.metadataManager = metadataManager;
    this.observedChunkMutationEpoch = ChunkedFileHandler.chunkMutationEpochs.get(this.tableDirPath) ?? 0;
  }

  private synchronizeChunkCache(): void {
    const currentEpoch = ChunkedFileHandler.chunkMutationEpochs.get(this.tableDirPath) ?? 0;
    if (currentEpoch === this.observedChunkMutationEpoch) {
      return;
    }

    this.chunkCache.clear();
    this.observedChunkMutationEpoch = currentEpoch;
  }

  private markChunksMutated(): void {
    const nextEpoch = (ChunkedFileHandler.chunkMutationEpochs.get(this.tableDirPath) ?? 0) + 1;
    ChunkedFileHandler.chunkMutationEpochs.set(this.tableDirPath, nextEpoch);
    this.chunkCache.clear();
    this.observedChunkMutationEpoch = nextEpoch;
  }

  private getChunkFilePath(index: number): string {
    return `${this.tableDirPath}${String(index).padStart(6, '0')}${CHUNK_EXT}`;
  }

  private getOverwriteJournalPath(): string {
    return `${getRootPathSync()}${this.tableName}${OVERWRITE_JOURNAL_EXT}`;
  }

  private getOverwriteBackupPath(): string {
    return `${getRootPathSync()}${this.tableName}${OVERWRITE_BACKUP_EXT}/`;
  }

  private getAppendJournalPath(): string {
    return `${getRootPathSync()}${this.tableName}${APPEND_JOURNAL_EXT}`;
  }

  async write(data: StorageRecord[]): Promise<void> {
    await this.runWithPathLock(this.tableDirPath, () => this.writeUnlocked(data));
  }

  /**
   * Builds a chunked replacement for an authoritative single-file table.
   * Metadata changes mode only after every chunk has been published and verified.
   */
  async writeSingleFileMigration(data: StorageRecord[]): Promise<void> {
    await this.runWithPathLock(this.tableDirPath, () => this.writeSingleFileMigrationUnlocked(data));
  }

  private async writeSingleFileMigrationUnlocked(data: StorageRecord[]): Promise<void> {
    this.validateArrayData(data);
    const previousMetadata = this.metadataManager.get(this.tableName);
    if (!previousMetadata || previousMetadata.mode !== 'single') {
      throw new StorageError(`TABLE ${this.tableName} IS NOT CONFIGURED FOR SINGLE-FILE MIGRATION`, 'CORRUPTED_DATA');
    }

    await this.deleteAppendJournal();
    await this.deleteOverwriteJournal();
    await this.deleteOverwriteBackup();
    await this.resetTableDirectoryUnlocked(true);

    let metadataCommitStarted = false;
    try {
      const chunkSize = configManager.getConfig().chunkSize || 1024 * 1024;
      const chunks = data.length > 0 ? await this.preprocessData(data, chunkSize) : [];
      await this.writeChunks(chunks, 0);
      await this.validateChunkDirectory(this.tableDirPath, data.length, chunks.length, false);

      metadataCommitStarted = true;
      this.metadataManager.update(this.tableName, {
        mode: 'chunked',
        path: `${this.tableName}/`,
        count: data.length,
        chunks: chunks.length,
        updatedAt: Date.now(),
        storageCommitToken: undefined,
      });
      await this.persistMetadataIfSupported();
    } catch (error) {
      let metadataRestored = !metadataCommitStarted;
      if (metadataCommitStarted) {
        try {
          this.metadataManager.update(this.tableName, { ...previousMetadata });
          await this.persistMetadataIfSupported();
          metadataRestored = true;
        } catch (restoreError) {
          logger.error(`failed to restore single-file metadata for table ${this.tableName}`, restoreError);
        }
      }

      if (metadataRestored) {
        try {
          await this.resetTableDirectoryUnlocked(false);
        } catch (cleanupError) {
          logger.error(`failed to remove staged chunks for table ${this.tableName}`, cleanupError);
        }
      }

      throw this.formatWriteError(`migrate single-file table ${this.tableName} to chunked storage failed`, error);
    }
  }

  private async writeUnlocked(data: StorageRecord[]): Promise<void> {
    this.validateArrayData(data);
    await this.recoverPendingAppendJournal();
    await this.recoverPendingOverwriteJournal();

    const previousMetadata = this.metadataManager.get(this.tableName);
    if (previousMetadata && previousMetadata.mode !== 'chunked') {
      throw new StorageError(`TABLE ${this.tableName} IS NOT CONFIGURED FOR CHUNKED STORAGE`, 'CORRUPTED_DATA');
    }

    const previousCount = previousMetadata?.count ?? 0;
    const previousChunks = previousMetadata?.chunks ?? 0;
    const tableInfo = await super.getFileInfo(this.tableDirPath);
    const previousChunkFiles = await this.validateChunkDirectory(
      this.tableDirPath,
      previousCount,
      previousChunks,
      !tableInfo.exists
    );
    const journal: OverwriteJournalV2 = {
      version: 2,
      tableName: this.tableName,
      previousMetadataExisted: previousMetadata !== undefined,
      previousDirectoryExisted: tableInfo.exists,
      previousCount,
      previousChunks,
      createdAt: Date.now(),
    };

    await this.writeOverwriteJournal(journal);

    try {
      await this.createOverwriteBackup(journal, previousChunkFiles);
      await this.clearUnlocked();

      if (data.length > 0) {
        await this.appendInternal(data, false);
      }

      this.metadataManager.update(this.tableName, {
        count: data.length,
        updatedAt: Date.now(),
      });
      await this.persistMetadataIfSupported();

      await this.deleteOverwriteJournal();
      await this.deleteOverwriteBackup(true);
    } catch (error) {
      try {
        await this.recoverPendingAppendJournal();
        await this.recoverPendingOverwriteJournal();
      } catch (rollbackError) {
        logger.error(`failed to restore table ${this.tableName} after overwrite failure`, rollbackError);
      }
      throw this.formatWriteError(`write data to table ${this.tableName} failed`, error);
    }
  }

  private async writeOverwriteJournal(journal: OverwriteJournalV2): Promise<void> {
    const journalPath = this.getOverwriteJournalPath();
    const tempJournalPath = `${journalPath}.tmp`;
    const content = JSON.stringify({
      journal,
      hash: await this.computeHash(journal),
    });

    try {
      await withMutationTimeout(
        getFileSystem().writeAsStringAsync(tempJournalPath, content, { encoding: getEncodingType().UTF8 }),
        10000,
        `write overwrite journal ${journalPath}`
      );
      await withMutationTimeout(
        getFileSystem().moveAsync({ from: tempJournalPath, to: journalPath }),
        10000,
        `publish overwrite journal ${journalPath}`
      );
    } catch (error) {
      await this.cleanupTemporaryArtifact(tempJournalPath, 'cleanup overwrite journal');
      throw error;
    }
    this.clearFileInfoCache(journalPath);
  }

  private async readOverwriteJournal(): Promise<OverwriteJournal | null> {
    const journalPath = this.getOverwriteJournalPath();
    const info = await super.getFileInfo(journalPath);
    if (!info.exists) {
      return null;
    }

    try {
      const text = await withTimeout(
        getFileSystem().readAsStringAsync(journalPath, { encoding: getEncodingType().UTF8 }),
        10000,
        `read overwrite journal ${journalPath}`
      );
      const parsed: unknown = JSON.parse(text) as unknown;

      if (!isJournalEnvelope(parsed) || !isOverwriteJournal(parsed.journal, this.tableName)) {
        throw new StorageError(`OVERWRITE JOURNAL ${journalPath} FORMAT_ERROR`, 'CORRUPTED_DATA');
      }

      const journal = parsed.journal;
      const hash = await this.computeHash(journal);
      if (hash !== parsed.hash) {
        throw new StorageError(`OVERWRITE JOURNAL ${journalPath} CORRUPTED: hash mismatch`, 'CORRUPTED_DATA');
      }

      return journal;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`OVERWRITE JOURNAL ${journalPath} FORMAT_ERROR: invalid JSON`, 'CORRUPTED_DATA', {
          cause: error,
        });
      }
      throw this.formatReadError(`READ OVERWRITE JOURNAL ${journalPath} FAILED`, error);
    }
  }

  private async deleteOverwriteJournal(): Promise<void> {
    const journalPath = this.getOverwriteJournalPath();
    try {
      await withMutationTimeout(
        getFileSystem().deleteAsync(journalPath, { idempotent: true }),
        10000,
        `delete overwrite journal ${journalPath}`
      );
      this.clearFileInfoCache(journalPath);
    } catch (error) {
      logger.warn(`DELETE OVERWRITE JOURNAL ${journalPath} FAILED`, error);
      throw error;
    }
  }

  private async createOverwriteBackup(journal: OverwriteJournalV2, chunkFiles: readonly string[]): Promise<void> {
    const backupPath = this.getOverwriteBackupPath();
    const backupInfo = await super.getFileInfo(backupPath);
    if (backupInfo.exists) {
      throw new StorageError(`OVERWRITE BACKUP ${backupPath} ALREADY EXISTS`, 'CORRUPTED_DATA', {
        suggestion: 'Resolve the existing overwrite recovery state before retrying the write',
      });
    }

    await withMutationTimeout(
      getFileSystem().makeDirectoryAsync(backupPath, { intermediates: true }),
      10000,
      `create overwrite backup ${backupPath}`
    );
    this.clearFileInfoCache(backupPath);

    for (const sourcePath of chunkFiles) {
      const fileName = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
      const backupFilePath = `${backupPath}${fileName}`;
      await withMutationTimeout(
        getFileSystem().moveAsync({ from: sourcePath, to: backupFilePath }),
        10000,
        `move chunk ${fileName} to overwrite backup`
      );
      this.markChunksMutated();
      this.clearFileInfoCache(sourcePath);
      this.clearFileInfoCache(backupFilePath);
    }

    await this.validateChunkDirectory(backupPath, journal.previousCount, journal.previousChunks, false);
    await this.validateChunkDirectory(this.tableDirPath, 0, 0, !journal.previousDirectoryExisted);
    await this.writeOverwriteBackupReadyMarker(journal);
    this.chunkCache.clear();
  }

  private async writeOverwriteBackupReadyMarker(journal: OverwriteJournalV2): Promise<void> {
    const markerPath = `${this.getOverwriteBackupPath()}${OVERWRITE_BACKUP_READY_FILE}`;
    const tempMarkerPath = `${markerPath}.tmp`;
    const content = JSON.stringify({ version: 1, tableName: this.tableName, createdAt: journal.createdAt });
    try {
      await withMutationTimeout(
        getFileSystem().writeAsStringAsync(tempMarkerPath, content, { encoding: getEncodingType().UTF8 }),
        10000,
        `write overwrite backup marker ${markerPath}`
      );
      await withMutationTimeout(
        getFileSystem().moveAsync({ from: tempMarkerPath, to: markerPath }),
        10000,
        `publish overwrite backup marker ${markerPath}`
      );
      this.clearFileInfoCache(markerPath);
      const published = await withTimeout(
        getFileSystem().readAsStringAsync(markerPath, { encoding: getEncodingType().UTF8 }),
        10000,
        `verify overwrite backup marker ${markerPath}`
      );
      if (published !== content) {
        throw new StorageError(`OVERWRITE BACKUP MARKER ${markerPath} FAILED VERIFICATION`, 'CORRUPTED_DATA');
      }
    } catch (error) {
      await this.cleanupTemporaryArtifact(tempMarkerPath, 'cleanup overwrite backup marker');
      throw error;
    }
  }

  private async isOverwriteBackupReady(journal: OverwriteJournalV2): Promise<boolean> {
    const markerPath = `${this.getOverwriteBackupPath()}${OVERWRITE_BACKUP_READY_FILE}`;
    this.clearFileInfoCache(markerPath);
    const markerInfo = await super.getFileInfo(markerPath);
    if (!markerInfo.exists) {
      return false;
    }

    const text = await withTimeout(
      getFileSystem().readAsStringAsync(markerPath, { encoding: getEncodingType().UTF8 }),
      10000,
      `read overwrite backup marker ${markerPath}`
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      throw new StorageError(`OVERWRITE BACKUP MARKER ${markerPath} IS INVALID`, 'CORRUPTED_DATA', { cause: error });
    }
    if (
      !isStorageRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.tableName !== this.tableName ||
      parsed.createdAt !== journal.createdAt
    ) {
      throw new StorageError(`OVERWRITE BACKUP MARKER ${markerPath} DOES NOT MATCH ITS JOURNAL`, 'CORRUPTED_DATA');
    }
    return true;
  }

  private async deleteOverwriteBackup(suppressErrors = false): Promise<void> {
    const backupPath = this.getOverwriteBackupPath();
    try {
      await withMutationTimeout(
        getFileSystem().deleteAsync(backupPath, { idempotent: true }),
        10000,
        `delete overwrite backup ${backupPath}`
      );
      this.clearFileInfoCacheTree(backupPath);
    } catch (error) {
      logger.warn(`DELETE OVERWRITE BACKUP ${backupPath} FAILED`, error);
      if (!suppressErrors) {
        throw error;
      }
    }
  }

  private async copyBackupChunk(sourcePath: string, targetPath: string): Promise<void> {
    const sourceText = await withTimeout(
      getFileSystem().readAsStringAsync(sourcePath, { encoding: getEncodingType().UTF8 }),
      10000,
      `read overwrite backup chunk ${sourcePath}`
    );
    this.clearFileInfoCache(targetPath);
    const targetInfo = await super.getFileInfo(targetPath);
    if (targetInfo.exists) {
      const targetText = await withTimeout(
        getFileSystem().readAsStringAsync(targetPath, { encoding: getEncodingType().UTF8 }),
        10000,
        `read existing overwrite chunk ${targetPath}`
      );
      if (targetText !== sourceText) {
        throw new StorageError(`OVERWRITE RECOVERY CHUNK CONFLICT AT ${targetPath}`, 'CORRUPTED_DATA', {
          suggestion: 'Preserve the table and backup directories for manual recovery',
        });
      }
      return;
    }

    const tempPath = `${targetPath}.recovery.tmp`;
    try {
      await withMutationTimeout(
        getFileSystem().writeAsStringAsync(tempPath, sourceText, { encoding: getEncodingType().UTF8 }),
        10000,
        `write recovered chunk ${targetPath}`
      );
      await withMutationTimeout(
        getFileSystem().moveAsync({ from: tempPath, to: targetPath }),
        10000,
        `publish recovered chunk ${targetPath}`
      );
      this.markChunksMutated();
      this.clearFileInfoCache(targetPath);
    } catch (error) {
      await this.cleanupTemporaryArtifact(tempPath, 'cleanup recovered chunk');
      throw error;
    }
  }

  private async writeAppendJournal(
    previousCount: number,
    previousChunks: number,
    targetChunkIndices: number[],
    targetCount: number
  ): Promise<void> {
    const journalPath = this.getAppendJournalPath();
    const tempJournalPath = `${journalPath}.tmp`;
    const journal: AppendJournal = {
      version: 1,
      tableName: this.tableName,
      previousCount,
      previousChunks,
      targetChunkIndices,
      targetCount,
      createdAt: Date.now(),
    };
    const content = JSON.stringify({
      journal,
      hash: await this.computeHash(journal),
    });

    try {
      await withMutationTimeout(
        getFileSystem().writeAsStringAsync(tempJournalPath, content, { encoding: getEncodingType().UTF8 }),
        10000,
        `write append journal ${journalPath}`
      );
      await withMutationTimeout(
        getFileSystem().moveAsync({ from: tempJournalPath, to: journalPath }),
        10000,
        `publish append journal ${journalPath}`
      );
    } catch (error) {
      await this.cleanupTemporaryArtifact(tempJournalPath, 'cleanup append journal');
      throw error;
    }
    this.clearFileInfoCache(journalPath);
  }

  private async readAppendJournal(): Promise<AppendJournal | null> {
    const journalPath = this.getAppendJournalPath();
    const info = await super.getFileInfo(journalPath);
    if (!info.exists) {
      return null;
    }

    try {
      const text = await withTimeout(
        getFileSystem().readAsStringAsync(journalPath, { encoding: getEncodingType().UTF8 }),
        10000,
        `read append journal ${journalPath}`
      );
      const parsed: unknown = JSON.parse(text) as unknown;

      if (!isJournalEnvelope(parsed) || !isAppendJournal(parsed.journal, this.tableName)) {
        throw new StorageError(`APPEND JOURNAL ${journalPath} FORMAT_ERROR`, 'CORRUPTED_DATA');
      }

      const journal = parsed.journal;
      const hash = await this.computeHash(journal);
      if (hash !== parsed.hash) {
        throw new StorageError(`APPEND JOURNAL ${journalPath} CORRUPTED: hash mismatch`, 'CORRUPTED_DATA');
      }

      return journal;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`APPEND JOURNAL ${journalPath} FORMAT_ERROR: invalid JSON`, 'CORRUPTED_DATA', {
          cause: error,
        });
      }
      throw this.formatReadError(`READ APPEND JOURNAL ${journalPath} FAILED`, error);
    }
  }

  private async deleteAppendJournal(suppressErrors = false): Promise<void> {
    const journalPath = this.getAppendJournalPath();
    try {
      await withMutationTimeout(
        getFileSystem().deleteAsync(journalPath, { idempotent: true }),
        10000,
        `delete append journal ${journalPath}`
      );
      this.clearFileInfoCache(journalPath);
    } catch (error) {
      logger.warn(`DELETE APPEND JOURNAL ${journalPath} FAILED`, error);
      if (!suppressErrors) {
        throw error;
      }
    }
  }

  private async deleteChunkFiles(indices: number[]): Promise<void> {
    const results = await Promise.allSettled(
      indices.map(async index => {
        const filePath = this.getChunkFilePath(index);
        await withMutationTimeout(
          getFileSystem().deleteAsync(filePath, { idempotent: true }),
          10000,
          `delete appended chunk ${index}`
        );
        this.markChunksMutated();
        this.clearFileInfoCache(filePath);
      })
    );

    const failedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failedResult) {
      throw new StorageError(`Failed to remove partial chunks for table ${this.tableName}`, 'FILE_DELETE_FAILED', {
        cause: failedResult.reason,
        suggestion: 'Retry the operation so the pending append journal can finish recovery',
      });
    }
  }

  private async recoverPendingAppendJournal(): Promise<void> {
    const journal = await this.readAppendJournal();
    if (!journal) {
      return;
    }

    logger.warn(`Rolling back pending append journal for chunked table ${this.tableName}`);
    await this.deleteChunkFiles(journal.targetChunkIndices);
    this.metadataManager.update(this.tableName, {
      count: journal.previousCount,
      chunks: journal.previousChunks,
      updatedAt: Date.now(),
    });
    await this.persistMetadataIfSupported();
    await this.deleteAppendJournal();
  }

  private async persistMetadataIfSupported(): Promise<void> {
    if (typeof this.metadataManager.saveImmediately === 'function') {
      await this.metadataManager.saveImmediately();
    }
  }

  /** Removes a failed staging artifact before the shared path lock is released. */
  private async cleanupTemporaryArtifact(path: string, operation: string): Promise<void> {
    try {
      await withMutationTimeout(getFileSystem().deleteAsync(path, { idempotent: true }), 10000, `${operation} ${path}`);
      this.clearFileInfoCache(path);
    } catch (cleanupError) {
      logger.warn(`CLEANUP TEMPORARY ARTIFACT ${path} FAILED`, cleanupError);
    }
  }

  private async restoreAppendMetadata(previousMetadata: TableSchema | undefined): Promise<void> {
    if (previousMetadata) {
      this.metadataManager.update(this.tableName, { ...previousMetadata });
    } else {
      this.metadataManager.delete(this.tableName);
    }
    await this.persistMetadataIfSupported();
  }

  private assertOverwriteMetadataCanBeRestored(journal: OverwriteJournalV2): void {
    const metadata = this.metadataManager.get(this.tableName);
    if (journal.previousMetadataExisted && (!metadata || metadata.mode !== 'chunked')) {
      throw new StorageError(
        `OVERWRITE RECOVERY METADATA FOR ${this.tableName} IS MISSING OR INVALID`,
        'CORRUPTED_DATA',
        {
          suggestion: 'Preserve the table and overwrite backup for manual recovery',
        }
      );
    }
  }

  private async restoreOverwriteMetadata(journal: OverwriteJournalV2): Promise<void> {
    if (journal.previousMetadataExisted) {
      this.assertOverwriteMetadataCanBeRestored(journal);
      this.metadataManager.update(this.tableName, {
        mode: 'chunked',
        path: `${this.tableName}/`,
        count: journal.previousCount,
        chunks: journal.previousChunks,
      });
    } else {
      this.metadataManager.delete(this.tableName);
    }
    await this.persistMetadataIfSupported();
  }

  private async recoverPreparingOverwrite(journal: OverwriteJournalV2): Promise<void> {
    this.assertOverwriteMetadataCanBeRestored(journal);
    const backupPath = this.getOverwriteBackupPath();
    const backupInfo = await super.getFileInfo(backupPath);
    const backupFiles = backupInfo.exists
      ? await this.getChunkFilesInDirectory(backupPath, journal.previousChunks)
      : [];
    const backupIndices = new Set<number>();

    for (const backupFile of backupFiles) {
      const fileName = backupFile.slice(backupFile.lastIndexOf('/') + 1);
      const chunkIndex = Number.parseInt(fileName.replace(CHUNK_EXT, ''), 10);
      if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= journal.previousChunks) {
        throw new StorageError(`OVERWRITE BACKUP ${backupPath} CONTAINS AN UNEXPECTED CHUNK`, 'CORRUPTED_DATA');
      }
      backupIndices.add(chunkIndex);
    }

    if (journal.previousDirectoryExisted || journal.previousChunks > 0) {
      await withMutationTimeout(
        getFileSystem().makeDirectoryAsync(this.tableDirPath, { intermediates: true }),
        10000,
        `create overwrite recovery directory ${this.tableDirPath}`
      );
      this.clearFileInfoCache(this.tableDirPath);
    }

    for (let index = 0; index < journal.previousChunks; index++) {
      const currentPath = this.getChunkFilePath(index);
      const backupFilePath = `${backupPath}${String(index).padStart(6, '0')}${CHUNK_EXT}`;
      this.clearFileInfoCache(currentPath);
      this.clearFileInfoCache(backupFilePath);
      const currentInfo = await super.getFileInfo(currentPath);
      const chunkBackupInfo = await super.getFileInfo(backupFilePath);

      if (!currentInfo.exists && !chunkBackupInfo.exists) {
        throw new StorageError(`OVERWRITE RECOVERY LOST CHUNK ${index} FOR ${this.tableName}`, 'CORRUPTED_DATA', {
          suggestion: 'Preserve the table and backup directories for manual recovery',
        });
      }
      if (chunkBackupInfo.exists) {
        await this.copyBackupChunk(backupFilePath, currentPath);
      }
    }

    if (backupIndices.size !== backupFiles.length) {
      throw new StorageError(`OVERWRITE BACKUP ${backupPath} CONTAINS DUPLICATE CHUNKS`, 'CORRUPTED_DATA');
    }

    await this.validateChunkDirectory(
      this.tableDirPath,
      journal.previousCount,
      journal.previousChunks,
      !journal.previousDirectoryExisted
    );
    await this.restoreOverwriteMetadata(journal);
  }

  private async recoverReadyOverwrite(journal: OverwriteJournalV2): Promise<void> {
    this.assertOverwriteMetadataCanBeRestored(journal);
    const backupPath = this.getOverwriteBackupPath();
    const backupFiles = await this.validateChunkDirectory(
      backupPath,
      journal.previousCount,
      journal.previousChunks,
      false
    );

    await this.resetTableDirectoryUnlocked(journal.previousDirectoryExisted || journal.previousChunks > 0);
    for (const backupFile of backupFiles) {
      const fileName = backupFile.slice(backupFile.lastIndexOf('/') + 1);
      await this.copyBackupChunk(backupFile, `${this.tableDirPath}${fileName}`);
    }

    await this.validateChunkDirectory(
      this.tableDirPath,
      journal.previousCount,
      journal.previousChunks,
      !journal.previousDirectoryExisted
    );
    await this.restoreOverwriteMetadata(journal);
  }

  private async cleanupCommittedOverwriteBackup(): Promise<void> {
    const backupPath = this.getOverwriteBackupPath();
    const backupInfo = await super.getFileInfo(backupPath);
    if (!backupInfo.exists) {
      return;
    }

    const metadata = this.metadataManager.get(this.tableName);
    if (!metadata || metadata.mode !== 'chunked') {
      throw new StorageError(
        `CANNOT VERIFY COMMITTED TABLE ${this.tableName} BEFORE BACKUP CLEANUP`,
        'CORRUPTED_DATA',
        {
          suggestion: 'Preserve the overwrite backup until the current table metadata can be verified',
        }
      );
    }
    await this.validateChunkDirectory(this.tableDirPath, metadata.count, metadata.chunks ?? 0, false);
    await this.deleteOverwriteBackup(true);
  }

  private async recoverPendingOverwriteJournal(): Promise<void> {
    const journal = await this.readOverwriteJournal();
    if (!journal) {
      await this.cleanupCommittedOverwriteBackup();
      return;
    }

    logger.warn(`Recovering uncommitted overwrite for chunked table ${this.tableName}`);
    if (journal.version === 1) {
      const previousHash = await this.computeHash(journal.previousData);
      if (previousHash !== journal.previousHash) {
        throw new StorageError(
          `OVERWRITE JOURNAL ${this.getOverwriteJournalPath()} CORRUPTED: previous data hash mismatch`,
          'CORRUPTED_DATA'
        );
      }

      let targetMatches = false;
      try {
        const currentData = await this.readAllChunks();
        const currentHash = await this.computeHash(currentData);
        targetMatches = currentData.length === journal.targetCount && currentHash === journal.targetHash;
      } catch (error) {
        logger.warn(`Current chunked table ${this.tableName} is incomplete while a v1 overwrite is pending`, error);
      }
      if (targetMatches) {
        await this.deleteOverwriteJournal();
        return;
      }

      logger.warn(`Recovering chunked table ${this.tableName} from a pending v1 overwrite journal`);
      await this.clearUnlocked();
      if (journal.previousData.length > 0) {
        await this.appendInternal(journal.previousData, false);
      }
      await this.deleteOverwriteJournal();
      return;
    }

    if (await this.isOverwriteBackupReady(journal)) {
      await this.recoverReadyOverwrite(journal);
    } else {
      await this.recoverPreparingOverwrite(journal);
    }
    await this.deleteOverwriteJournal();
    await this.deleteOverwriteBackup(true);
  }

  async read(): Promise<StorageRecord[]> {
    return this.readAll();
  }

  async delete(): Promise<void> {
    await this.clear();
  }

  async append(data: StorageRecord[]): Promise<void> {
    await this.runWithPathLock(this.tableDirPath, () => this.appendInternal(data, true));
  }

  private async appendInternal(data: StorageRecord[], recoverPendingOverwrite: boolean): Promise<void> {
    let targetChunkIndices: number[] = [];
    let appendJournalPublished = false;
    let previousMetadata: TableSchema | undefined;
    let metadataUpdated = false;
    try {
      this.validateArrayData(data);
      await this.recoverPendingAppendJournal();
      if (recoverPendingOverwrite) {
        await this.recoverPendingOverwriteJournal();
      }
      if (data.length === 0) return;
      previousMetadata = this.metadataManager.get(this.tableName);

      await withMutationTimeout(
        getFileSystem().makeDirectoryAsync(this.tableDirPath, { intermediates: true }),
        10000,
        `create table directory ${this.tableName}`
      );

      this.clearFileInfoCache(this.tableDirPath);

      const currentMeta = this.metadataManager.get(this.tableName) || {
        mode: 'chunked' as const,
        path: this.tableName + '/',
        count: 0,
        chunks: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const existingChunkFiles = await this.getChunkFiles();
      this.validateChunkFileSet(existingChunkFiles, currentMeta.chunks ?? 0);

      const chunkSize = configManager.getConfig().chunkSize || 1024 * 1024;
      const chunksToWrite = await this.preprocessData(data, chunkSize);
      const chunkIndex = currentMeta.chunks || 0;
      targetChunkIndices = chunksToWrite.map((_, index) => chunkIndex + index);
      await this.writeAppendJournal(currentMeta.count, chunkIndex, targetChunkIndices, data.length);
      appendJournalPublished = true;
      await this.writeChunks(chunksToWrite, chunkIndex);

      this.metadataManager.update(this.tableName, {
        mode: 'chunked',
        count: currentMeta.count + data.length,
        chunks: chunkIndex + chunksToWrite.length,
        updatedAt: Date.now(),
      });
      metadataUpdated = true;
      await this.persistMetadataIfSupported();
      await this.deleteAppendJournal();
    } catch (error) {
      let chunksCleaned = !appendJournalPublished;
      if (appendJournalPublished) {
        try {
          await this.deleteChunkFiles(targetChunkIndices);
          chunksCleaned = true;
        } catch (cleanupError) {
          logger.error(`failed to remove partial chunks for table ${this.tableName}`, cleanupError);
        }
      }
      let metadataRestored = !metadataUpdated;
      if (chunksCleaned && metadataUpdated) {
        try {
          await this.restoreAppendMetadata(previousMetadata);
          metadataRestored = true;
        } catch (restoreError) {
          logger.error(`failed to restore append metadata for table ${this.tableName}`, restoreError);
        }
      }
      if (appendJournalPublished && chunksCleaned && metadataRestored) {
        await this.deleteAppendJournal(true);
      }
      logger.error(`append data to table ${this.tableName} failed`, error);
      throw this.formatWriteError(`append data to table ${this.tableName} failed`, error);
    }
  }

  private async writeChunks(chunks: readonly StorageRecord[][], startIndex: number): Promise<void> {
    const parallelLimit = 4;
    for (let offset = 0; offset < chunks.length; offset += parallelLimit) {
      const batch = chunks.slice(offset, offset + parallelLimit);
      const results = await Promise.allSettled(
        batch.map((chunkData, batchIndex) => this.writeChunk(startIndex + offset + batchIndex, chunkData))
      );
      const failedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failedResult) {
        throw failedResult.reason;
      }
    }
  }

  private async preprocessData(data: StorageRecord[], chunkSize: number): Promise<StorageRecord[][]> {
    const chunks: StorageRecord[][] = [];
    let currentChunk: StorageRecord[] = [];
    let currentSize = 0;
    const encoder = new TextEncoder();
    const overhead = 200;
    const itemSizes: number[] = [];
    const validItems: StorageRecord[] = [];
    let totalSize = 0;

    for (let index = 0; index < data.length; index++) {
      const item = data[index];

      if (!this.validateDataItem(item)) {
        throw new StorageError(`Invalid chunk data item at index ${index}`, 'FILE_CONTENT_INVALID');
      }

      try {
        const serialized = JSON.stringify(item);
        if (serialized === undefined) {
          throw new Error('JSON serialization returned undefined');
        }

        const itemSize = encoder.encode(serialized).byteLength + overhead;
        itemSizes.push(itemSize);
        validItems.push(item);
        totalSize += itemSize;
      } catch (error) {
        throw new StorageError(`Chunk data item at index ${index} is not JSON serializable`, 'FILE_CONTENT_INVALID', {
          cause: error,
        });
      }
    }

    const averageItemSize = validItems.length > 0 ? totalSize / validItems.length : 0;
    const dynamicChunkSize = Math.min(chunkSize, Math.max(averageItemSize * 100, chunkSize * 0.8));

    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      const itemSize = itemSizes[i] || 0;

      if (item && itemSize > dynamicChunkSize) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentSize = 0;
        }
        chunks.push([item]);
        continue;
      }

      const fillRatio = (currentSize + itemSize) / dynamicChunkSize;
      if (fillRatio > 0.9 && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      if (currentSize + itemSize > dynamicChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      currentChunk.push(item);
      currentSize += itemSize;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private async writeChunk(index: number, data: StorageRecord[]): Promise<void> {
    const filePath = this.getChunkFilePath(index);
    try {
      this.validateArrayData(data);

      const hash = await this.computeHash(data);
      const content = JSON.stringify({ data, hash });

      let retries = 3;
      let lastError: unknown;

      while (retries > 0) {
        const tempFilePath = `${this.tableDirPath}${String(index).padStart(6, '0')}.tmp`;
        try {
          await withMutationTimeout(
            getFileSystem().writeAsStringAsync(tempFilePath, content, { encoding: getEncodingType().UTF8 }),
            10000,
            `write temp chunk ${index} failed`
          );

          await withMutationTimeout(
            getFileSystem().moveAsync({ from: tempFilePath, to: filePath }),
            10000,
            `rename temp chunk ${index} to ${filePath}`
          );
          this.markChunksMutated();

          this.clearFileInfoCache(filePath);
          const publishedInfo = await super.getFileInfo(filePath);
          if (!publishedInfo.exists) {
            throw new Error(`Published chunk ${index} is missing`);
          }
          await this.readChunkFile(filePath);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lastError = error;
          retries--;
          await this.cleanupTemporaryArtifact(tempFilePath, 'cleanup chunk staging file');

          if (message.includes('locked') || message.includes('busy')) {
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            throw error;
          }
        }
      }

      throw lastError ?? new Error(`Unable to write chunk ${index}`);
    } catch (error) {
      throw this.formatWriteError(`write chunk ${index} failed`, error);
    }
  }

  async preloadChunks(chunkIndices: number[]): Promise<void> {
    await this.runWithPathLock(this.tableDirPath, () => this.preloadChunksUnlocked(chunkIndices));
  }

  private async preloadChunksUnlocked(chunkIndices: number[]): Promise<void> {
    await this.recoverPendingAppendJournal();
    await this.recoverPendingOverwriteJournal();
    this.synchronizeChunkCache();
    const chunkFiles = await this.getChunkFiles();
    const filesToLoad = chunkIndices
      .map(index => {
        const targetFile = chunkFiles.find(filePath => {
          const fileName = filePath.split('/').pop() || '';
          const fileIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
          return fileIndex === index;
        });
        return targetFile;
      })
      .filter((filePath): filePath is string => {
        if (!filePath) return false;
        const fileName = filePath.split('/').pop() || '';
        const fileIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
        return !this.chunkCache.has(fileIndex);
      });

    const parallelLimit = 4;
    for (let i = 0; i < filesToLoad.length; i += parallelLimit) {
      const batch = filesToLoad.slice(i, i + parallelLimit);
      await Promise.all(
        batch.map(async filePath => {
          try {
            const fileName = filePath.split('/').pop() || '';
            const chunkIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
            const data = await this.readChunkFile(filePath);
            if (data.length > 0) {
              if (this.chunkCache.size >= this.maxCacheSize) {
                const firstKey = this.chunkCache.keys().next().value;
                if (firstKey !== undefined) {
                  this.chunkCache.delete(firstKey);
                }
              }
              this.chunkCache.set(chunkIndex, data);
            }
          } catch (e) {
            logger.warn(`Preload chunk ${filePath} failed`, e);
          }
        })
      );
    }
  }

  private async readChunkFile(filePath: string): Promise<StorageRecord[]> {
    try {
      const text = await withTimeout(
        getFileSystem().readAsStringAsync(filePath, { encoding: getEncodingType().UTF8 }),
        10000,
        `READ CHUNK ${filePath} CONTENT`
      );

      const parsed: unknown = JSON.parse(text);

      if (!isStorageRecord(parsed)) {
        throw new StorageError(`CHUNK ${filePath} FORMAT_ERROR: not valid JSON object`, 'CORRUPTED_DATA');
      }

      const { data, hash } = parsed;
      if (!Array.isArray(data) || !data.every(isStorageRecord) || typeof hash !== 'string') {
        throw new StorageError(`CHUNK ${filePath} FORMAT_ERROR: missing data array or hash field`, 'CORRUPTED_DATA');
      }

      const isValid = await this.verifyHash(data, hash);
      if (!isValid) {
        logger.warn(`CHUNK ${filePath} CORRUPTED: hash mismatch`);
        throw new StorageError(`CHUNK ${filePath} CORRUPTED: hash mismatch`, 'CORRUPTED_DATA');
      }

      return data;
    } catch (error) {
      logger.error(`ERROR reading chunk file ${filePath}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`CHUNK ${filePath} FORMAT_ERROR: invalid JSON`, 'CORRUPTED_DATA', {
          cause: error,
        });
      }
      throw this.formatReadError(`READ CHUNK ${filePath} FAILED`, error);
    }
  }

  clearChunkCache(): void {
    this.chunkCache.clear();
    this.observedChunkMutationEpoch = ChunkedFileHandler.chunkMutationEpochs.get(this.tableDirPath) ?? 0;
  }

  async readAll(): Promise<StorageRecord[]> {
    return this.runWithPathLock(this.tableDirPath, () => this.readAllUnlocked());
  }

  private async readAllUnlocked(): Promise<StorageRecord[]> {
    await this.recoverPendingAppendJournal();
    await this.recoverPendingOverwriteJournal();
    return this.readAllChunks();
  }

  private async readAllChunks(): Promise<StorageRecord[]> {
    this.synchronizeChunkCache();
    const chunkFiles = await this.getChunkFiles();
    this.validateChunkFileSet(chunkFiles);

    if (chunkFiles.length === 0) {
      return [];
    }

    const allChunkData = new Map<number, StorageRecord[]>();
    const filesToRead: string[] = [];
    const cachedIndices: number[] = [];

    for (const filePath of chunkFiles) {
      const fileName = filePath.split('/').pop() || '';
      const chunkIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
      if (this.chunkCache.has(chunkIndex)) {
        cachedIndices.push(chunkIndex);
      } else {
        filesToRead.push(filePath);
      }
    }

    cachedIndices.sort((a, b) => a - b);
    for (const index of cachedIndices) {
      const cached = this.chunkCache.get(index);
      if (cached) {
        allChunkData.set(index, cached);
      }
    }

    const parallelLimit = 6;

    for (let i = 0; i < filesToRead.length; i += parallelLimit) {
      const batchFiles = filesToRead.slice(i, i + parallelLimit);

      const batchPromises = batchFiles.map(async filePath => {
        const fileName = filePath.split('/').pop() || '';
        const chunkIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
        const data = await this.readChunkFile(filePath);

        if (data.length > 0 && this.chunkCache.size < this.maxCacheSize) {
          this.chunkCache.set(chunkIndex, data);
        }

        return { chunkIndex, data };
      });

      const batchResults = await Promise.all(batchPromises);
      for (const { chunkIndex, data } of batchResults) {
        allChunkData.set(chunkIndex, data);
      }
    }

    return [...allChunkData.entries()].sort(([left], [right]) => left - right).flatMap(([, data]) => data);
  }

  private validateChunkFileSet(
    chunkFiles: readonly string[],
    expectedChunks = this.metadataManager.get(this.tableName)?.chunks
  ): void {
    const chunkIndices = chunkFiles.map(filePath => {
      const fileName = filePath.split('/').pop() || '';
      return Number.parseInt(fileName.replace(CHUNK_EXT, ''), 10);
    });
    const hasContiguousIndices = chunkIndices.every(
      (chunkIndex, position) => Number.isSafeInteger(chunkIndex) && chunkIndex === position
    );
    const matchesMetadata = expectedChunks === undefined || expectedChunks === chunkFiles.length;
    if (hasContiguousIndices && matchesMetadata) {
      return;
    }

    throw new StorageError(
      `CHUNK SET ${this.tableName} INCOMPLETE: expected ${expectedChunks ?? 'contiguous'} chunks, found indices ${chunkIndices.join(',') || 'none'}`,
      'CORRUPTED_DATA',
      {
        suggestion: 'Restore the missing chunk files or metadata from a known-good backup before mutating the table',
      }
    );
  }

  private async validateChunkDirectory(
    directoryPath: string,
    expectedCount: number,
    expectedChunks: number,
    allowMissing: boolean
  ): Promise<string[]> {
    this.clearFileInfoCache(directoryPath);
    const directoryInfo = await super.getFileInfo(directoryPath);
    if (!directoryInfo.exists) {
      if (allowMissing && expectedCount === 0 && expectedChunks === 0) {
        return [];
      }
      throw new StorageError(`CHUNK DIRECTORY ${directoryPath} IS MISSING`, 'CORRUPTED_DATA');
    }
    if (directoryInfo.isDirectory === false) {
      throw new StorageError(`CHUNK DIRECTORY ${directoryPath} IS NOT A DIRECTORY`, 'CORRUPTED_DATA');
    }

    const chunkFiles = await this.getChunkFilesInDirectory(directoryPath, expectedChunks);
    this.validateChunkFileSet(chunkFiles, expectedChunks);
    let recordCount = 0;
    for (const filePath of chunkFiles) {
      const chunkData = await this.readChunkFile(filePath);
      recordCount += chunkData.length;
    }
    if (recordCount !== expectedCount) {
      throw new StorageError(
        `CHUNK DIRECTORY ${directoryPath} COUNT MISMATCH: expected ${expectedCount}, found ${recordCount}`,
        'CORRUPTED_DATA'
      );
    }
    return chunkFiles;
  }

  private async getChunkFiles(): Promise<string[]> {
    return this.getChunkFilesInDirectory(this.tableDirPath, this.metadataManager.get(this.tableName)?.chunks ?? 0);
  }

  private async getChunkFilesInDirectory(directoryPath: string, knownChunkCount: number): Promise<string[]> {
    let filePaths: string[] = [];

    try {
      const entries = await withTimeout(
        getFileSystem().readDirectoryAsync(directoryPath),
        10000,
        `LIST TABLE DIR ${directoryPath}`
      );

      filePaths = entries
        .filter((entry: string) => entry.endsWith(CHUNK_EXT))
        .sort()
        .map((entry: string) => `${directoryPath}${entry}`);
    } catch {
      const probeLimit = Math.max(20, knownChunkCount + 1);
      let probeError: unknown;
      for (let i = 0; i < probeLimit; i++) {
        const filePath = `${directoryPath}${String(i).padStart(6, '0')}${CHUNK_EXT}`;
        try {
          const fileInfo = await super.getFileInfo(filePath);
          if (fileInfo.exists) {
            filePaths.push(filePath);
          }
        } catch (error) {
          probeError ??= error;
        }
      }
      if (probeError) {
        throw this.formatReadError(`GET CHUNK FILES FROM ${directoryPath} FAILED`, probeError);
      }
    }

    return filePaths;
  }

  async readRange(startIndex: number, endIndex: number): Promise<StorageRecord[]> {
    return this.runWithPathLock(this.tableDirPath, () => this.readRangeUnlocked(startIndex, endIndex));
  }

  private async readRangeUnlocked(startIndex: number, endIndex: number): Promise<StorageRecord[]> {
    await this.recoverPendingAppendJournal();
    await this.recoverPendingOverwriteJournal();
    const allChunkFiles = await this.getChunkFiles();
    this.validateChunkFileSet(allChunkFiles);
    const rangeChunkFiles = allChunkFiles.filter(filePath => {
      const fileName = filePath.split('/').pop() || '';
      const fileIndex = parseInt(fileName.replace(CHUNK_EXT, ''), 10);
      return fileIndex >= startIndex && fileIndex <= endIndex;
    });

    const chunkDataPromises = rangeChunkFiles.map(filePath => this.readChunkFile(filePath));

    const chunkDataArray = await Promise.all(chunkDataPromises);
    return chunkDataArray.flat();
  }

  async clear(): Promise<void> {
    await this.runWithPathLock(this.tableDirPath, async () => {
      try {
        await this.writeUnlocked([]);
      } catch (error) {
        if (!(error instanceof StorageError) || error.code !== 'CORRUPTED_DATA') {
          throw this.formatDeleteError(`CLEAR CHUNKED TABLE ${this.tableName} FAILED`, error);
        }

        await this.clearUnlocked();
        await this.deleteAppendJournal();
        await this.deleteOverwriteJournal();
        await this.deleteOverwriteBackup();
      }
    });
  }

  private async resetTableDirectoryUnlocked(recreate: boolean): Promise<void> {
    await withMutationTimeout(
      getFileSystem().deleteAsync(this.tableDirPath, { idempotent: true }),
      10000,
      `delete chunked table directory ${this.tableDirPath}`
    );
    this.markChunksMutated();
    if (recreate) {
      await withMutationTimeout(
        getFileSystem().makeDirectoryAsync(this.tableDirPath, { intermediates: true }),
        10000,
        `create chunked table directory ${this.tableDirPath}`
      );
    }

    this.clearFileInfoCacheTree(this.tableDirPath);
  }

  private async clearUnlocked(): Promise<void> {
    try {
      await this.resetTableDirectoryUnlocked(true);

      this.metadataManager.update(this.tableName, {
        mode: 'chunked',
        path: `${this.tableName}/`,
        count: 0,
        chunks: 0,
      });
      await this.persistMetadataIfSupported();
    } catch (error) {
      logger.error('CLEAR CHUNKED TABLE FAILED', error);
      throw this.formatDeleteError('CLEAR CHUNKED TABLE FAILED', error);
    }
  }
}
