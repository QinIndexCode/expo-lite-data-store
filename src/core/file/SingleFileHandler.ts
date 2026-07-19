import { StorageError } from '../../types/storageErrorInfc';
import { isStorageRecord, type StorageRecord } from '../../types/storageTypes';
import { bytesToHex } from '../../utils/byteEncoding';
import { randomBytes } from '../../utils/cryptoProvider';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import withTimeout, { withMutationTimeout } from '../../utils/withTimeout';
import { FileHandlerBase } from './FileHandlerBase';
import logger from '../../utils/logger';

export interface SingleFileCommitMetadata {
  storageCommitToken?: string;
  count: number;
}

type SingleFileCommitMetadataResolver = () =>
  | SingleFileCommitMetadata
  | undefined
  | Promise<SingleFileCommitMetadata | undefined>;

type SingleFileCommitPhase = 'prepared' | 'committed';

interface SingleFileCommitMarkerBase {
  phase: SingleFileCommitPhase;
  previousStorageCommitToken: string | null;
  targetStorageCommitToken: string;
  previousHash: string | null;
  previousPhysicalCount: number | null;
  targetHash: string;
  targetPhysicalCount: number;
  hadPreviousFile: boolean;
  createdAt: number;
}

interface SingleFileCommitMarkerV1 extends SingleFileCommitMarkerBase {
  version: 1;
}

interface SingleFileCommitMarkerV2 extends SingleFileCommitMarkerBase {
  version: 2;
  tableName: string;
}

type SingleFileCommitMarker = SingleFileCommitMarkerV1 | SingleFileCommitMarkerV2;

interface SingleFileCommitMarkerEvidence {
  marker: SingleFileCommitMarker;
  source: 'canonical' | 'temporary';
}

interface SingleFileEnvelope {
  data: StorageRecord[];
  hash: string;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isSingleFileCommitMarker = (value: unknown): value is SingleFileCommitMarker => {
  if (
    !isStorageRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    (value.phase !== 'prepared' && value.phase !== 'committed') ||
    (value.previousStorageCommitToken !== null && !isNonEmptyString(value.previousStorageCommitToken)) ||
    !isNonEmptyString(value.targetStorageCommitToken) ||
    value.targetStorageCommitToken === value.previousStorageCommitToken ||
    !isNonEmptyString(value.targetHash) ||
    !isNonNegativeSafeInteger(value.targetPhysicalCount) ||
    typeof value.hadPreviousFile !== 'boolean' ||
    !isNonNegativeSafeInteger(value.createdAt)
  ) {
    return false;
  }

  const previousGenerationIsValid =
    (value.hadPreviousFile === true &&
      isNonEmptyString(value.previousHash) &&
      isNonNegativeSafeInteger(value.previousPhysicalCount)) ||
    (value.hadPreviousFile === false && value.previousHash === null && value.previousPhysicalCount === null);

  return previousGenerationIsValid && (value.version === 1 || isNonEmptyString(value.tableName));
};

export const createStorageCommitToken = (): string => bytesToHex(randomBytes(16));

/**
 * Single file handler for smaller tables.
 */
export class SingleFileHandler extends FileHandlerBase {
  private recoverableWriteInFlight: Promise<void> | undefined;
  private pendingWriteHadPreviousFile: boolean | undefined;
  private pendingWriteLockRelease: (() => void) | undefined;

  constructor(
    private filePath: string,
    private readonly resolveCommitMetadata?: SingleFileCommitMetadataResolver
  ) {
    super();
  }

  private getBackupFilePath(): string {
    return `${this.filePath}.bak`;
  }

  private getBackupTempFilePath(): string {
    return `${this.getBackupFilePath()}.tmp`;
  }

  private getCommitMarkerFilePath(): string {
    return `${this.filePath}.commit-marker`;
  }

  private getCommitMarkerTempFilePath(): string {
    return `${this.getCommitMarkerFilePath()}.tmp`;
  }

  private getTableName(): string {
    const separatorIndex = Math.max(this.filePath.lastIndexOf('/'), this.filePath.lastIndexOf('\\'));
    const fileName = this.filePath.slice(separatorIndex + 1);
    return fileName.endsWith('.ldb') ? fileName.slice(0, -4) : fileName;
  }

