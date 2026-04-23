/**
 * @module PermissionChecker
 * @description Permission checker for file system access validation
 * @since 2025-11-28
 * @version 2.0.0
 */

import { StorageError } from '../../types/storageErrorInfc';
import { getEncodingType, getFileSystem } from '../../utils/fileSystemCompat';
import { ensureStorageRootReady } from '../../utils/ROOTPath';

const formatErrorDetail = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

/**
 * Permission checker for file system access validation.
 */
export class PermissionChecker {
  /**
   * Checks whether the storage root is writable.
   */
  async checkPermissions(): Promise<void> {
    let currentStep = 'bootstrap';
    let rootPath = '';
    let tempFilePath = '';

    try {
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        return;
      }

      const fileSystem = getFileSystem();
      currentStep = 'ensureStorageRootReady';
      rootPath = await ensureStorageRootReady();

      currentStep = 'getRootInfo';
      const rootInfo = await fileSystem.getInfoAsync(rootPath);
      if (!rootInfo.exists) {
        currentStep = 'makeRootDirectory';
        await fileSystem.makeDirectoryAsync(rootPath, { intermediates: true });
      }

      tempFilePath = `${rootPath}permission-check.tmp`;
      currentStep = 'writeTempFile';
      await fileSystem.writeAsStringAsync(tempFilePath, 'permission check', {
        encoding: getEncodingType().UTF8,
      });

      currentStep = 'deleteTempFile';
      await fileSystem.deleteAsync(tempFilePath, { idempotent: true });
    } catch (error) {
      throw new StorageError(`Permission denied when accessing file system`, 'PERMISSION_DENIED', {
        cause: error,
        details: `Failed during ${currentStep} for rootPath=${rootPath || 'unknown'} tempFilePath=${tempFilePath || 'n/a'}: ${formatErrorDetail(error)}`,
        suggestion: 'Check if your app has permission to access the file system',
      });
    }
  }
}
