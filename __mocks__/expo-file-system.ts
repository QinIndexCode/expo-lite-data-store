// __mocks__/expo-file-system.ts
// Mock implementation for expo-file-system

// Mock file system data
const mockFileSystem = {};

// Mock Paths object
const Paths = {
    document: '/mock/documents',
    cache: '/mock/cache',
    bundle: '/mock/bundle',
};

// Mock Directory class
class Directory {
    private path: string;
    private _name: string;

    constructor(...uris: (string | any)[]) {
        // Handle different constructor signatures
        if (uris.length === 1 && typeof uris[0] === 'string') {
            this.path = uris[0];
            this._name = uris[0].split('/').pop() || '';
        } else if (uris.length === 2) {
            const basePath = typeof uris[0] === 'string' ? uris[0] : uris[0].toString();
            this._name = uris[1];
            this.path = `${basePath}/${this._name}`;
        } else {
            this.path = uris.map(uri => typeof uri === 'string' ? uri : uri.toString()).join('/');
            this._name = this.path.split('/').pop() || '';
        }
    }

    // Mock create method
    async create(options?: { intermediates?: boolean }): Promise<void> {
        // Do nothing for mock
    }

    // Mock delete method
    async delete(options?: { idempotent?: boolean; recursive?: boolean }): Promise<void> {
        // Do nothing for mock
    }

    // Mock info method
    async info(): Promise<{ exists: boolean; isDirectory: boolean }> {
        return {
            exists: true,
            isDirectory: true,
        };
    }

    // Mock list method (synchronous, returns array of File/Directory instances)
    list(): Array<{ name: string; isDirectory: boolean; delete: () => Promise<void> }> {
        return [];
    }

    // Mock move method
    async move(dest: Directory): Promise<void> {
        // Do nothing for mock
    }

    // Mock copy method
    async copy(dest: Directory): Promise<void> {
        // Do nothing for mock
    }

    // Mock name getter
    get name(): string {
        return this._name;
    }

    // Mock createFile method
    createFile(name: string, mimeType: string | null): File {
        return new File(this, name);
    }

    // Mock createDirectory method
    createDirectory(name: string): Directory {
        return new Directory(this, name);
    }

    // Mock toString method
    toString(): string {
        return this.path;
    }
}

// Mock File class
class File {
    private path: string;
    private name: string;

    constructor(dir: string, name: string) {
        this.path = typeof dir === 'string' ? `${dir}/${name}` : `${dir.toString()}/${name}`;
        this.name = name;
    }

    // Mock info method
    async info(): Promise<{ exists: boolean; size?: number; modificationTime?: number }> {
        return {
            exists: this.path in mockFileSystem,
            size: mockFileSystem[this.path]?.length,
            modificationTime: Date.now(),
        };
    }

    // Mock text method
    async text(): Promise<string> {
        if (!(this.path in mockFileSystem)) {
            throw new Error(`File not found: ${this.path}`);
        }
        return mockFileSystem[this.path];
    }

    // Mock write method
    async write(content: string): Promise<void> {
        mockFileSystem[this.path] = content;
    }

    // Mock delete method
    async delete(): Promise<void> {
        delete mockFileSystem[this.path];
    }

    // Mock move method
    async move(dest: File): Promise<void> {
        if (this.path in mockFileSystem) {
            mockFileSystem[dest.path] = mockFileSystem[this.path];
            delete mockFileSystem[this.path];
        }
    }

    // Mock copy method
    async copy(dest: File): Promise<void> {
        if (this.path in mockFileSystem) {
            mockFileSystem[dest.path] = mockFileSystem[this.path];
        }
    }

    // Mock toString method
    toString(): string {
        return this.path;
    }
}

// Mock other expo-file-system functions
const documentDirectory = '/mock/documents';
const cacheDirectory = '/mock/cache';
const bundleDirectory = '/mock/bundle';
const mainBundlePath = '/mock/main.bundle';
const readAsStringAsync = async (uri: string): Promise<string> => {
    if (uri in mockFileSystem) {
        return mockFileSystem[uri];
    }
    throw new Error(`File not found: ${uri}`);
};
const writeAsStringAsync = async (uri: string, content: string): Promise<void> => {
    mockFileSystem[uri] = content;
};
const deleteAsync = async (uri: string): Promise<void> => {
    delete mockFileSystem[uri];
};
const copyAsync = async (options: { from: string; to: string }): Promise<void> => {
    if (options.from in mockFileSystem) {
        mockFileSystem[options.to] = mockFileSystem[options.from];
    }
};
const moveAsync = async (options: { from: string; to: string }): Promise<void> => {
    if (options.from in mockFileSystem) {
        mockFileSystem[options.to] = mockFileSystem[options.from];
        delete mockFileSystem[options.from];
    }
};
const makeDirectoryAsync = async (uri: string, options?: { intermediates?: boolean }): Promise<void> => {
    // Do nothing for mock
};
const deleteDirectoryAsync = async (uri: string, options?: { idempotent?: boolean; recursive?: boolean }): Promise<void> => {
    // Do nothing for mock
};
const readDirectoryAsync = async (uri: string): Promise<string[]> => {
    return [];
};
const getInfoAsync = async (uri: string): Promise<{ exists: boolean; size?: number; modificationTime?: number }> => {
    return {
        exists: uri in mockFileSystem,
        size: mockFileSystem[uri]?.length,
        modificationTime: Date.now(),
    };
};

// Export all mock functions using CommonJS syntax
module.exports = {
    File,
    Directory,
    Paths,
    documentDirectory,
    cacheDirectory,
    bundleDirectory,
    mainBundlePath,
    readAsStringAsync,
    writeAsStringAsync,
    deleteAsync,
    copyAsync,
    moveAsync,
    makeDirectoryAsync,
    deleteDirectoryAsync,
    readDirectoryAsync,
    getInfoAsync,
};

// Also export as named exports for TypeScript compatibility
module.exports.default = module.exports;