  private finishPendingWrite(): void {
    this.pendingWriteHadPreviousFile = undefined;
    const release = this.pendingWriteLockRelease;
    this.pendingWriteLockRelease = undefined;
    release?.();
  }

  private async waitForRecoverableWrite(): Promise<void> {
    const inFlight = this.recoverableWriteInFlight;
    if (!inFlight) {
      return;
    }

    try {
      await inFlight;
    } catch {
      // The initiating caller receives the write error; followers can inspect
      // the last durable generation after the write releases its lock.
    }
  }

  private createRecoveryError(message: string, cause?: unknown): StorageError {
    return new StorageError(`SINGLE_FILE_RECOVERY_ERROR: ${this.filePath}`, 'CORRUPTED_DATA', {
      cause,
      details: message,
      suggestion: 'Preserve the recovery artifacts and restore the table from a known-good generation',
    });
  }

  private async getResolvedCommitMetadata(): Promise<SingleFileCommitMetadata | undefined> {
    const metadata = await this.resolveCommitMetadata?.();
    if (
      metadata !== undefined &&
      (!isNonNegativeSafeInteger(metadata.count) ||
        (metadata.storageCommitToken !== undefined && !isNonEmptyString(metadata.storageCommitToken)))
    ) {
      throw this.createRecoveryError('Resolved single-file commit metadata is invalid');
    }
    return metadata;
  }

  private async readEnvelopeFromPath(path: string): Promise<SingleFileEnvelope> {
    const text = await withTimeout(
      getFileSystem().readAsStringAsync(path, { encoding: getEncodingType().UTF8 }),
      10000,
      `read ${path} content`
    );
    const parsed: unknown = JSON.parse(text) as unknown;

    if (!isStorageRecord(parsed)) {
      throw new StorageError('FILE_CONTENT_INVALID: corrupted data', 'CORRUPTED_DATA', {
        details: 'File content is not a valid JSON object',
        suggestion: 'The file may be corrupted, try recreating it',
      });
    }

    const { data, hash } = parsed;
    if (!Array.isArray(data) || !data.every(isStorageRecord) || typeof hash !== 'string') {
      throw new StorageError('FILE_FORMAT_ERROR: missing valid data array or hash field', 'CORRUPTED_DATA', {
        details: 'File missing data array or hash field',
        suggestion: 'The file format is invalid, try recreating it',
      });
    }

    if (!(await this.verifyHash(data, hash))) {
      throw new StorageError('FILE_INTEGRITY_ERROR: data may have been tampered with or corrupted', 'CORRUPTED_DATA', {
        details: 'Hash mismatch, data may have been tampered with',
        suggestion: 'The file may be corrupted or tampered with, try recreating it',
      });
    }

    return { data, hash };
  }

  private async readRecordsFromPath(path: string): Promise<StorageRecord[]> {
    return (await this.readEnvelopeFromPath(path)).data;
  }

  private async readCommitMarkerFromPath(markerPath: string): Promise<SingleFileCommitMarker> {
    try {
      const serialized = await withTimeout(
        getFileSystem().readAsStringAsync(markerPath, { encoding: getEncodingType().UTF8 }),
        10000,
        `read commit marker ${markerPath}`
      );
      const envelope: unknown = JSON.parse(serialized) as unknown;
      if (
        !isStorageRecord(envelope) ||
        !isSingleFileCommitMarker(envelope.marker) ||
        !isNonEmptyString(envelope.hash) ||
        !(await this.verifyHash(envelope.marker, envelope.hash))
      ) {
        throw new Error('Commit marker has an invalid structure or integrity hash');
      }
      if (envelope.marker.version === 2 && envelope.marker.tableName !== this.getTableName()) {
        throw new Error('Commit marker belongs to a different table');
      }
      return envelope.marker;
    } catch (error) {
      throw this.createRecoveryError(`Commit marker is corrupted or unreadable: ${markerPath}`, error);
    }
  }

