import { type FileInfoCompat, getFileSystem } from '../../utils/fileSystemCompat';

export class FileInfoCache {
  private fileInfoCache = new Map<
    string,
    {
      info: FileInfoCompat;
      timestamp: number;
    }
  >();

  private readonly CACHE_EXPIRY = 5000;

  async getFileInfo(path: string): Promise<FileInfoCompat> {
    const key = path;
    const cached = this.fileInfoCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY) {
      return cached.info;
    }

    try {
      const info = await getFileSystem().getInfoAsync(path);
      this.fileInfoCache.set(key, {
        info,
        timestamp: Date.now(),
      });
      return info;
    } catch (error) {
      this.fileInfoCache.delete(key);
      throw error;
    }
  }

  clearFileInfoCache(path?: string): void {
    if (path) {
      this.fileInfoCache.delete(path);
    } else {
      this.fileInfoCache.clear();
    }
  }
}
