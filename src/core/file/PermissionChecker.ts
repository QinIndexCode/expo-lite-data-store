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
  private static readonly checksInFlight = new Map<string, Promise<void>>();

  private async probeRoot(rootPath: string): Promise<void> {
    let currentStep = 'getRootInfo';
    const tempFilePath = `${rootPath}permission-check.tmp`;

    try {
      const fileSystem = getFileSystem();
      const rootInfo = await fileSystem.getInfoAsync(rootPath);
      if (!rootInfo.exists) {
        currentStep = 'makeRootDirectory';
        await fileSystem.makeDirectoryAsync(rootPath, { intermediates: true });
      }

      currentStep = 'writeTempFile';
      await fileSystem.writeAsStringAsync(tempFilePath, 'permission check', {
        encoding: getEncodingType().UTF8,
      });

      currentStep = 'deleteTempFile';
      await fileSystem.deleteAsync(tempFilePath, { idempotent: true });
    } catch (error) {
      throw new StorageError(`Permission denied when accessing file system`, 'PERMISSION_DENIED', {
        cause: error,
        details: `Failed during ${currentStep} for rootPath=${rootPath} tempFilePath=${tempFilePath}: ${formatErrorDetail(error)}`,
        suggestion: 'Check if your app has permission to access the file system',
      });
    }
  }

  /**
   * Checks whether the storage root is writable.
   */
  async checkPermissions(): Promise<void> {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
      return;
    }

    let rootPath: string;
    try {
      rootPath = await ensureStorageRootReady();
    } catch (error) {
      throw new StorageError(`Permission denied when accessing file system`, 'PERMISSION_DENIED', {
        cause: error,
        details: `Failed during ensureStorageRootReady for rootPath=unknown tempFilePath=n/a: ${formatErrorDetail(error)}`,
        suggestion: 'Check if your app has permission to access the file system',
      });
    }

    const activeCheck = PermissionChecker.checksInFlight.get(rootPath);
    if (activeCheck) {
      return activeCheck;
    }

    const check = this.probeRoot(rootPath);
    PermissionChecker.checksInFlight.set(rootPath, check);

    try {
      await check;
    } finally {
      if (PermissionChecker.checksInFlight.get(rootPath) === check) {
        PermissionChecker.checksInFlight.delete(rootPath);
      }
    }
  }
}