  private async readCommitMarker(): Promise<SingleFileCommitMarkerEvidence | undefined> {
    const markerPath = this.getCommitMarkerFilePath();
    const markerTempPath = this.getCommitMarkerTempFilePath();
    this.clearFileInfoCache(markerPath);
    this.clearFileInfoCache(markerTempPath);

    if ((await super.getFileInfo(markerPath)).exists) {
      return { marker: await this.readCommitMarkerFromPath(markerPath), source: 'canonical' };
    }
    if ((await super.getFileInfo(markerTempPath)).exists) {
      return { marker: await this.readCommitMarkerFromPath(markerTempPath), source: 'temporary' };
    }
    return undefined;
  }

  private async publishCommitMarker(marker: SingleFileCommitMarker): Promise<void> {
    const markerPath = this.getCommitMarkerFilePath();
    const markerTempPath = this.getCommitMarkerTempFilePath();
    const fileSystem = getFileSystem();
    const hash = await this.computeHash(marker);
    const serialized = JSON.stringify({ marker, hash });

    await withMutationTimeout(
      fileSystem.writeAsStringAsync(markerTempPath, serialized, { encoding: getEncodingType().UTF8 }),
      10000,
      `write commit marker temp file ${markerTempPath}`
    );
    this.clearFileInfoCache(markerTempPath);
    await withMutationTimeout(
      fileSystem.deleteAsync(markerPath, { idempotent: true }),
      10000,
      `replace commit marker ${markerPath}`
    );
    this.clearFileInfoCache(markerPath);
    try {
      await withMutationTimeout(
        fileSystem.moveAsync({ from: markerTempPath, to: markerPath }),
        10000,
        `publish commit marker ${markerPath}`
      );
    } finally {
      this.clearFileInfoCache(markerPath);
      this.clearFileInfoCache(markerTempPath);
    }
  }

  private async deleteRecoveryArtifact(path: string): Promise<void> {
    await withMutationTimeout(
      getFileSystem().deleteAsync(path, { idempotent: true }),
      10000,
      `delete recovery artifact ${path}`
    );
    this.clearFileInfoCache(path);
  }

  private async cleanupRecoveryArtifacts(state: 'committed' | 'rolled-back'): Promise<void> {
    const paths =
      state === 'committed'
        ? [
            this.getBackupFilePath(),
            this.getBackupTempFilePath(),
            `${this.filePath}.tmp`,
            this.getCommitMarkerTempFilePath(),
            this.getCommitMarkerFilePath(),
          ]
        : [
            this.getCommitMarkerFilePath(),
            this.getCommitMarkerTempFilePath(),
            this.getBackupFilePath(),
            this.getBackupTempFilePath(),
            `${this.filePath}.tmp`,
          ];

    try {
      for (const path of paths) {
        await this.deleteRecoveryArtifact(path);
      }
    } catch (error) {
      logger.warn(`DELETE ${state.toUpperCase()} SINGLE-FILE ARTIFACT ERROR: ${this.filePath}:`, error);
    }
  }

  private async validateTargetGeneration(marker: SingleFileCommitMarker): Promise<StorageRecord[]> {
    this.clearFileInfoCache(this.filePath);
    const primaryInfo = await super.getFileInfo(this.filePath);
    if (!primaryInfo.exists) {
      throw this.createRecoveryError('Committed metadata points to a missing primary generation');
    }

    let envelope: SingleFileEnvelope;
    try {
      envelope = await this.readEnvelopeFromPath(this.filePath);
    } catch (error) {
      throw this.createRecoveryError('The target primary generation is corrupted or unreadable', error);
    }

    if (envelope.hash !== marker.targetHash || envelope.data.length !== marker.targetPhysicalCount) {
      throw this.createRecoveryError('Target physical count and primary hash do not describe one generation');
    }

    return envelope.data;
  }

