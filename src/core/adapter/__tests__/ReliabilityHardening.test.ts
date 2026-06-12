import { MetadataManager } from '../../meta/MetadataManager';
import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';

describe('FileSystemStorageAdapter reliability hardening', () => {
  let adapter: FileSystemStorageAdapter;
  let metadataManager: MetadataManager;

  beforeEach(() => {
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);
  });

  afterEach(async () => {
    await adapter.cleanup();
    metadataManager.cleanup();
  });

  it('rejects traversal and path-like table names at the storage boundary', async () => {
    await expect(adapter.createTable('../outside')).rejects.toMatchObject({ code: 'TABLE_NAME_INVALID' });
    await expect(adapter.hasTable('nested/table')).rejects.toMatchObject({ code: 'TABLE_NAME_INVALID' });
    await expect(adapter.read('C:\\outside')).rejects.toMatchObject({ code: 'TABLE_NAME_INVALID' });
  });

  it('preserves the corrupted-data error code through the public adapter', async () => {
    await adapter.createTable('corrupted_table', { initialData: [{ id: 1, value: 'original' }] });

    const filePath = '/mock/documents/lite-data-store/corrupted_table.ldb';
    const fileSystem = (global as any).__expo_file_system_mock__.mockFileSystem;
    const parsed = JSON.parse(fileSystem[filePath]);
    parsed.data[0].value = 'tampered';
    fileSystem[filePath] = JSON.stringify(parsed);

    await expect(adapter.read('corrupted_table', { bypassCache: true })).rejects.toMatchObject({
      code: 'CORRUPTED_DATA',
    });
    await adapter.deleteTable('corrupted_table');
  });

  it('restores all touched tables when a transaction commit fails partway through', async () => {
    await adapter.createTable('transaction_a', { initialData: [{ id: 1, value: 'a-original' }] });
    await adapter.createTable('transaction_b', { initialData: [{ id: 1, value: 'b-original' }] });

    await adapter.beginTransaction();
    await adapter.overwrite('transaction_a', [{ id: 1, value: 'a-updated' }]);
    await adapter.overwrite('transaction_b', [{ id: 1, value: 'b-updated' }]);

    const dataWriter = (adapter as any).dataWriter;
    const originalWrite = dataWriter.write.bind(dataWriter);
    let writeCalls = 0;
    const writeSpy = jest.spyOn(dataWriter, 'write').mockImplementation(async (...args: any[]) => {
      writeCalls++;
      if (writeCalls === 2) {
        throw new Error('injected second-table commit failure');
      }
      return originalWrite(...args);
    });

    await expect(adapter.commit()).rejects.toMatchObject({ code: 'FILE_WRITE_FAILED' });
    writeSpy.mockRestore();

    await expect(adapter.read('transaction_a', { bypassCache: true })).resolves.toEqual([
      { id: 1, value: 'a-original' },
    ]);
    await expect(adapter.read('transaction_b', { bypassCache: true })).resolves.toEqual([
      { id: 1, value: 'b-original' },
    ]);

    await adapter.deleteTable('transaction_a');
    await adapter.deleteTable('transaction_b');
  });
});
