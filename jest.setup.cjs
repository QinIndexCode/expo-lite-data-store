process.env.NODE_ENV = 'test';

const loggerModule = require('./src/utils/logger');
const logger = loggerModule?.default ?? loggerModule;
const diagnosticsEnabled = process.env.EXPO_LITE_DATA_STORE_TEST_DIAGNOSTICS === '1';
const logInfo = (...args) => {
  if (diagnosticsEnabled) {
    logger.info(...args);
  }
};
const logWarn = (...args) => {
  if (diagnosticsEnabled) {
    logger.warn(...args);
  }
};

logInfo('[jest.setup] Test environment initialized, NODE_ENV =', process.env.NODE_ENV);

if (diagnosticsEnabled) {
  global.testMonitor = {
    currentTest: null,
    testStartTime: null,
    timeoutId: null,
    timeoutDuration: 60000,

    startTest(testName, testPath) {
      this.currentTest = { name: testName, path: testPath };
      this.testStartTime = Date.now();

      logger.info(`[TestMonitor] Starting test: ${testName} (${testPath})`);

      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }

      this.timeoutId = setTimeout(() => {
        logger.error(`[TestMonitor] Test timeout! Test has been running for more than 60 seconds`);
        logger.error(`[TestMonitor] Current test: ${this.currentTest ? this.currentTest.name : 'unknown'}`);
        logger.error(`[TestMonitor] Test file: ${this.currentTest ? this.currentTest.path : 'unknown'}`);
        logger.error(`[TestMonitor] Start time: ${new Date(this.testStartTime).toISOString()}`);
        logger.error(`[TestMonitor] Duration: ${(Date.now() - this.testStartTime) / 1000} seconds`);

        this.reportPotentialBlockage();

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

      if (typeof jest !== 'undefined') {
        logger.error(
          `[TestMonitor] - Jest timer status: ${jest.useFakeTimers ? 'using fake timers' : 'using real timers'}`
        );
      }

      logger.error(
        `[TestMonitor] - Process memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
      );

      logger.error(`[TestMonitor] - Node.js version: ${process.version}`);
      logger.error(`[TestMonitor] - Platform: ${process.platform}`);

      logger.error(`[TestMonitor] Potential solutions:`);
      logger.error(`[TestMonitor] 1. Check for uncleaned setTimeout/setInterval`);
      logger.error(`[TestMonitor] 2. Check for unresolved Promises`);
      logger.error(`[TestMonitor] 3. Check for circular references or memory leaks`);
      logger.error(`[TestMonitor] 4. Check for deadlocked async operations`);
      logger.error(`[TestMonitor] 5. Run: npm test -- --detectOpenHandles`);
    },
  };
}

// Per-test watchdogs are opt-in so normal test runs do not add timers or force exits.
if (diagnosticsEnabled && typeof beforeEach !== 'undefined') {
  beforeEach(() => {
    const currentTest = expect.getState().currentTestName;
    const testPath = expect.getState().testPath;
    if (global.testMonitor) {
      global.testMonitor.startTest(currentTest, testPath);
    }
  });
}

if (diagnosticsEnabled && typeof afterEach !== 'undefined') {
  afterEach(() => {
    const currentTest = expect.getState().currentTestName;
    if (global.testMonitor) {
      global.testMonitor.endTest(currentTest);
    }
  });
}

if (typeof afterEach !== 'undefined') {
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
}

// Release singleton resources after each test file.
if (typeof afterAll !== 'undefined') {
  afterAll(async () => {
    logInfo('[jest.setup] afterAll: Starting global cleanup');

    if (global.testMonitor && global.testMonitor.timeoutId) {
      logInfo('[jest.setup] afterAll: Cleaning up test monitor timeout timer');
      clearTimeout(global.testMonitor.timeoutId);
      global.testMonitor.timeoutId = null;
    }

    try {
      const { stopKeyCacheCleanup } = require('./src/utils/crypto');
      logInfo('[jest.setup] afterAll: Cleaning up key cache cleanup timer');
      stopKeyCacheCleanup();
    } catch (e) {
      logWarn('[jest.setup] afterAll: Failed to clean up key cache cleanup timer', e);
    }

    try {
      const { taskQueue } = require('./src/taskQueue/taskQueue');
      if (taskQueue && typeof taskQueue.cleanup === 'function') {
        logInfo('[jest.setup] afterAll: Cleaning up global taskQueue');
        taskQueue.cleanup();
      }
    } catch (e) {
      logWarn('[jest.setup] afterAll: Failed to clean up taskQueue', e);
    }

    try {
      const { db, plainStorage } = require('./src/core/db');
      if (db && typeof db.cleanup === 'function') {
        logInfo('[jest.setup] afterAll: Cleaning up global db instance');
        await db.cleanup();
      }
      if (plainStorage && typeof plainStorage.cleanup === 'function' && plainStorage !== db) {
        logInfo('[jest.setup] afterAll: Cleaning up global plainStorage instance');
        await plainStorage.cleanup();
      }
    } catch (e) {
      logWarn('[jest.setup] afterAll: Failed to clean up global database instances', e);
    }

    try {
      const { AutoSyncService } = require('./src/core/service/AutoSyncService');
      if (AutoSyncService && typeof AutoSyncService.cleanupInstance === 'function') {
        logInfo('[jest.setup] afterAll: Cleaning up AutoSyncService instance');
        await AutoSyncService.cleanupInstance();
      }
    } catch (e) {
      logWarn('[jest.setup] afterAll: Failed to clean up AutoSyncService instance', e);
    }

    try {
      if (typeof jest !== 'undefined' && jest.useRealTimers) {
        jest.useRealTimers();
      }
      jest.clearAllTimers();
    } catch (e) {
      logWarn('[jest.setup] afterAll: Failed to clean up Jest timers', e);
    }
    logInfo('[jest.setup] afterAll: Global cleanup completed');
  });
}

// Expo module test shims share an in-memory filesystem and secure store.
global.__expo_file_system_mock__ = {
  mockFileSystem: {},
};

jest.mock('expo-file-system', () => {
  const Paths = {
    document: '/mock/documents',
    cache: '/mock/cache',
    bundle: '/mock/bundle',
  };

  class Directory {
    constructor(basePath, name) {
      this.path = `${basePath}/${name}`;
    }

    async create(options) {}

    async delete(options) {}

    async info() {
      return {
        exists: true,
        isDirectory: true,
      };
    }

    async readDirectory() {
      return [];
    }

    async move(dest) {}

    async copy(dest) {}

    toString() {
      return this.path;
    }
  }

  class File {
    constructor(dir, name) {
      this.path = typeof dir === 'string' ? `${dir}/${name}` : `${dir.toString()}/${name}`;
      this.name = name;
    }

    async info() {
      return {
        exists: this.path in global.__expo_file_system_mock__.mockFileSystem,
        size: global.__expo_file_system_mock__.mockFileSystem[this.path]?.length,
        modificationTime: Date.now(),
      };
    }

    async text() {
      if (!(this.path in global.__expo_file_system_mock__.mockFileSystem)) {
        throw new Error(`File not found: ${this.path}`);
      }
      return global.__expo_file_system_mock__.mockFileSystem[this.path];
    }

    async write(content) {
      global.__expo_file_system_mock__.mockFileSystem[this.path] = content;
    }

    async delete() {
      delete global.__expo_file_system_mock__.mockFileSystem[this.path];
    }

    async move(dest) {
      if (this.path in global.__expo_file_system_mock__.mockFileSystem) {
        global.__expo_file_system_mock__.mockFileSystem[dest.path] =
          global.__expo_file_system_mock__.mockFileSystem[this.path];
        delete global.__expo_file_system_mock__.mockFileSystem[this.path];
      }
    }

    async copy(dest) {
      if (this.path in global.__expo_file_system_mock__.mockFileSystem) {
        global.__expo_file_system_mock__.mockFileSystem[dest.path] =
          global.__expo_file_system_mock__.mockFileSystem[this.path];
      }
    }

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
    EncodingType: {
      UTF8: 'utf8',
    },
    readAsStringAsync: async uri => {
      if (uri in global.__expo_file_system_mock__.mockFileSystem) {
        const value = global.__expo_file_system_mock__.mockFileSystem[uri];
        if (typeof value === 'string') {
          return value;
        }
      }
      throw new Error(`File not found: ${uri}`);
    },
    writeAsStringAsync: async (uri, content) => {
      global.__expo_file_system_mock__.mockFileSystem[uri] = content;
    },
    deleteAsync: async uri => {
      if (uri.endsWith('/')) {
        for (const filePath in global.__expo_file_system_mock__.mockFileSystem) {
          if (filePath.startsWith(uri)) {
            delete global.__expo_file_system_mock__.mockFileSystem[filePath];
          }
        }
      } else {
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
      global.__expo_file_system_mock__.mockFileSystem[uri] = {
        __type: 'directory',
      };
    },
    deleteDirectoryAsync: async (uri, options) => {},
    readDirectoryAsync: async uri => {
      return Object.keys(global.__expo_file_system_mock__.mockFileSystem)
        .filter(filePath => filePath.startsWith(uri) && filePath !== uri)
        .map(filePath => filePath.substring(uri.length))
        .filter(filePath => !filePath.includes('/'));
    },
    getInfoAsync: async uri => {
      const value = global.__expo_file_system_mock__.mockFileSystem[uri];
      return {
        exists: uri in global.__expo_file_system_mock__.mockFileSystem,
        size: typeof value === 'string' ? value.length : 0,
        isDirectory: Boolean(value && typeof value === 'object' && value.__type === 'directory'),
        modificationTime: Date.now(),
      };
    },
  };
});

jest.mock('expo-file-system/legacy', () => jest.requireMock('expo-file-system'));

jest.mock('expo-modules-core', () => {
  return {
    requireOptionalNativeModule: () => null,
  };
});

jest.mock('expo-crypto', () => {
  return {
    CryptoDigestAlgorithm: {
      SHA1: 'SHA-1',
      SHA256: 'SHA-256',
      SHA384: 'SHA-384',
      SHA512: 'SHA-512',
      MD5: 'MD5',
    },
    getRandomBytes: size => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return bytes;
    },
    getRandomBytesAsync: async size => {
      return Buffer.from(
        Math.random()
          .toString(36)
          .substring(2, size + 2)
      );
    },
    digestStringAsync: async (algorithm, data) => {
      return Buffer.from(data).toString('hex');
    },
    generateRandomAsync: async options => {
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    },
    getCryptoDigestAlgorithm: algorithm => {
      return algorithm;
    },
  };
});

if (!global.__expo_secure_store_mock__) {
  global.__expo_secure_store_mock__ = {
    mockStore: {},
    canUseBiometricAuthentication: true,
  };
}

jest.mock('expo-secure-store', () => {
  const mockStore = global.__expo_secure_store_mock__.mockStore;

  return {
    getItemAsync: async key => {
      return mockStore[key] || null;
    },
    setItemAsync: async (key, value) => {
      mockStore[key] = value;
    },
    deleteItemAsync: async key => {
      delete mockStore[key];
    },
    getAllKeysAsync: async () => {
      return Object.keys(mockStore);
    },
    canUseBiometricAuthentication: async () => global.__expo_secure_store_mock__.canUseBiometricAuthentication,
  };
});

jest.mock('expo-constants', () => {
  return {
    manifest: {
      version: '1.0.0',
    },
    expoConfig: () => {
      return {
        name: 'expo-litedatastore',
        version: '1.0.0',
      };
    },
    deviceName: 'Test Device',
    deviceId: 'test-device-id',
    appOwnership: 'standalone',
  };
});