  private async rollbackMarkerGeneration(
    marker: SingleFileCommitMarker,
    metadata: SingleFileCommitMetadata | undefined
  ): Promise<void> {
    if (marker.hadPreviousFile) {
      let backupEnvelope: SingleFileEnvelope;
      try {
        backupEnvelope = await this.readEnvelopeFromPath(this.getBackupFilePath());
      } catch (error) {
        throw this.createRecoveryError('The previous generation backup is missing or corrupted', error);
      }
      if (backupEnvelope.hash !== marker.previousHash || backupEnvelope.data.length !== marker.previousPhysicalCount) {
        throw this.createRecoveryError('The retained backup does not match the marker previous generation');
      }

      const recovered = await this.restoreBackup(true);
      if (!recovered) {
        throw this.createRecoveryError('The previous generation backup disappeared during recovery');
      }
    } else {
      if (metadata !== undefined && metadata.count !== 0) {
        throw this.createRecoveryError('Previous metadata exists, but no previous data generation was retained');
      }
      await this.deleteRecoveryArtifact(this.filePath);
    }

    await this.cleanupRecoveryArtifacts('rolled-back');
  }

  private async recoverInterruptedCommit(): Promise<void> {
    const evidence = await this.readCommitMarker();
    if (!evidence) {
      return;
    }
    const { marker } = evidence;

    if (evidence.source === 'temporary') {
      if (
        marker.version !== 2 ||
        marker.tableName !== this.getTableName() ||
        marker.phase !== 'committed' ||
        !this.resolveCommitMetadata
      ) {
        throw this.createRecoveryError('Temporary commit marker is not authoritative committed evidence');
      }

      let metadata: SingleFileCommitMetadata | undefined;
      try {
        metadata = await this.getResolvedCommitMetadata();
      } catch (error) {
        throw this.createRecoveryError('Unable to resolve metadata for a temporary commit marker', error);
      }
      if (!metadata || metadata.storageCommitToken !== marker.targetStorageCommitToken) {
        throw this.createRecoveryError('Temporary commit marker does not match the durable metadata generation');
      }

      await this.validateTargetGeneration(marker);
      await this.cleanupRecoveryArtifacts('committed');
      return;
    }

    if (!this.resolveCommitMetadata) {
      if (marker.phase === 'committed') {
        await this.validateTargetGeneration(marker);
        await this.cleanupRecoveryArtifacts('committed');
      } else {
        await this.rollbackMarkerGeneration(marker, undefined);
      }
      return;
    }

    let metadata: SingleFileCommitMetadata | undefined;
    try {
      metadata = await this.getResolvedCommitMetadata();
    } catch (error) {
      throw this.createRecoveryError('Unable to resolve metadata for an interrupted single-file commit', error);
    }

    const currentToken = metadata?.storageCommitToken ?? null;
    if (currentToken === marker.targetStorageCommitToken) {
      if (!metadata) {
        throw this.createRecoveryError('Target token resolved without table metadata');
      }
      await this.validateTargetGeneration(marker);
      await this.cleanupRecoveryArtifacts('committed');
      return;
    }

    if (currentToken === marker.previousStorageCommitToken) {
      await this.rollbackMarkerGeneration(marker, metadata);
      return;
    }

    throw this.createRecoveryError('Metadata token matches neither the previous nor target data generation');
  }

  private async restoreBackup(preserveBackup = false): Promise<StorageRecord[] | undefined> {
    const backupFilePath = this.getBackupFilePath();
    const backupInfo = await super.getFileInfo(backupFilePath);
    if (!backupInfo.exists) {
      return undefined;
    }

    const fileSystem = getFileSystem();
    const backupContent = await withTimeout(
      fileSystem.readAsStringAsync(backupFilePath, { encoding: getEncodingType().UTF8 }),
      10000,
      `read recovery backup ${backupFilePath}`
    );
    const records = await this.readRecordsFromPath(backupFilePath);

    await withMutationTimeout(
      fileSystem.writeAsStringAsync(this.filePath, backupContent, { encoding: getEncodingType().UTF8 }),
      10000,
      `restore recovery backup ${backupFilePath}`
    );
    if (!preserveBackup) {
      try {
        await fileSystem.deleteAsync(backupFilePath, { idempotent: true });
      } catch (error) {
        logger.warn(`DELETE RECOVERY BACKUP ERROR: ${backupFilePath}:`, error);
      }
    }
    this.clearFileInfoCache(this.filePath);
    this.clearFileInfoCache(backupFilePath);
    return records;
  }

  private async discardStaleBackup(): Promise<void> {
    const backupFilePath = this.getBackupFilePath();
    try {
      await getFileSystem().deleteAsync(backupFilePath, { idempotent: true });
      this.clearFileInfoCache(backupFilePath);
    } catch (error) {
      logger.warn(`DELETE STALE BACKUP ERROR: ${backupFilePath}:`, error);
    }
  }

