import {
  db,
  decrypt,
  deleteTable,
  encrypt,
  findOne,
  hasTable,
  hash,
  insert,
} from '../../expo-lite-data-store';

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
});
