/**
 * @module PermissionChecker
 * @description Permission checker for file system access validation
 * @since 2025-11-28
 * @version 1.0.0
 */

import * as FileSystem from 'expo-file-system';
import { EncodingType } from 'expo-file-system';
import { StorageError } from '../../types/storageErrorInfc';
import ROOT from '../../utils/ROOTPath';

/**
 * 权限检查器类，用于检查文件系统访问权限
 */
export class PermissionChecker {
  /**
   * 检查文件系统访问权限
   */
  async checkPermissions(): Promise<void> {
    try {
      // Skip real permission check in test to avoid Expo native API dependency
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        return;
      }
      // Create临时文件来检查权限
      const tempFilePath = `${ROOT}/.temp_permission_check`;
      // Use correctly imported EncodingType.UTF8
      await FileSystem.writeAsStringAsync(tempFilePath, 'permission check', { encoding: EncodingType.UTF8 });
      await FileSystem.deleteAsync(tempFilePath);
    } catch (error) {
      throw new StorageError(`Permission denied when accessing file system`, 'PERMISSION_DENIED', {
        cause: error,
        details: `Failed to access file system`,
        suggestion: 'Check if your app has permission to access the file system',
      });
    }
  }
}
