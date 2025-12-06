// __mocks__/expo-file-system.ts
// Mock implementation for expo-file-system
// zh：
// Mock file system data
const mockFileSystem: Record<string, any> = {};

// Mock directory contents
const mockDirectories: Record<string, string[]> = {};

// Mock EncodingType enum
enum EncodingType {
  UTF8 = 'utf8',
  Base64 = 'base64',
  Base64WebSafe = 'base64web-safe',
  UTF16 = 'utf16',
}

// Mock makeDirectoryAsync function
const makeDirectoryAsync = async (uri: string, options?: { intermediates?: boolean }): Promise<void> => {
  // Simple mock implementation that creates a directory entry
  mockFileSystem[uri] = { type: 'directory' };
  if (!mockDirectories[uri]) {
    mockDirectories[uri] = [];
  }
};

// Mock readDirectoryAsync function
const readDirectoryAsync = async (uri: string): Promise<string[]> => {
  // Simple mock implementation that returns directory contents
  return mockDirectories[uri] || [];
};

// Mock writeAsStringAsync function
const writeAsStringAsync = async (
  uri: string,
  contents: string,
  options?: { encoding?: EncodingType }
): Promise<void> => {
  // Simple mock implementation that writes file content
  mockFileSystem[uri] = { type: 'file', content: contents };

  // Add to directory contents if not already present
  const directoryUri = uri.substring(0, uri.lastIndexOf('/') + 1);
  const fileName = uri.substring(uri.lastIndexOf('/') + 1);
  if (!mockDirectories[directoryUri]) {
    mockDirectories[directoryUri] = [];
  }
  if (!mockDirectories[directoryUri].includes(fileName)) {
    mockDirectories[directoryUri].push(fileName);
  }
};

// Mock readAsStringAsync function
const readAsStringAsync = async (uri: string, options?: { encoding?: EncodingType }): Promise<string> => {
  // Simple mock implementation that returns file content
  if (!mockFileSystem[uri] || mockFileSystem[uri].type !== 'file') {
    throw new Error(`File not found: ${uri}`);
  }
  return mockFileSystem[uri].content;
};

// Mock deleteAsync function
const deleteAsync = async (uri: string, options?: { idempotent?: boolean }): Promise<void> => {
  // Simple mock implementation that deletes file or directory
  delete mockFileSystem[uri];
  delete mockDirectories[uri];

  // Also remove from parent directory contents if it's a file
  const directoryUri = uri.substring(0, uri.lastIndexOf('/') + 1);
  const fileName = uri.substring(uri.lastIndexOf('/') + 1);
  if (mockDirectories[directoryUri]) {
    mockDirectories[directoryUri] = mockDirectories[directoryUri].filter(name => name !== fileName);
  }
};

// Mock moveAsync function
const moveAsync = async (options: { from: string; to: string }): Promise<void> => {
  // Simple mock implementation that moves file or directory
  const { from, to } = options;
  if (mockFileSystem[from]) {
    mockFileSystem[to] = mockFileSystem[from];
    delete mockFileSystem[from];

    // Also update directory contents
    const fromDirUri = from.substring(0, from.lastIndexOf('/') + 1);
    const toDirUri = to.substring(0, to.lastIndexOf('/') + 1);
    const fromFileName = from.substring(from.lastIndexOf('/') + 1);
    const toFileName = to.substring(to.lastIndexOf('/') + 1);

    if (mockDirectories[fromDirUri]) {
      mockDirectories[fromDirUri] = mockDirectories[fromDirUri].filter(name => name !== fromFileName);
    }

    if (!mockDirectories[toDirUri]) {
      mockDirectories[toDirUri] = [];
    }
    if (!mockDirectories[toDirUri].includes(toFileName)) {
      mockDirectories[toDirUri].push(toFileName);
    }
  }
};

// Mock getInfoAsync function
const getInfoAsync = async (
  uri: string,
  options?: { size?: boolean; md5?: boolean; mtime?: boolean; ctime?: boolean }
): Promise<any> => {
  // Simple mock implementation that returns file/directory info
  const exists = !!mockFileSystem[uri];
  return {
    exists,
    uri,
    type: exists ? mockFileSystem[uri].type : 'file',
    size: exists && mockFileSystem[uri].type === 'file' ? mockFileSystem[uri].content.length : 0,
  };
};

// Mock documentDirectory
const documentDirectory = '/mock/documents/';

// Export all mock functions and constants using CommonJS syntax
module.exports = {
  EncodingType,
  makeDirectoryAsync,
  readDirectoryAsync,
  writeAsStringAsync,
  readAsStringAsync,
  deleteAsync,
  moveAsync,
  getInfoAsync,
  documentDirectory,
};

// Also export as named exports for TypeScript compatibility
module.exports.default = module.exports;
