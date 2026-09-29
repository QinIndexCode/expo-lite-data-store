import { MetadataManager } from '../../meta/MetadataManager';
import { SQLiteStorageAdapter } from '../SQLiteStorageAdapter';

type SQLitePrivateAccess = {
  readPersistedRecordsOrEmpty: (tableName: string) => Promise<unknown[]>;
  sqlTxDepth: number;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const DATABASE_NAME = 'sqlite-concurrency-test.db';

const getGlobalSqliteMockState = (): { databases: Record<string, unknown[]> } =>
  (global as unknown as { __expo_sqlite_mock__: { databases: Record<string, unknown[]> } }).__expo_sqlite_mock__;

const createAdapter = (metadataManager: MetadataManager): SQLiteStorageAdapter =>
  new SQLiteStorageAdapter(metadataManager, { databaseName: DATABASE_NAME });

const createDeferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

const tick = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

type RowRecord = {
  id: number;
  name: string;
  profile: { city: string };
};

describe('SQLiteStorageAdapter - update concurrency', () => {
  let adapter: SQLiteStorageAdapter;
  let metadataManager: MetadataManager;
  const tableName = 'test_sqlite_update_concurrency';

  beforeEach(async () => {
    metadataManager = new MetadataManager();
    adapter = createAdapter(metadataManager);
    await adapter.createTable(tableName, {
      initialData: [
        { id: 1, name: 'alpha', profile: { city: 'rome' } },
        { id: 2, name: 'beta', profile: { city: 'paris' } },
      ],
    });
  });

  afterEach(async () => {
    try {
      await adapter.deleteTable(tableName);
    } catch {
      // The table may not exist after a failed setup.
    }

    await adapter.cleanup();
    metadataManager.cleanup();
    delete getGlobalSqliteMockState().databases[DATABASE_NAME];
    jest.restoreAllMocks();
  });

  // The `profile: { city }` filter is a plain object value, so the query
  // builder refuses pushdown and update()/delete() take the read-modify-
  // replace fallback path — the path whose read must share the write's
  // SQL transaction.
  const cityFilter = { profile: { city: 'rome' } };

  const gateFallbackRead = (): {
    readEntered: Deferred;
    releaseRead: Deferred;
    readCalls: () => number;
  } => {
    const internals = adapter as unknown as SQLitePrivateAccess;
    const originalRead = internals.readPersistedRecordsOrEmpty.bind(internals);
    const readEntered = createDeferred();
    const releaseRead = createDeferred();
    let calls = 0;

    jest.spyOn(internals, 'readPersistedRecordsOrEmpty').mockImplementation(async (name: string) => {
      calls += 1;
      if (calls === 1) {
        readEntered.resolve();
        await releaseRead.promise;
      }
      return originalRead(name);
    });

    return { readEntered, releaseRead, readCalls: () => calls };
  };

  it('runs the fallback read inside the write transaction and queues a concurrent insert behind it', async () => {
    const internals = adapter as unknown as SQLitePrivateAccess;
    const { readEntered, releaseRead } = gateFallbackRead();

    const update = adapter.update<RowRecord>(tableName, { name: 'updated' }, cityFilter);
    await readEntered.promise;

    // The RMW read must be inside the SQL transaction: at this point the
    // transaction wrapper has already issued BEGIN.
    expect(internals.sqlTxDepth).toBe(1);

    let insertSettled = false;
    const insert = adapter
      .insert<RowRecord>(tableName, { id: 99, name: 'gamma', profile: { city: 'oslo' } })
      .then(result => {
        insertSettled = true;
        return result;
      });

    await tick(20);
    expect(insertSettled).toBe(false);

    releaseRead.resolve();
    await Promise.all([update, insert]);

    const rows = await adapter.read<RowRecord>(tableName);
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.id === 1)?.name).toBe('updated');
    expect(rows.find(row => row.id === 99)?.name).toBe('gamma');
  });

  it('queues a concurrent delete behind an in-flight update', async () => {
    const { readEntered, releaseRead } = gateFallbackRead();

    const update = adapter.update<RowRecord>(tableName, { name: 'updated' }, cityFilter);
    await readEntered.promise;

    let deleteSettled = false;
    const removal = adapter.delete<RowRecord>(tableName, { profile: { city: 'paris' } }).then(result => {
      deleteSettled = true;
      return result;
    });

    await tick(20);
    expect(deleteSettled).toBe(false);

    releaseRead.resolve();
    const [, removed] = await Promise.all([update, removal]);
    expect(removed).toBe(1);

    const rows = await adapter.read<RowRecord>(tableName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, name: 'updated' });
  });
});
