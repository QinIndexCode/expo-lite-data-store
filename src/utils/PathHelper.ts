import logger from './logger';
import { getDocumentDirectory, getFileSystem } from './fileSystemCompat';
import { isStorageRecord } from '../types/storageTypes';

const DEFAULT_STORAGE_FOLDER = 'lite-data-store';
const LEGACY_STORAGE_FOLDER = 'expo-lite-data';

/**
 * A storage root is intentionally a single directory name. Allowing path
 * separators here would let configuration escape Expo's document directory.
 */
export const isValidStorageFolderName = (folder: unknown): folder is string => {
  if (typeof folder !== 'string' || folder.trim().length === 0 || folder === '.' || folder === '..') {
    return false;
  }

  // Storage paths are file URIs on native runtimes. Reject URI escapes too,
  // because an encoded dot segment can otherwise normalize outside the root.
  return !/[\\/\u0000%]/u.test(folder);
};

export function assertValidStorageFolderName(folder: unknown): asserts folder is string {
  if (!isValidStorageFolderName(folder)) {
    throw new Error('Invalid storageFolder: use one non-empty directory name without path separators or traversal');
  }
}

export class PathHelper {
  private static instance: PathHelper | null = null;
  private rootPath: string | null = null;
  private storageFolder: string = DEFAULT_STORAGE_FOLDER;
  private initializationPromise: Promise<string> | null = null;

  private constructor() {}

  static getInstance(): PathHelper {
    if (!PathHelper.instance) {
      PathHelper.instance = new PathHelper();
    }
    return PathHelper.instance;
  }

  setStorageFolder(folder: string): void {
    assertValidStorageFolderName(folder);

    if (this.storageFolder !== folder) {
      this.storageFolder = folder;
      this.rootPath = null;
      this.initializationPromise = null;
    }
  }

  getStorageFolder(): string {
    return this.storageFolder;
  }

  async getRootPath(): Promise<string> {
    return this.ensureStorageReady();
  }

  getRootPathSync(): string {
    if (!this.rootPath) {
      this.rootPath = this.buildPath(this.storageFolder);
    }
    return this.rootPath;
  }

  /**
   * Ensure the root directory exists and migrate the legacy default folder if needed.
   */
  async ensureStorageReady(): Promise<string> {
    if (this.rootPath && !this.initializationPromise) {
      return this.rootPath;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeRootDirectory()
        .then(rootPath => {
          this.rootPath = rootPath;
          return rootPath;
        })
        .finally(() => {
          this.initializationPromise = null;
        });
    }

    return this.initializationPromise;
  }

  private async initializeRootDirectory(): Promise<string> {
    const fileSystem = getFileSystem();
    const rootPath = this.buildPath(this.storageFolder);

    if (this.storageFolder === DEFAULT_STORAGE_FOLDER) {
      const legacyPath = this.buildPath(LEGACY_STORAGE_FOLDER);
      const [rootInfo, legacyInfo] = await Promise.all([
        fileSystem.getInfoAsync(rootPath),
        fileSystem.getInfoAsync(legacyPath),
      ]);
      const rootIsEffectivelyEmpty = rootInfo.exists && (await this.isRootEffectivelyEmpty(rootPath));

      if (legacyInfo.exists && (!rootInfo.exists || rootIsEffectivelyEmpty)) {
        try {
          if (rootIsEffectivelyEmpty) {
            await fileSystem.deleteAsync(rootPath, { idempotent: true });
          }
          await this.migrateLegacyStorage(legacyPath, rootPath);
        } catch (error) {
          logger.warn(`[PathHelper] Failed to migrate legacy storage folder from ${legacyPath} to ${rootPath}`, error);
        }
      }
    }

    let createError: unknown;
    try {
      await fileSystem.makeDirectoryAsync(rootPath, { intermediates: true });
    } catch (error) {
      createError = error;
    }

    const rootInfo = await fileSystem.getInfoAsync(rootPath);
    if (!rootInfo.exists) {
      logger.warn(`[PathHelper] Storage root was not created at ${rootPath}`, createError);
      throw createError instanceof Error ? createError : new Error(`Failed to create storage root: ${rootPath}`);
    }

    return rootPath;
  }

  private async isRootEffectivelyEmpty(rootPath: string): Promise<boolean> {
    const fileSystem = getFileSystem();

    let entries: string[] = [];
    try {
      entries = await fileSystem.readDirectoryAsync(rootPath);
    } catch {
      return false;
    }

    const nonMetaEntries = entries.filter(entry => entry !== 'meta.ldb');
    if (nonMetaEntries.length > 0) {
      return false;
    }

    if (!entries.includes('meta.ldb')) {
      return true;
    }

    try {
      const metaRaw = await fileSystem.readAsStringAsync(`${rootPath}meta.ldb`);
      const parsed: unknown = JSON.parse(metaRaw) as unknown;
      if (
        !isStorageRecord(parsed) ||
        typeof parsed.version !== 'string' ||
        typeof parsed.generatedAt !== 'number' ||
        !Number.isSafeInteger(parsed.generatedAt) ||
        parsed.generatedAt < 0 ||
        !isStorageRecord(parsed.tables)
      ) {
        return false;
      }
      return Object.keys(parsed.tables).length === 0;
    } catch {
      return false;
    }
  }

  private async migrateLegacyStorage(legacyPath: string, rootPath: string): Promise<void> {
    const fileSystem = getFileSystem();

    try {
      await fileSystem.moveAsync({ from: legacyPath, to: rootPath });
    } catch (error) {
      logger.warn(`[PathHelper] Direct legacy directory move failed, falling back to recursive migration`, error);
    }

    let remainingEntries: string[] = [];
    try {
      remainingEntries = await fileSystem.readDirectoryAsync(legacyPath);
    } catch {
      remainingEntries = [];
    }

    if (remainingEntries.length === 0) {
      return;
    }

    await fileSystem.makeDirectoryAsync(rootPath, { intermediates: true });

    for (const entry of remainingEntries) {
      await this.moveLegacyEntry(`${legacyPath}${entry}`, `${rootPath}${entry}`);
    }

    await fileSystem.deleteAsync(legacyPath, { idempotent: true });
  }

  private async moveLegacyEntry(sourcePath: string, targetPath: string): Promise<void> {
    const fileSystem = getFileSystem();
    const sourceInfo = await fileSystem.getInfoAsync(sourcePath);
    if (!sourceInfo.exists) {
      return;
    }

    if (sourceInfo.isDirectory) {
      await fileSystem.makeDirectoryAsync(targetPath, { intermediates: true });
      const entries = await fileSystem.readDirectoryAsync(`${sourcePath}/`);
      for (const entry of entries) {
        await this.moveLegacyEntry(`${sourcePath}/${entry}`, `${targetPath}/${entry}`);
      }
      await fileSystem.deleteAsync(`${sourcePath}/`, { idempotent: true });
      return;
    }

    const parentPath = targetPath.slice(0, targetPath.lastIndexOf('/'));
    if (parentPath) {
      await fileSystem.makeDirectoryAsync(parentPath, { intermediates: true });
    }

    await fileSystem.moveAsync({ from: sourcePath, to: targetPath });
  }

  private buildPath(folder: string): string {
    const documentDirectory = getDocumentDirectory();
    return `${documentDirectory}${folder}/`;
  }

  /** Clears process-local path state after the configured root changes. */
  reset(): void {
    this.rootPath = null;
    this.storageFolder = DEFAULT_STORAGE_FOLDER;
    this.initializationPromise = null;
  }
}

export const pathHelper = PathHelper.getInstance();
export default pathHelper;
