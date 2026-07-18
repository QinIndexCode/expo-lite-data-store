import { MetadataManager } from '../../meta/MetadataManager';
import { DataReader } from '../../data/DataReader';
import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';

type AdapterPrivateAccess = {
  dataReader: DataReader;
};

const getAdapterPrivateAccess = (adapter: FileSystemStorageAdapter): AdapterPrivateAccess =>
  adapter as unknown as AdapterPrivateAccess;

describe('FileSystemStorageAdapter - concurrent append writes', () => {
  let adapter: FileSystemStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'test_concurrent_append_writes';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);
    await adapter.createTable(tableName);
  });

  afterEach(async () => {
    try {
      await adapter.deleteTable(tableName);
    } catch {
      // The table may not exist after a failed setup.
    }

    await adapter.cleanup();

    if (metadataManager) {
      metadataManager.cleanup();
    }
  });

  it('preserves concurrent inserts without adapter-level pre-read merging', async () => {
    const adapterInternals = getAdapterPrivateAccess(adapter);
    const dataReaderReadSpy = jest.spyOn(adapterInternals.dataReader, 'read').mockResolvedValue([]);

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        adapter.insert(tableName, {
          id: `concurrent-${index}`,
          label: `user-${index}`,
        })
      )
    );

    expect(dataReaderReadSpy).not.toHaveBeenCalled();
    expect(results.every(result => result.written === 1)).toBe(true);

    const count = await adapter.count(tableName);
    expect(count).toBe(25);

    const verify = await adapter.verifyCount(tableName);
    expect(verify).toEqual({
      metadata: 25,
      actual: 25,
      match: true,
    });
  });
});
