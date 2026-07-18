import { createTable, insert, read, update, findOne, remove } from '../../expo-lite-data-store';
import { plainStorage } from '../../core/db';
import { resetMasterKey } from '../../utils/crypto';

describe('encryption parameters', () => {
  const TABLE_NAME = 'test_encryption_params';
  const SENSITIVE_TABLE = 'test_sensitive_data';

  const cleanupTestTables = async (): Promise<void> => {
    await plainStorage.deleteTable(TABLE_NAME).catch(() => undefined);
    await plainStorage.deleteTable(SENSITIVE_TABLE).catch(() => undefined);
  };

  beforeEach(async () => {
    await cleanupTestTables();
    await resetMasterKey();
  });

  afterEach(async () => {
    await cleanupTestTables();
    await resetMasterKey();
  });

  it('supports unencrypted operations without authentication', async () => {
    await createTable(TABLE_NAME, {
      columns: {
        id: 'number',
        name: 'string',
        value: 'number',
      },
    });

    await insert(TABLE_NAME, {
      id: 1,
      name: 'Test Item',
      value: 100,
    });

    const data = await read(TABLE_NAME);
    expect(data.length).toBe(1);
    expect(data[0].value).toBe(100);

    await update(TABLE_NAME, { value: 200 }, { where: { id: 1 } });
    const updatedData = await read(TABLE_NAME, {});
    expect(updatedData[0].value).toBe(200);

    const foundItem = await findOne(TABLE_NAME, { where: { id: 1 } });
    expect(foundItem?.value).toBe(200);

    await remove(TABLE_NAME, { where: { id: 1 } });
    const emptyData = await read(TABLE_NAME, {});
    expect(emptyData.length).toBe(0);
  });

  it('supports encrypted operations without authentication', async () => {
    await createTable(SENSITIVE_TABLE, {
      columns: {
        id: 'number',
        username: 'string',
        password: 'string',
      },
      encrypted: true,
    });

    await insert(
      SENSITIVE_TABLE,
      {
        id: 1,
        username: 'test_user',
        password: 'secure_password',
      },
      { encrypted: true }
    );

    const data = await read(SENSITIVE_TABLE, { encrypted: true });
    expect(data.length).toBe(1);
    expect(data[0].username).toBe('test_user');
    expect(data[0].password).toBe('secure_password');

    await update(SENSITIVE_TABLE, { password: 'new_secure_password' }, { where: { id: 1 }, encrypted: true });
    const updatedData = await read(SENSITIVE_TABLE, { encrypted: true });
    expect(updatedData[0].password).toBe('new_secure_password');

    const foundItem = await findOne(SENSITIVE_TABLE, { where: { id: 1 }, encrypted: true });
    expect(foundItem?.username).toBe('test_user');
  });

  it('supports encrypted operations that require authentication', async () => {
    await createTable(SENSITIVE_TABLE, {
      columns: {
        id: 'number',
        credit_card: 'string',
        cvv: 'string',
      },
      encrypted: true,
      requireAuthOnAccess: true,
    });

    await insert(
      SENSITIVE_TABLE,
      {
        id: 1,
        credit_card: '1234-5678-9012-3456',
        cvv: '123',
      },
      { encrypted: true, requireAuthOnAccess: true }
    );

    const data = await read(SENSITIVE_TABLE, { encrypted: true, requireAuthOnAccess: true });
    expect(data.length).toBe(1);
    expect(data[0].credit_card).toBe('1234-5678-9012-3456');
    expect(data[0].cvv).toBe('123');

    await remove(SENSITIVE_TABLE, { where: { id: 1 }, encrypted: true, requireAuthOnAccess: true });
    const emptyData = await read(SENSITIVE_TABLE, { encrypted: true, requireAuthOnAccess: true });
    expect(emptyData.length).toBe(0);
  });

  it('keeps encrypted and unencrypted tables independent', async () => {
    await createTable(TABLE_NAME, {
      columns: {
        id: 'number',
        name: 'string',
      },
    });

    await createTable(SENSITIVE_TABLE, {
      columns: {
        id: 'number',
        secret: 'string',
      },
      encrypted: true,
    });

    await insert(TABLE_NAME, { id: 1, name: 'Public Item' });

    await insert(SENSITIVE_TABLE, { id: 1, secret: 'Hidden Secret' }, { encrypted: true });

    const publicData = await read(TABLE_NAME);
    expect(publicData.length).toBe(1);
    expect(publicData[0].name).toBe('Public Item');

    const privateData = await read(SENSITIVE_TABLE, { encrypted: true });
    expect(privateData.length).toBe(1);
    expect(privateData[0].secret).toBe('Hidden Secret');
  });
});
