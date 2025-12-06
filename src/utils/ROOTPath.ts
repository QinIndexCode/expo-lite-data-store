/**
 * 根路径管理工具
 * 使用单例模式获取应用的根目录路径，支持异步和同步两种方式
 * 异步方式使用真实的expo-file-system API，同步方式返回模拟对象
 */

// Import expo-file-system dynamically to ensure mocks are set up first
import config from '../liteStore.config';

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
   * expo-file-system模块
   */
  private static FileSystem: any = null;

  /**
   * 私有构造函数，防止外部实例化
   */
  private constructor() {}

  /**
   * 初始化expo-file-system依赖
   * 动态导入expo-file-system，确保mocks在测试环境中正确设置
   */
  private static async initialize() {
    if (!SingletonRootPath.FileSystem) {
      // Dynamically import expo-file-system to ensure mocks are set up
      SingletonRootPath.FileSystem = await import('expo-file-system');
    }
  }

  /**
   * 获取异步根路径实例
   * 使用真实的expo-file-system API创建并返回根目录路径
   * @returns Promise<any> 根目录路径字符串
   */
  public static async getInstance(): Promise<any> {
    if (!SingletonRootPath.instance) {
      await SingletonRootPath.initialize();
      const documentDirectory = SingletonRootPath.FileSystem.documentDirectory;
      const rootDirPath = `${documentDirectory}${config.storageFolder}/`;
      await SingletonRootPath.FileSystem.makeDirectoryAsync(rootDirPath, { intermediates: true });
      SingletonRootPath.instance = rootDirPath;
    }
    return SingletonRootPath.instance;
  }

  /**
   * 获取同步根路径实例
   * 返回一个模拟的根目录路径，用于同步场景
   * @returns any 模拟的根目录路径字符串
   */
  public static getInstanceSync(): any {
    if (!SingletonRootPath.instance) {
      // Create a mock directory path
      SingletonRootPath.instance = `/mock/documents/${config.storageFolder}/`;
    }
    return SingletonRootPath.instance;
  }
}

/**
 * 根路径实例
 * 使用同步方式获取，返回模拟对象，防止在模块初始化时导入真实的expo-file-system
 */
const ROOT = SingletonRootPath.getInstanceSync();

/**
 * 导出根路径实例
 */
export default ROOT;
