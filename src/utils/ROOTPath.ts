// Import expo-file-system dynamically to ensure mocks are set up first
import config from "../liteStore.config";

// make sure create Singleton 
class SingletonRootPath {
    private static instance: any = null;
    private static Directory: any = null;
    private static Paths: any = null;

    private constructor() {}

    private static async initialize() {
        if (!SingletonRootPath.Directory || !SingletonRootPath.Paths) {
            // Dynamically import expo-file-system to ensure mocks are set up
            const { Directory, Paths } = await import("expo-file-system");
            SingletonRootPath.Directory = Directory;
            SingletonRootPath.Paths = Paths;
        }
    }

    public static async getInstance(): Promise<any> {
        if (!SingletonRootPath.instance) {
            await SingletonRootPath.initialize();
            const rootDir = new SingletonRootPath.Directory(SingletonRootPath.Paths.document, config.storageFolder);
            await rootDir.create({ intermediates: true });
            SingletonRootPath.instance = rootDir;
        }
        return SingletonRootPath.instance;
    }

    // For synchronous access, use a mock directory object that works with toString()
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

// Use the sync version for initial export, which returns a mock object
// This prevents the real expo-file-system from being imported during module initialization
const ROOT = SingletonRootPath.getInstanceSync();

export default ROOT;
