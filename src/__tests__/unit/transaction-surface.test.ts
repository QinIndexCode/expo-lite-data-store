/// <reference path="../test-globals.d.ts" />

import {
  createTable,
  insert,
  update,
  hasTable,
  deleteTable,
  beginTransaction,
  commit,
  rollback,
} from '../../expo-lite-data-store';

type UserRecord = { id: number; name: string };

describe('transaction surface single-transaction guard', () => {
  const TEST_TABLE = 'transaction_surface_guard';

  const cleanupTable = async (): Promise<void> => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  };

  beforeEach(async () => {
    await cleanupTable();
    await createTable(TEST_TABLE);
  });

  afterEach(async () => {
    // A failed assertion must not leave the facade locked for later tests.
    try {
      await rollback();
    } catch {
      // No active transaction; nothing to roll back.
    }
    await cleanupTable();
  });

  it('rejects a second begin even across different adapter surfaces', async () => {
    // encrypted: true resolves a different adapter instance than the default
    // plain one, so per-adapter guards alone cannot see the active transaction.
    await beginTransaction({ encrypted: true });

    await expect(beginTransaction({})).rejects.toMatchObject({
      code: 'TRANSACTION_IN_PROGRESS',
    });
    await expect(beginTransaction({ encrypted: true })).rejects.toMatchObject({
      code: 'TRANSACTION_IN_PROGRESS',
    });

    await rollback({ encrypted: true });
  });

  it('rejects a plain begin while an encrypted transaction is active', async () => {
    await beginTransaction({ encrypted: true });

    await expect(beginTransaction({})).rejects.toThrow('Transaction already in progress');

    await rollback({ encrypted: true });
  });

  it('allows a new transaction after commit', async () => {
    await beginTransaction({});
    await insert(TEST_TABLE, { id: 1, name: 'First' });
    await commit({});

    await beginTransaction({});
    await insert(TEST_TABLE, { id: 2, name: 'Second' });
    await commit({});

    const rows = await update<UserRecord>(TEST_TABLE, { name: 'Renamed' }, { where: { id: 2 } });
    expect(rows).toBeGreaterThanOrEqual(0);
  });

  it('allows a new transaction after rollback', async () => {
    await beginTransaction({});
    await insert(TEST_TABLE, { id: 1, name: 'Discarded' });
    await rollback({});

    await beginTransaction({});
    await insert(TEST_TABLE, { id: 2, name: 'Kept' });
    await commit({});

    const rows = await update<UserRecord>(TEST_TABLE, { name: 'Renamed' }, { where: { id: 2 } });
    expect(rows).toBeGreaterThanOrEqual(0);
  });

  it('rejects concurrent begin calls racing on the same surface', async () => {
    const first = beginTransaction({});
    const second = beginTransaction({});

    const settled = await Promise.allSettled([first, second]);
    const fulfilled = settled.filter(entry => entry.status === 'fulfilled');
    const rejected = settled.filter(entry => entry.status === 'rejected');

    // Exactly one caller may win the race; the loser sees the facade guard.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'TRANSACTION_IN_PROGRESS',
    });

    await commit({});
  });

  it('rejects security options that do not match the active transaction', async () => {
    await beginTransaction({ encrypted: true });

    await expect(insert(TEST_TABLE, { id: 1, name: 'x' }, { encrypted: false })).rejects.toThrow(
      'Transaction security options must match the active transaction'
    );

    await rollback({ encrypted: true });
  });
});
