// jest.setup.js
// Jest setup file

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
                global.__expo_file_system_mock__.mockFileSystem[dest.path] = global.__expo_file_system_mock__.mockFileSystem[this.path];
                delete global.__expo_file_system_mock__.mockFileSystem[this.path];
            }
        }

        // Mock copy method
        async copy(dest) {
            if (this.path in global.__expo_file_system_mock__.mockFileSystem) {
                global.__expo_file_system_mock__.mockFileSystem[dest.path] = global.__expo_file_system_mock__.mockFileSystem[this.path];
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
        readAsStringAsync: async (uri) => {
            if (uri in global.__expo_file_system_mock__.mockFileSystem) {
                return global.__expo_file_system_mock__.mockFileSystem[uri];
            }
            throw new Error(`File not found: ${uri}`);
        },
        writeAsStringAsync: async (uri, content) => {
            global.__expo_file_system_mock__.mockFileSystem[uri] = content;
        },
        deleteAsync: async (uri) => {
            delete global.__expo_file_system_mock__.mockFileSystem[uri];
        },
        copyAsync: async (options) => {
            if (options.from in global.__expo_file_system_mock__.mockFileSystem) {
                global.__expo_file_system_mock__.mockFileSystem[options.to] = global.__expo_file_system_mock__.mockFileSystem[options.from];
            }
        },
        moveAsync: async (options) => {
            if (options.from in global.__expo_file_system_mock__.mockFileSystem) {
                global.__expo_file_system_mock__.mockFileSystem[options.to] = global.__expo_file_system_mock__.mockFileSystem[options.from];
                delete global.__expo_file_system_mock__.mockFileSystem[options.from];
            }
        },
        makeDirectoryAsync: async (uri, options) => {
            // Do nothing for mock
        },
        deleteDirectoryAsync: async (uri, options) => {
            // Do nothing for mock
        },
        readDirectoryAsync: async (uri) => {
            return [];
        },
        getInfoAsync: async (uri) => {
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
        // Mock getRandomBytesAsync method
        getRandomBytesAsync: async (size) => {
            // Return a buffer of random bytes
            return Buffer.from(Math.random().toString(36).substring(2, size + 2));
        },
        // Mock digestStringAsync method
        digestStringAsync: async (algorithm, data) => {
            // Return a mock hash
            return Buffer.from(data).toString('hex');
        },
        // Mock generateRandomAsync method
        generateRandomAsync: async (options) => {
            // Return a mock random string
            return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        },
        // Mock getCryptoDigestAlgorithm method
        getCryptoDigestAlgorithm: (algorithm) => {
            // Return the algorithm as is
            return algorithm;
        },
    };
});

// Mock expo-secure-store
jest.mock('expo-secure-store', () => {
    return {
        // Mock getItemAsync method
        getItemAsync: async (key) => {
            // Return a mock value
            return null;
        },
        // Mock setItemAsync method
        setItemAsync: async (key, value) => {
            // Do nothing for mock
        },
        // Mock deleteItemAsync method
        deleteItemAsync: async (key) => {
            // Do nothing for mock
        },
        // Mock getAllKeysAsync method
        getAllKeysAsync: async () => {
            // Return an empty array
            return [];
        },
    };
});

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