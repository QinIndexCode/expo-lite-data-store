/**
 * @module PathHelper
 * @description Independent path management to avoid circular dependencies
 * @since 2026-04-02
 * @version 1.0.0
 */

import * as FileSystem from 'expo-file-system';

/**
 * Default storage folder name
 */
const DEFAULT_STORAGE_FOLDER = 'expo-lite-data';

/**
 * Path helper class to manage application paths
 */
export class PathHelper {
  private static instance: PathHelper | null = null;
  private rootPath: string | null = null;
  private storageFolder: string = DEFAULT_STORAGE_FOLDER;

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
      this.rootPath = null; // Reset cached path
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
    if (!this.rootPath) {
      const documentDirectory = FileSystem.documentDirectory || '/mock/documents/';
      this.rootPath = `${documentDirectory}${this.storageFolder}/`;
      try {
        await FileSystem.makeDirectoryAsync(this.rootPath, { intermediates: true });
      } catch {
        // Directory may already exist, ignore error
      }
    }
    return this.rootPath;
  }

  /**
   * Get root path synchronously
   */
  getRootPathSync(): string {
    if (!this.rootPath) {
      if (process.env.NODE_ENV === 'test') {
        this.rootPath = `/mock/documents/${this.storageFolder}/`;
      } else {
        const documentDirectory = FileSystem.documentDirectory || '/mock/documents/';
        this.rootPath = `${documentDirectory}${this.storageFolder}/`;
      }
    }
    return this.rootPath;
  }

  /**
   * Reset cached path (useful for testing)
   */
  reset(): void {
    this.rootPath = null;
    this.storageFolder = DEFAULT_STORAGE_FOLDER;
  }
}

export const pathHelper = PathHelper.getInstance();
export default pathHelper;