  async write(data: StorageRecord[]): Promise<void> {
    await this.writeRecoverably(data);
    await this.commitPendingWrite();
  }

  /**
   * Publishes data while retaining the previous generation until its caller
   * commits the related metadata update.
   */
  async writeRecoverably(data: StorageRecord[], targetStorageCommitToken = createStorageCommitToken()): Promise<void> {
    if (this.recoverableWriteInFlight || this.pendingWriteLockRelease) {
      throw this.formatWriteError(
        `FILE_WRITE_ERROR: ${this.filePath}:`,
        new Error(`A recoverable write is already pending for ${this.filePath}`)
      );
    }

    const write = this.performRecoverableWrite(data, targetStorageCommitToken);
    this.recoverableWriteInFlight = write;
    try {
      await write;
    } finally {
      if (this.recoverableWriteInFlight === write) {
        this.recoverableWriteInFlight = undefined;
      }
    }
  }

  private async performRecoverableWrite(data: StorageRecord[], targetStorageCommitToken: string): Promise<void> {
    let releaseFileLock: (() => void) | undefined;
    try {
      this.validateArrayData(data);
      if (!isNonEmptyString(targetStorageCommitToken)) {
        throw new Error('A non-empty storage commit token is required');
      }
      releaseFileLock = await this.acquirePathLock(this.filePath);
      this.pendingWriteHadPreviousFile = undefined;
      await this.recoverInterruptedCommit();

      const previousMetadata = await this.getResolvedCommitMetadata();

      const initialInfo = await super.getFileInfo(this.filePath);
      if (!initialInfo.exists) {
        await this.restoreBackup();
      } else {
        try {
          await this.readRecordsFromPath(this.filePath);
        } catch (primaryError) {
          const recovered = await this.restoreBackup();
          if (!recovered) {
            throw primaryError;
          }
        }
      }

      const hash = await this.computeHash(data);
      const content = JSON.stringify({ data, hash });

      let retries = 3;
      let lastError: unknown;

      while (retries > 0) {
        let attemptHadPreviousFile: boolean | undefined;
        let attemptMarker: SingleFileCommitMarker | undefined;
        try {
          const tempFilePath = `${this.filePath}.tmp`;
          const backupFilePath = this.getBackupFilePath();
          const backupTempFilePath = this.getBackupTempFilePath();
          const fileSystem = getFileSystem();

          await withMutationTimeout(
            fileSystem.writeAsStringAsync(tempFilePath, content, { encoding: getEncodingType().UTF8 }),
            10000,
            `write temp file ${tempFilePath}`
          );

          const previousInfo = await super.getFileInfo(this.filePath);
          attemptHadPreviousFile = previousInfo.exists;
          let previousEnvelope: SingleFileEnvelope | undefined;
          if (previousInfo.exists) {
            previousEnvelope = await this.readEnvelopeFromPath(this.filePath);
            const previousContent = await withTimeout(
              fileSystem.readAsStringAsync(this.filePath, { encoding: getEncodingType().UTF8 }),
              10000,
              `read current file ${this.filePath} before replacement`
            );
            await withMutationTimeout(
              fileSystem.writeAsStringAsync(backupTempFilePath, previousContent, { encoding: getEncodingType().UTF8 }),
              10000,
              `write backup file ${backupTempFilePath}`
            );
            await withMutationTimeout(
              fileSystem.deleteAsync(backupFilePath, { idempotent: true }),
              10000,
              `replace stale backup file ${backupFilePath}`
            );
            await withMutationTimeout(
              fileSystem.moveAsync({ from: backupTempFilePath, to: backupFilePath }),
              10000,
              `publish backup file ${backupFilePath}`
            );
            this.clearFileInfoCache(backupFilePath);
          }

          attemptMarker = {
            version: 2,
            tableName: this.getTableName(),
            phase: 'prepared',
            previousStorageCommitToken: previousMetadata?.storageCommitToken ?? null,
            targetStorageCommitToken,
            previousHash: previousEnvelope?.hash ?? null,
            previousPhysicalCount: previousEnvelope?.data.length ?? null,
            targetHash: hash,
            targetPhysicalCount: data.length,
            hadPreviousFile: previousInfo.exists,
            createdAt: Date.now(),
          };
          await this.publishCommitMarker(attemptMarker);

          if (previousInfo.exists) {
            await withMutationTimeout(
              fileSystem.deleteAsync(this.filePath, { idempotent: true }),
              10000,
              `replace current file ${this.filePath}`
            );
            this.clearFileInfoCache(this.filePath);
          }

          await withMutationTimeout(
            fileSystem.moveAsync({ from: tempFilePath, to: this.filePath }),
            10000,
            `rename temp file to ${this.filePath}`
          );

          this.clearFileInfoCache(this.filePath);
          this.pendingWriteHadPreviousFile = previousInfo.exists;
          this.pendingWriteLockRelease = releaseFileLock;
          releaseFileLock = undefined;
          return;
        } catch (error) {
          lastError = error;
          retries--;

          await Promise.allSettled([
            getFileSystem().deleteAsync(`${this.filePath}.tmp`, { idempotent: true }),
            getFileSystem().deleteAsync(this.getBackupTempFilePath(), { idempotent: true }),
          ]);
          this.clearFileInfoCache(this.filePath);
          this.clearFileInfoCache(this.getBackupFilePath());

          if (attemptMarker) {
            await this.rollbackMarkerGeneration(attemptMarker, previousMetadata);
          } else if (attemptHadPreviousFile === false) {
            await this.deleteRecoveryArtifact(this.filePath);
          }

          const message = error instanceof Error ? error.message : '';
          if (message.includes('locked') || message.includes('busy')) {
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            throw error;
          }
        }
      }

      throw lastError ?? new Error(`Unable to write ${this.filePath}`);
    } catch (error) {
      throw this.formatWriteError(`FILE_WRITE_ERROR: ${this.filePath}:`, error);
    } finally {
      releaseFileLock?.();
    }
  }

