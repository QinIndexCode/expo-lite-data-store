import { MetadataManager } from '../../meta/MetadataManager';
import { DataReader } from '../../data/DataReader';
import { DataWriter } from '../../data/DataWriter';
import { FileSystemStorageAdapter } from '../FileSystemStorageAdapter';

type AdapterPrivateAccess = {
  dataReader: DataReader;
  dataWriter: DataWriter;
};

const getAdapterPrivateAccess = (adapter: FileSystemStorageAdapter): AdapterPrivateAccess =>
  adapter as unknown as AdapterPrivateAccess;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const createDeferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

const tick = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

describe('FileSystemStorageAdapter - concurrent read-modify-write cycles', () => {
  let adapter: FileSystemStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'test_update_concurrency';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    adapter = new FileSystemStorageAdapter(metadataManager);
    await adapter.createTable(tableName);
    await adapter.insert(tableName, [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]);
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
    jest.restoreAllMocks();
  });

  it('serializes concurrent updates so neither is erased by a stale overwrite', async () => {
    const adapterInternals = getAdapterPrivateAccess(adapter);
    const originalRead = adapterInternals.dataReader.read.bind(adapterInternals.dataReader);
    const firstReadEntered = createDeferred();
    const releaseFirstRead = createDeferred();
    let readCalls = 0;

    jest.spyOn(adapterInternals.dataReader, 'read').mockImplementation((...args: Parameters<DataReader['read']>) => {
      readCalls += 1;
      if (readCalls === 1) {
        firstReadEntered.resolve();
        return releaseFirstRead.promise.then(() => originalRead(...args));
      }
      return originalRead(...args);
    });

    const firstUpdate = adapter.update(tableName, { name: 'first' }, { id: 1 });
    await firstReadEntered.promise;

    const secondUpdate = adapter.update(tableName, { name: 'second' }, { id: 2 });
    await tick(20);

    // The second update must queue behind the first update's table lock
    // instead of reading a snapshot that predates the first write.
    expect(readCalls).toBe(1);

    releaseFirstRead.resolve();
    const [firstCount, secondCount] = await Promise.all([firstUpdate, secondUpdate]);
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);

    const rows = await adapter.read<{ id: number; name: string }>(tableName);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === 1)?.name).toBe('first');
    expect(rows.find(row => row.id === 2)?.name).toBe('second');
  });

  it('does not erase a concurrent append that lands during an update', async () => {
    const adapterInternals = getAdapterPrivateAccess(adapter);
    const originalWrite = adapterInternals.dataWriter.write.bind(adapterInternals.dataWriter);
    const updateAboutToWrite = createDeferred();
    const releaseUpdateWrite = createDeferred();
    let overwriteGated = false;

    jest.spyOn(adapterInternals.dataWriter, 'write').mockImplementation((...args: Parameters<DataWriter['write']>) => {
      const options = args[2];
      if (!overwriteGated && options?.mode === 'overwrite') {
        overwriteGated = true;
        updateAboutToWrite.resolve();
        return releaseUpdateWrite.promise.then(() => originalWrite(...args));
      }
      return originalWrite(...args);
    });

    const update = adapter.update(tableName, { name: 'updated' }, { id: 1 });
    await updateAboutToWrite.promise;

    let insertSettled = false;
    const insert = adapter.insert(tableName, { id: 99, name: 'inserted' }).then(result => {
      insertSettled = true;
      return result;
    });
    await tick(20);

    // The append must queue behind the in-flight update instead of landing
    // between its read and its stale overwrite, where it would be erased.
    expect(insertSettled).toBe(false);

    releaseUpdateWrite.resolve();
    await Promise.all([update, insert]);

    const rows = await adapter.read<{ id: number; name: string }>(tableName);
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.id === 1)?.name).toBe('updated');
    expect(rows.find(row => row.id === 99)?.name).toBe('inserted');
  });

  it('does not resurrect a concurrent delete that lands during an update', async () => {
    const adapterInternals = getAdapterPrivateAccess(adapter);
    const originalWrite = adapterInternals.dataWriter.write.bind(adapterInternals.dataWriter);
    const updateAboutToWrite = createDeferred();
    const releaseUpdateWrite = createDeferred();
    let overwriteGated = false;

    jest.spyOn(adapterInternals.dataWriter, 'write').mockImplementation((...args: Parameters<DataWriter['write']>) => {
      const options = args[2];
      if (!overwriteGated && options?.mode === 'overwrite') {
        overwriteGated = true;
        updateAboutToWrite.resolve();
        return releaseUpdateWrite.promise.then(() => originalWrite(...args));
      }
      return originalWrite(...args);
    });

    const update = adapter.update(tableName, { name: 'updated' }, { id: 1 });
    await updateAboutToWrite.promise;

    let deleteSettled = false;
    const removal = adapter.delete(tableName, { id: 2 }).then(count => {
      deleteSettled = true;
      return count;
    });
    await tick(20);

    // The delete must queue behind the in-flight update; otherwise the stale
    // overwrite below would resurrect the deleted row.
    expect(deleteSettled).toBe(false);

    releaseUpdateWrite.resolve();
    await Promise.all([update, removal]);

    const rows = await adapter.read<{ id: number; name: string }>(tableName);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].name).toBe('updated');
  });
});
