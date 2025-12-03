/**
 * 根路径管理工具
 * 使用单例模式获取应用的根目录路径，支持异步和同步两种方式
 * 异步方式使用真实的expo-file-system API，同步方式返回模拟对象
 */

// Import expo-file-system dynamically to ensure mocks are set up first
import config from "../liteStore.config";

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
     * expo-file-system的Directory类
     */
    private static Directory: any = null;
    /**
     * expo-file-system的Paths对象
     */
    private static Paths: any = null;

    /**
     * 私有构造函数，防止外部实例化
     */
    private constructor() {}

    /**
     * 初始化expo-file-system依赖
     * 动态导入expo-file-system，确保mocks在测试环境中正确设置
     */
    private static async initialize() {
        if (!SingletonRootPath.Directory || !SingletonRootPath.Paths) {
            // Dynamically import expo-file-system to ensure mocks are set up
            const { Directory, Paths } = await import("expo-file-system");
            SingletonRootPath.Directory = Directory;
            SingletonRootPath.Paths = Paths;
        }
    }

    /**
     * 获取异步根路径实例
     * 使用真实的expo-file-system API创建并返回根目录对象
     * @returns Promise<any> 根目录对象
     */
    public static async getInstance(): Promise<any> {
        if (!SingletonRootPath.instance) {
            await SingletonRootPath.initialize();
            const rootDir = new SingletonRootPath.Directory(SingletonRootPath.Paths.document, config.storageFolder);
            await rootDir.create({ intermediates: true });
            SingletonRootPath.instance = rootDir;
        }
        return SingletonRootPath.instance;
    }

    /**
     * 获取同步根路径实例
     * 返回一个模拟的根目录对象，用于同步场景
     * @returns any 模拟的根目录对象
     */
    public static getInstanceSync(): any {
        if (!SingletonRootPath.instance) {
            // Create a mock directory object that has all necessary methods
            SingletonRootPath.instance = {
                toString: () => `/mock/documents/${config.storageFolder}`,
                list: () => [], // Add list() method that returns empty array
                name: config.storageFolder
            };
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