  /** Finalizes a recoverable write after its metadata is durable. */
  async commitPendingWrite(): Promise<void> {
    await this.waitForRecoverableWrite();
    if (this.pendingWriteHadPreviousFile === undefined) {
      return;
    }

    try {
      const evidence = await this.readCommitMarker();
      if (!evidence) {
        await this.discardStaleBackup();
        return;
      }
      if (evidence.source !== 'canonical') {
        throw this.createRecoveryError('Pending write has no canonical prepared commit marker');
      }
      const { marker } = evidence;

      try {
        await this.publishCommitMarker({ ...marker, phase: 'committed' });
      } catch (error) {
        const metadata = await this.getResolvedCommitMetadata();
        if (metadata?.storageCommitToken === marker.targetStorageCommitToken) {
          logger.warn(`PUBLISH COMMITTED SINGLE-FILE MARKER ERROR: ${this.filePath}:`, error);
          return;
        }

        await this.rollbackMarkerGeneration(marker, undefined);
        throw error;
      }

      await this.cleanupRecoveryArtifacts('committed');
    } finally {
      this.finishPendingWrite();
    }
  }

  /** Restores the generation retained by writeRecoverably. */
  async rollbackPendingWrite(beforeRollback?: () => Promise<void>): Promise<void> {
    await this.waitForRecoverableWrite();
    const hadPreviousFile = this.pendingWriteHadPreviousFile;
    if (hadPreviousFile === undefined) {
      return;
    }

    try {
      await beforeRollback?.();
    } catch (error) {
      this.finishPendingWrite();
      throw error;
    }

    try {
      const evidence = await this.readCommitMarker();
      if (evidence?.source === 'canonical') {
        await this.rollbackMarkerGeneration(evidence.marker, undefined);
      } else if (evidence) {
        throw this.createRecoveryError('Cannot roll back from a temporary commit marker without canonical evidence');
      } else if (hadPreviousFile) {
        const recovered = await this.restoreBackup();
        if (!recovered) {
          throw new Error(`Recovery backup is missing for ${this.filePath}`);
        }
      } else {
        await this.deleteRecoveryArtifact(this.filePath);
      }
    } catch (error) {
      throw this.formatWriteError(`FILE_ROLLBACK_ERROR: ${this.filePath}:`, error);
    } finally {
      this.finishPendingWrite();
    }
  }

