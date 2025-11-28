// src/core/file/PermissionChecker.ts

import { File } from "expo-file-system";
import { StorageError } from "../../types/storageErrorInfc";
import ROOT from "../../utils/ROOTPath";

/**
 * 权限检查器类，用于检查文件系统访问权限
 */
export class PermissionChecker {
  /**
   * 检查文件系统访问权限
   */
  async checkPermissions(): Promise<void> {
    try {
      // 创建临时文件来检查权限
      const tempFile = new File(`${ROOT}/.temp_permission_check`);
      await tempFile.write('permission check');
      await tempFile.delete();
    } catch (error) {
      throw new StorageError(
        `Permission denied when accessing file system`,
        "PERMISSION_DENIED",
        {
          cause: error,
          details: `Failed to access file system`,
          suggestion: "Check if your app has permission to access the file system"
        }
      );
    }
  }
}