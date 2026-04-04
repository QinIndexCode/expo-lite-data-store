/**
 * @module ROOTPath
 * @description Singleton root path manager for application directory
 * @since 2025-11-19
 * @version 1.0.0
 */

import { pathHelper } from './PathHelper';

/**
 * Singleton root path manager class
 */
class SingletonRootPath {
  /**
   * Singleton instance
   */
  private static instance: any = null;

  /**
   * Private constructor to prevent external instantiation
   */
  private constructor() {}

  /**
   * Get async root path instance
   * @returns Promise<any> Root directory path string
   */
  public static async getInstance(): Promise<any> {
    if (!SingletonRootPath.instance) {
      SingletonRootPath.instance = await pathHelper.getRootPath();
    }
    return SingletonRootPath.instance;
  }

  /**
   * Get sync root path instance
   * @returns any Root directory path string
   */
  public static getInstanceSync(): any {
    if (!SingletonRootPath.instance) {
      SingletonRootPath.instance = pathHelper.getRootPathSync();
    }
    return SingletonRootPath.instance;
  }
}

/**
 * Root path instance
 */
const ROOT = SingletonRootPath.getInstanceSync();

/**
 * Export root path instance
 */
export default ROOT;
