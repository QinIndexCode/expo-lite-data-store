type MockFileEntry = { type: 'file'; content: string };
type MockDirectoryEntry = { type: 'directory' };
type MockFileSystemEntry = MockFileEntry | MockDirectoryEntry;

interface MockFileInfo {
  exists: boolean;
  uri: string;
  type: 'file' | 'directory';
  size: number;
}

const mockFileSystem: Record<string, MockFileSystemEntry> = {};

const mockDirectories: Record<string, string[]> = {};

enum EncodingType {
  UTF8 = 'utf8',
  Base64 = 'base64',
  Base64WebSafe = 'base64web-safe',
  UTF16 = 'utf16',
}

const makeDirectoryAsync = async (uri: string, _options?: { intermediates?: boolean }): Promise<void> => {
  mockFileSystem[uri] = { type: 'directory' };
  if (!mockDirectories[uri]) {
    mockDirectories[uri] = [];
  }
};

const readDirectoryAsync = async (uri: string): Promise<string[]> => {
  return mockDirectories[uri] || [];
};

const writeAsStringAsync = async (
  uri: string,
  contents: string,
  _options?: { encoding?: EncodingType }
): Promise<void> => {
  mockFileSystem[uri] = { type: 'file', content: contents };

  const directoryUri = uri.substring(0, uri.lastIndexOf('/') + 1);
  const fileName = uri.substring(uri.lastIndexOf('/') + 1);
  if (!mockDirectories[directoryUri]) {
    mockDirectories[directoryUri] = [];
  }
  if (!mockDirectories[directoryUri].includes(fileName)) {
    mockDirectories[directoryUri].push(fileName);
  }
};

const readAsStringAsync = async (uri: string, _options?: { encoding?: EncodingType }): Promise<string> => {
  if (!mockFileSystem[uri] || mockFileSystem[uri].type !== 'file') {
    throw new Error(`File not found: ${uri}`);
  }
  return mockFileSystem[uri].content;
};

const deleteAsync = async (uri: string, _options?: { idempotent?: boolean }): Promise<void> => {
  const uriPrefix = uri.endsWith('/') ? uri : uri + '/';

  for (const [fileUri] of Object.entries(mockFileSystem)) {
    if (fileUri === uri || fileUri.startsWith(uriPrefix)) {
      delete mockFileSystem[fileUri];
    }
  }

  for (const [dirUri] of Object.entries(mockDirectories)) {
    if (dirUri === uri || dirUri.startsWith(uriPrefix)) {
      delete mockDirectories[dirUri];
    }
  }

  const parentDirUri = uri.substring(0, uri.lastIndexOf('/'));
  const parentSlashIndex = parentDirUri.lastIndexOf('/');
  const actualParentDir = parentSlashIndex >= 0 ? parentDirUri.substring(0, parentSlashIndex + 1) : parentDirUri + '/';
  const name = uri.endsWith('/') ? uri.slice(0, -1).split('/').pop() : uri.split('/').pop();

  if (name && mockDirectories[actualParentDir]) {
    mockDirectories[actualParentDir] = mockDirectories[actualParentDir].filter(n => n !== name);
  }

  delete mockFileSystem[uri];
  delete mockDirectories[uri];
};

const moveAsync = async (options: { from: string; to: string }): Promise<void> => {
  const { from, to } = options;

  if (mockDirectories[from] || (mockFileSystem[from] && mockFileSystem[from].type === 'directory')) {
    if (mockFileSystem[from]) {
      mockFileSystem[to] = mockFileSystem[from];
      delete mockFileSystem[from];
    } else {
      mockFileSystem[to] = { type: 'directory' };
    }

    mockDirectories[to] = mockDirectories[from] ? [...mockDirectories[from]] : [];
    delete mockDirectories[from];

    const fromPrefix = from.endsWith('/') ? from : from + '/';
    const toPrefix = to.endsWith('/') ? to : to + '/';

    for (const [uri, value] of Object.entries(mockFileSystem)) {
      if (uri.startsWith(fromPrefix)) {
        const newUri = toPrefix + uri.substring(fromPrefix.length);
        mockFileSystem[newUri] = value;
        delete mockFileSystem[uri];
      }
    }

    for (const [dirUri, contents] of Object.entries(mockDirectories)) {
      if (dirUri.startsWith(fromPrefix) && dirUri !== from) {
        const newDirUri = toPrefix + dirUri.substring(fromPrefix.length);
        mockDirectories[newDirUri] = contents;
        delete mockDirectories[dirUri];
      }
    }
  } else if (mockFileSystem[from]) {
    mockFileSystem[to] = mockFileSystem[from];
    delete mockFileSystem[from];

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

const getInfoAsync = async (
  uri: string,
  _options?: { size?: boolean; md5?: boolean; mtime?: boolean; ctime?: boolean }
): Promise<MockFileInfo> => {
  const entry = mockFileSystem[uri];
  const exists = entry !== undefined;
  return {
    exists,
    uri,
    type: entry?.type ?? 'file',
    size: entry?.type === 'file' ? entry.content.length : 0,
  };
};

const documentDirectory = '/mock/documents/';

const expoFileSystemMock = {
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

module.exports = Object.assign(expoFileSystemMock, { default: expoFileSystemMock });
