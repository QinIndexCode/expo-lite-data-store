/**
 * 根路径管理工具
 * 使用单例模式获取应用的根目录路径，支持异步和同步两种方式
 * 异步方式使用真实的expo-file-system API，同步方式返回模拟对象
 */

// Import expo-file-system statically
import config from '../liteStore.config';
import * as FileSystem from 'expo-file-system';

/**
 * 单例根路径管理类
 * 确保应用中只有一个根路径实例
 */
class SingletonRootPath {
  /**
   * 单例实例
   */
  private static instance: any = null;

  /**
   * 私有构造函数，防止外部实例化
   */
  private constructor() {}

  /**
   * 获取异步根路径实例
   * 使用真实的expo-file-system API创建并返回根目录路径
   * @returns Promise<any> 根目录路径字符串
   */
  public static async getInstance(): Promise<any> {
    if (!SingletonRootPath.instance) {
      const documentDirectory = FileSystem.documentDirectory;
      const rootDirPath = `${documentDirectory}${config.storageFolder}/`;
      await FileSystem.makeDirectoryAsync(rootDirPath, { intermediates: true });
      SingletonRootPath.instance = rootDirPath;
    }
    return SingletonRootPath.instance;
  }

  /**
   * 获取同步根路径实例
   * 区分测试环境和非测试环境
   * 测试环境：返回模拟路径
   * 非测试环境：返回真实的Expo文件系统路径
   * @returns any 根目录路径字符串
   */
  public static getInstanceSync(): any {
    if (!SingletonRootPath.instance) {
      // 区分测试环境和非测试环境
      if (process.env.NODE_ENV === 'test') {
        // 测试环境使用模拟路径
        SingletonRootPath.instance = `/mock/documents/${config.storageFolder}/`;
      } else {
        // 非测试环境使用真实的Expo文件系统路径
        // 使用FileSystem.documentDirectory直接获取真实路径
        const documentDirectory = FileSystem.documentDirectory;
        SingletonRootPath.instance = `${documentDirectory}${config.storageFolder}/`;
      }
    }
    return SingletonRootPath.instance;
  }
}

/**
 * 根路径实例
 * 使用同步方式获取，根据环境返回真实路径或模拟路径
 */
const ROOT = SingletonRootPath.getInstanceSync();

/**
 * 导出根路径实例
 */
export default ROOT;
