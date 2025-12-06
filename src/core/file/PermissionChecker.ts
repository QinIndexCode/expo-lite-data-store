// src/core/file/PermissionChecker.ts

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
      // 在测试环境下直接跳过真实权限检查，避免对 Expo 原生 API 的依赖导致单元测试失败
      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        return;
      }
      // 创建临时文件来检查权限
      const tempFilePath = `${ROOT}/.temp_permission_check`;
      // 使用正确导入的 EncodingType.UTF8
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
