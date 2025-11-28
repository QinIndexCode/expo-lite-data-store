// src/core/file/FileInfoCache.ts

import { File } from "expo-file-system";

/**
 * 文件信息缓存类，用于缓存文件信息，减少对文件系统的调用
 */
export class FileInfoCache {
  /**
   * 文件信息缓存，key为文件名，value为文件信息和缓存时间
   */
  private fileInfoCache = new Map<string, {
    info: any;
    timestamp: number;
  }>();
  
  /**
   * 缓存过期时间（毫秒）
   */
  private readonly CACHE_EXPIRY = 5000; // 5秒
  
  /**
   * 获取文件信息，优先从缓存中获取
   * @param path 文件路径或File对象
   * @returns 文件信息
   */
  async getFileInfo(path: string | File): Promise<any> {
    const key = typeof path === 'string' ? path : path.name;
    const cached = this.fileInfoCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY) {
      return cached.info;
    }
    
    try {
      let info;
      if (typeof path === 'string') {
        // 如果是字符串路径，需要创建File对象来获取信息
        const file = new File(path);
        info = await file.info();
      } else {
        // 如果是File对象，直接调用info方法
        info = await path.info();
      }
      this.fileInfoCache.set(key, {
        info,
        timestamp: Date.now()
      });
      return info;
    } catch (error) {
      this.fileInfoCache.delete(key);
      throw error;
    }
  }
  
  /**
   * 清除文件信息缓存
   * @param path 文件路径（可选），如果不提供则清除所有缓存
   */
  clearFileInfoCache(path?: string): void {
    if (path) {
      this.fileInfoCache.delete(path);
    } else {
      this.fileInfoCache.clear();
    }
  }
}