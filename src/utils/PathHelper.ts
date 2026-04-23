/**
 * @module PathHelper
 * @description Independent path management to avoid circular dependencies
 * @since 2026-04-02
 * @version 1.0.0
 */

import logger from './logger';
import { getDocumentDirectory, getFileSystem } from './fileSystemCompat';

/**
 * Default storage folder name
 */
const DEFAULT_STORAGE_FOLDER = 'lite-data-store';
const LEGACY_STORAGE_FOLDER = 'expo-lite-data';

/**
 * Path helper class to manage application paths
 */
export class PathHelper {
  private static instance: PathHelper | null = null;
  private rootPath: string | null = null;
  private storageFolder: string = DEFAULT_STORAGE_FOLDER;
  private initializationPromise: Promise<string> | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): PathHelper {
    if (!PathHelper.instance) {
      PathHelper.instance = new PathHelper();
    }
    return PathHelper.instance;
  }

  /**
   * Set storage folder name
   */
  setStorageFolder(folder: string): void {
    if (this.storageFolder !== folder) {
      this.storageFolder = folder;
      this.rootPath = null;
      this.initializationPromise = null;
    }
  }

  /**
   * Get storage folder name
   */
  getStorageFolder(): string {
    return this.storageFolder;
  }

  /**
   * Get root path asynchronously
   */
  async getRootPath(): Promise<string> {
    return this.ensureStorageReady();
  }

  /**
   * Get root path synchronously
   */
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

      if (legacyInfo.exists && (!rootInfo.exists || (await this.isRootEffectivelyEmpty(rootPath)))) {
        try {
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
      const parsed = JSON.parse(metaRaw);
      return !parsed?.tables || Object.keys(parsed.tables).length === 0;
    } catch {
      return true;
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

  /**
   * Reset cached path (useful for testing)
   */
  reset(): void {
    this.rootPath = null;
    this.storageFolder = DEFAULT_STORAGE_FOLDER;
    this.initializationPromise = null;
  }
}

export const pathHelper = PathHelper.getInstance();
export default pathHelper;
