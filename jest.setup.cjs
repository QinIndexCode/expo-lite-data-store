// jest.setup.js
// Jest setup file

// 设置测试环境变量
process.env.NODE_ENV = 'test';

const loggerModule = require('./src/utils/logger');
const logger = loggerModule?.default ?? loggerModule;

logger.info('[jest.setup] Test environment initialized, NODE_ENV =', process.env.NODE_ENV);

// 测试监控和超时检测
global.testMonitor = {
  currentTest: null,
  testStartTime: null,
  timeoutId: null,
  timeoutDuration: 60000, // 60秒

  startTest(testName, testPath) {
    this.currentTest = { name: testName, path: testPath };
    this.testStartTime = Date.now();

    logger.info(`[TestMonitor] Starting test: ${testName} (${testPath})`);

    // 清理之前的超时
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // 设置60秒超时 - 使用真实定时器确保在fake timers环境中也能工作
    this.timeoutId = setTimeout(() => {
      logger.error(`[TestMonitor] Test timeout! Test has been running for more than 60 seconds`);
      logger.error(`[TestMonitor] Current test: ${this.currentTest ? this.currentTest.name : 'unknown'}`);
      logger.error(`[TestMonitor] Test file: ${this.currentTest ? this.currentTest.path : 'unknown'}`);
      logger.error(`[TestMonitor] Start time: ${new Date(this.testStartTime).toISOString()}`);
      logger.error(`[TestMonitor] Duration: ${(Date.now() - this.testStartTime) / 1000} seconds`);

      // 报告可能的阻塞点
      this.reportPotentialBlockage();

      // 强制退出进程
      logger.error(`[TestMonitor] Forcing test process exit...`);
      process.exit(1);
    }, this.timeoutDuration);

    logger.info(`[TestMonitor] Set ${this.timeoutDuration / 1000} seconds timeout monitoring`);
  },

  endTest(testName) {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.currentTest && this.testStartTime) {
      const duration = Date.now() - this.testStartTime;
      logger.info(`[TestMonitor] Test completed: ${testName} (${duration}ms)`);
    }

    this.currentTest = null;
    this.testStartTime = null;
  },

  reportPotentialBlockage() {
    logger.error(`[TestMonitor] Analyzing potential blockage causes:`);

    // 检查是否有未完成的异步操作
    if (typeof jest !== 'undefined') {
      logger.error(`[TestMonitor] - Jest timer status: ${jest.useFakeTimers ? 'using fake timers' : 'using real timers'}`);
    }

    // 检查进程状态
    logger.error(`[TestMonitor] - Process memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

    // 检查是否有未解决的Promise
    logger.error(`[TestMonitor] - Node.js version: ${process.version}`);
    logger.error(`[TestMonitor] - Platform: ${process.platform}`);

    // 建议解决方案
    logger.error(`[TestMonitor] Potential solutions:`);
    logger.error(`[TestMonitor] 1. Check for uncleaned setTimeout/setInterval`);
    logger.error(`[TestMonitor] 2. Check for unresolved Promises`);
    logger.error(`[TestMonitor] 3. Check for circular references or memory leaks`);
    logger.error(`[TestMonitor] 4. Check for deadlocked async operations`);
    logger.error(`[TestMonitor] 5. Run: npm test -- --detectOpenHandles`);
  },
};

// 添加Jest生命周期钩子来监控测试
if (typeof beforeEach !== 'undefined') {
  beforeEach(() => {
    const currentTest = expect.getState().currentTestName;
    const testPath = expect.getState().testPath;
    if (global.testMonitor) {
      global.testMonitor.startTest(currentTest, testPath);
    }
  });
}

if (typeof afterEach !== 'undefined') {
  afterEach(() => {
    const currentTest = expect.getState().currentTestName;
    if (global.testMonitor) {
      global.testMonitor.endTest(currentTest);
    }
  });
}

// 全局清理：清理所有可能的异步操作和定时器
if (typeof afterAll !== 'undefined') {
  afterAll(async () => {
    logger.info('[jest.setup] afterAll: Starting global cleanup');

    // 清理测试监控器
    if (global.testMonitor && global.testMonitor.timeoutId) {
      logger.info('[jest.setup] afterAll: Cleaning up test monitor timeout timer');
      clearTimeout(global.testMonitor.timeoutId);
      global.testMonitor.timeoutId = null;
    }

    try {
      // 停止密钥缓存清理定时器
      const { stopKeyCacheCleanup } = require('./src/utils/crypto');
      logger.info('[jest.setup] afterAll: Cleaning up key cache cleanup timer');
      stopKeyCacheCleanup();
    } catch (e) {
      logger.warn('[jest.setup] afterAll: Failed to clean up key cache cleanup timer', e);
    }

    try {
      // 清理全局任务队列
      const { taskQueue } = require('./src/taskQueue/taskQueue');
      if (taskQueue && typeof taskQueue.cleanup === 'function') {
        logger.info('[jest.setup] afterAll: Cleaning up global taskQueue');
        taskQueue.cleanup();
      }
    } catch (e) {
      logger.warn('[jest.setup] afterAll: Failed to clean up taskQueue', e);
    }

    try {
      // 清理全局数据库实例
      const { db, plainStorage } = require('./src/core/db');
      if (db && typeof db.cleanup === 'function') {
        logger.info('[jest.setup] afterAll: Cleaning up global db instance');
        db.cleanup();
      }
      if (plainStorage && typeof plainStorage.cleanup === 'function' && plainStorage !== db) {
        logger.info('[jest.setup] afterAll: Cleaning up global plainStorage instance');
        plainStorage.cleanup();
      }
    } catch (e) {
      logger.warn('[jest.setup] afterAll: Failed to clean up global database instances', e);
    }
    
    try {
      // 清理自动同步服务实例，关闭所有定时器
      const { AutoSyncService } = require('./src/core/service/AutoSyncService');
      if (AutoSyncService && typeof AutoSyncService.cleanupInstance === 'function') {
        logger.info('[jest.setup] afterAll: Cleaning up AutoSyncService instance');
        await AutoSyncService.cleanupInstance();
      }
    } catch (e) {
      logger.warn('[jest.setup] afterAll: Failed to clean up AutoSyncService instance', e);
    }

    // 清理所有可能存在的定时器
    try {
      // 清理 jest 假定时器
      if (typeof jest !== 'undefined' && jest.useRealTimers) {
        jest.useRealTimers();
      }
      // 清理所有定时器
      jest.clearAllTimers();
    } catch (e) {
      logger.warn('[jest.setup] afterAll: Failed to clean up Jest timers', e);
    }



    // 等待所有异步操作完成
    await new Promise(resolve => setTimeout(resolve, 100));
    logger.info('[jest.setup] afterAll: Global cleanup completed');
  });
}

// Mock expo-file-system module
global.__expo_file_system_mock__ = {
  mockFileSystem: {},
};

// Mock expo-file-system
jest.mock('expo-file-system', () => {
  // Mock Paths object
  const Paths = {
    document: '/mock/documents',
    cache: '/mock/cache',
    bundle: '/mock/bundle',
  };

  // Mock Directory class
  class Directory {
    constructor(basePath, name) {
      this.path = `${basePath}/${name}`;
    }

    // Mock create method
    async create(options) {
      // Do nothing for mock
    }

    // Mock delete method
    async delete(options) {
      // Do nothing for mock
    }

    // Mock info method
    async info() {
      return {
        exists: true,
        isDirectory: true,
      };
    }

    // Mock readDirectory method
    async readDirectory() {
      return [];
    }

    // Mock move method
    async move(dest) {
      // Do nothing for mock
    }

    // Mock copy method
    async copy(dest) {
      // Do nothing for mock
    }

    // Mock toString method
    toString() {
      return this.path;
    }
  }

  // Mock File class
  class File {
    constructor(dir, name) {
      this.path = typeof dir === 'string' ? `${dir}/${name}` : `${dir.toString()}/${name}`;
      this.name = name;
    }

    // Mock info method
    async info() {
      return {
        exists: this.path in global.__expo_file_system_mock__.mockFileSystem,
        size: global.__expo_file_system_mock__.mockFileSystem[this.path]?.length,
        modificationTime: Date.now(),
      };
    }

    // Mock text method
    async text() {
      if (!(this.path in global.__expo_file_system_mock__.mockFileSystem)) {
        throw new Error(`File not found: ${this.path}`);
      }
      return global.__expo_file_system_mock__.mockFileSystem[this.path];
    }

    // Mock write method
    async write(content) {
      global.__expo_file_system_mock__.mockFileSystem[this.path] = content;
    }

    // Mock delete method
    async delete() {
      delete global.__expo_file_system_mock__.mockFileSystem[this.path];
    }

    // Mock move method
    async move(dest) {
      if (this.path in global.__expo_file_system_mock__.mockFileSystem) {
        global.__expo_file_system_mock__.mockFileSystem[dest.path] =
          global.__expo_file_system_mock__.mockFileSystem[this.path];
        delete global.__expo_file_system_mock__.mockFileSystem[this.path];
      }
    }

    // Mock copy method
    async copy(dest) {
      if (this.path in global.__expo_file_system_mock__.mockFileSystem) {
        global.__expo_file_system_mock__.mockFileSystem[dest.path] =
          global.__expo_file_system_mock__.mockFileSystem[this.path];
      }
    }

    // Mock toString method
    toString() {
      return this.path;
    }
  }

  return {
    File,
    Directory,
    Paths,
    documentDirectory: '/mock/documents',
    cacheDirectory: '/mock/cache',
    bundleDirectory: '/mock/bundle',
    mainBundlePath: '/mock/main.bundle',
    // 提供与 expo-file-system 一致的编码常量，避免业务代码访问 EncodingType 时抛错
    EncodingType: {
      UTF8: 'utf8',
    },
    readAsStringAsync: async uri => {
      if (uri in global.__expo_file_system_mock__.mockFileSystem) {
        return global.__expo_file_system_mock__.mockFileSystem[uri];
      }
      throw new Error(`File not found: ${uri}`);
    },
    writeAsStringAsync: async (uri, content) => {
      global.__expo_file_system_mock__.mockFileSystem[uri] = content;
    },
    deleteAsync: async uri => {
      // 如果是目录，删除所有以该目录开头的文件
      if (uri.endsWith('/')) {
        // 删除所有以该目录开头的文件
        for (const filePath in global.__expo_file_system_mock__.mockFileSystem) {
          if (filePath.startsWith(uri)) {
            delete global.__expo_file_system_mock__.mockFileSystem[filePath];
          }
        }
      } else {
        // 删除单个文件
        delete global.__expo_file_system_mock__.mockFileSystem[uri];
      }
    },
    copyAsync: async options => {
      if (options.from in global.__expo_file_system_mock__.mockFileSystem) {
        global.__expo_file_system_mock__.mockFileSystem[options.to] =
          global.__expo_file_system_mock__.mockFileSystem[options.from];
      }
    },
    moveAsync: async options => {
      if (options.from in global.__expo_file_system_mock__.mockFileSystem) {
        global.__expo_file_system_mock__.mockFileSystem[options.to] =
          global.__expo_file_system_mock__.mockFileSystem[options.from];
        delete global.__expo_file_system_mock__.mockFileSystem[options.from];
      }
    },
    makeDirectoryAsync: async (uri, options) => {
      // Do nothing for mock
    },
    deleteDirectoryAsync: async (uri, options) => {
      // Do nothing for mock
    },
    readDirectoryAsync: async uri => {
      // 返回指定目录下的所有文件
      return Object.keys(global.__expo_file_system_mock__.mockFileSystem)
        .filter(filePath => filePath.startsWith(uri) && filePath !== uri)
        .map(filePath => filePath.substring(uri.length))
        .filter(filePath => !filePath.includes('/'));
    },
    getInfoAsync: async uri => {
      return {
        exists: uri in global.__expo_file_system_mock__.mockFileSystem,
        size: global.__expo_file_system_mock__.mockFileSystem[uri]?.length,
        modificationTime: Date.now(),
      };
    },
  };
});

// Mock expo-crypto
jest.mock('expo-crypto', () => {
  return {
    // Mock CryptoDigestAlgorithm enum
    CryptoDigestAlgorithm: {
      SHA1: 'SHA-1',
      SHA256: 'SHA-256',
      SHA384: 'SHA-384',
      SHA512: 'SHA-512',
      MD5: 'MD5',
    },
    // Mock getRandomBytes method (同步版本)
    getRandomBytes: size => {
      // Return a Uint8Array of random bytes
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return bytes;
    },
    // Mock getRandomBytesAsync method (异步版本)
    getRandomBytesAsync: async size => {
      // Return a buffer of random bytes
      return Buffer.from(
        Math.random()
          .toString(36)
          .substring(2, size + 2)
      );
    },
    // Mock digestStringAsync method
    digestStringAsync: async (algorithm, data) => {
      // Return a mock hash
      return Buffer.from(data).toString('hex');
    },
    // Mock generateRandomAsync method
    generateRandomAsync: async options => {
      // Return a mock random string
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    },
    // Mock getCryptoDigestAlgorithm method
    getCryptoDigestAlgorithm: algorithm => {
      // Return the algorithm as is
      return algorithm;
    },
  };
});

// Mock expo-secure-store
// 使用全局变量存储 mock 数据，确保所有测试用例使用相同的 mockStore
if (!global.__expo_secure_store_mock__) {
  global.__expo_secure_store_mock__ = {
    mockStore: {},
  };
}

jest.mock('expo-secure-store', () => {
  // 使用全局 mockStore
  const mockStore = global.__expo_secure_store_mock__.mockStore;

  return {
    // Mock getItemAsync method
    getItemAsync: async key => {
      // 返回存储的值
      return mockStore[key] || null;
    },
    // Mock setItemAsync method
    setItemAsync: async (key, value) => {
      // 存储值
      mockStore[key] = value;
    },
    // Mock deleteItemAsync method
    deleteItemAsync: async key => {
      // 删除值
      delete mockStore[key];
    },
    // Mock getAllKeysAsync method
    getAllKeysAsync: async () => {
      // 返回所有键
      return Object.keys(mockStore);
    },
  };
});

// Mock getMasterKey function to always return the same key
jest.mock('./src/utils/crypto', () => {
  const original = jest.requireActual('./src/utils/crypto');
  return {
    ...original,
    // 总是返回相同的密钥
    getMasterKey: async () => {
      return 'test_master_key_12345678901234567890123456789012';
    },
  };
});

// 在所有测试结束后清理定时器
// 注意：这个清理逻辑需要在所有测试文件执行完毕后运行
// 因此需要放在 setup 文件的末尾

// 导入 stopKeyCacheCleanup 函数
const { stopKeyCacheCleanup } = require('./src/utils/crypto');

// 在所有测试结束后清理定时器
// 使用 afterAll 钩子确保在所有测试结束后执行
if (typeof afterAll === 'function') {
  afterAll(() => {
    // 停止密钥缓存清理定时器
    stopKeyCacheCleanup();

    // 清理所有定时器
    // 使用 Jest 提供的全局函数，确保所有模拟的定时器都被清理
    if (typeof jest !== 'undefined') {
      jest.clearAllTimers();
    }
  });
}

// Mock expo-constants
jest.mock('expo-constants', () => {
  return {
    // Mock manifest method
    manifest: {
      version: '1.0.0',
    },
    // Mock expoConfig method
    expoConfig: () => {
      return {
        name: 'expo-litedatastore',
        version: '1.0.0',
      };
    },
    // Mock deviceName method
    deviceName: 'Test Device',
    // Mock deviceId method
    deviceId: 'test-device-id',
  };
});
