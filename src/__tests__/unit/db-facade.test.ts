import { db, decrypt, deleteTable, encrypt, findOne, hasTable, hash, insert } from '../../expo-lite-data-store';
import logger from '../../utils/logger';

describe('db facade', () => {
  const tableName = 'db_facade_users';

  beforeEach(async () => {
    await db.init();

    if (await hasTable(tableName)) {
      await deleteTable(tableName);
    }
  });

  afterAll(async () => {
    if (await hasTable(tableName)) {
      await deleteTable(tableName);
    }
  });

  it('supports idempotent init and shares the same behavior as the function API', async () => {
    await db.init();
    await db.init();

    await db.createTable(tableName);
    await db.insert(tableName, { id: '1', name: 'Alice' });

    const viaFacade = await db.findOne(tableName, { where: { id: '1' } });
    const viaFunction = await findOne(tableName, { where: { id: '1' } });

    expect(viaFacade).toEqual(viaFunction);

    const secondInsert = await insert(tableName, { id: '2', name: 'Bob' });
    expect(secondInsert.written).toBe(1);
  });

  it('re-exports crypto helpers from the top-level package', async () => {
    const encrypted = await encrypt('hello facade', 'master-key');
    const decrypted = await decrypt(encrypted, 'master-key');
    const digest = await hash('hello facade');

    expect(decrypted).toBe('hello facade');
    expect(digest).toBeTruthy();
  });

  it('warns once when TableOptions.engine is passed to a per-table API', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      await db.countTable(tableName, { engine: 'sqlite' });
      await db.countTable(tableName, { engine: 'sqlite' });

      const engineWarnings = warnSpy.mock.calls.filter(call =>
        String(call[0]).includes('TableOptions.engine is ignored')
      );
      expect(engineWarnings).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