  async read(): Promise<StorageRecord[]> {
    try {
      await this.waitForRecoverableWrite();
      const readFile = async (): Promise<StorageRecord[]> => {
        const preservePendingBackup = this.pendingWriteLockRelease !== undefined;
        let preserveRecoveryArtifacts = preservePendingBackup;
        if (!preservePendingBackup) {
          await this.recoverInterruptedCommit();
          this.clearFileInfoCache(this.getCommitMarkerFilePath());
          this.clearFileInfoCache(this.getCommitMarkerTempFilePath());
          const [markerInfo, markerTempInfo] = await Promise.all([
            super.getFileInfo(this.getCommitMarkerFilePath()),
            super.getFileInfo(this.getCommitMarkerTempFilePath()),
          ]);
          preserveRecoveryArtifacts = markerInfo.exists || markerTempInfo.exists;
        }
        const info = await super.getFileInfo(this.filePath);
        if (!info.exists) {
          if (preserveRecoveryArtifacts) {
            throw new StorageError(`FILE_MISSING_DURING_PENDING_WRITE: ${this.filePath}`, 'CORRUPTED_DATA', {
              details: 'The published generation disappeared before its metadata was committed',
              suggestion: 'Roll back the pending write and retry the operation',
            });
          }
          const recovered = await this.restoreBackup();
          if (recovered) {
            return recovered;
          }
          const metadata = await this.getResolvedCommitMetadata();
          if (metadata && metadata.count > 0) {
            throw this.createRecoveryError('Table metadata references records, but no data generation is recoverable');
          }
          return [];
        }

        try {
          const records = await this.readRecordsFromPath(this.filePath);
          if (!preserveRecoveryArtifacts) {
            await this.discardStaleBackup();
          }
          return records;
        } catch (primaryError) {
          if (preserveRecoveryArtifacts) {
            throw primaryError;
          }
          const recovered = await this.restoreBackup();
          if (recovered) {
            return recovered;
          }
          throw primaryError;
        }
      };

      return this.pendingWriteLockRelease ? await readFile() : await this.runWithPathLock(this.filePath, readFile);
    } catch (error) {
      logger.warn(`READ_FILE_ERROR: ${this.filePath}:`, error);
      if (error instanceof StorageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new StorageError(`FILE_CONTENT_INVALID: ${this.filePath}`, 'CORRUPTED_DATA', {
          cause: error,
          details: 'File content is not valid JSON',
          suggestion: 'Restore the file from a known-good backup or recreate the table',
        });
      }
      throw this.formatReadError(`READ_FILE_ERROR: ${this.filePath}`, error);
    }
  }

  async delete(): Promise<void> {
    try {
      await this.waitForRecoverableWrite();
      const deleteFiles = async (): Promise<void> => {
        const fileSystem = getFileSystem();
        await Promise.all([
          fileSystem.deleteAsync(this.filePath, { idempotent: true }),
          fileSystem.deleteAsync(`${this.filePath}.tmp`, { idempotent: true }),
          fileSystem.deleteAsync(this.getBackupFilePath(), { idempotent: true }),
          fileSystem.deleteAsync(this.getBackupTempFilePath(), { idempotent: true }),
          fileSystem.deleteAsync(this.getCommitMarkerFilePath(), { idempotent: true }),
          fileSystem.deleteAsync(this.getCommitMarkerTempFilePath(), { idempotent: true }),
        ]);
        this.clearFileInfoCache(this.filePath);
        this.clearFileInfoCache(this.getBackupFilePath());
        this.clearFileInfoCache(this.getCommitMarkerFilePath());
        this.clearFileInfoCache(this.getCommitMarkerTempFilePath());
      };

      if (this.pendingWriteLockRelease) {
        try {
          await deleteFiles();
        } finally {
          this.finishPendingWrite();
        }
      } else {
        await this.runWithPathLock(this.filePath, deleteFiles);
      }
    } catch (error) {
      throw this.formatDeleteError(`DELETE_FILE_ERROR: ${this.filePath}:`, error);
    }
  }
}
