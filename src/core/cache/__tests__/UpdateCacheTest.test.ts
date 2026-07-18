import { createTable, insert, read, update, findOne, deleteTable } from '../../../expo-lite-data-store';

describe('cache invalidation after updates', () => {
  const TABLE_NAME = 'test_update_cache';
  const deleteTestTable = async (): Promise<void> => {
    await deleteTable(TABLE_NAME).catch(() => undefined);
  };

  beforeEach(async () => {
    await deleteTestTable();

    await createTable(TABLE_NAME, {
      columns: {
        id: 'number',
        name: 'string',
        value: 'number',
      },
    });
  });

  afterEach(async () => {
    await deleteTestTable();
  });

  it('returns updated records after a cached read', async () => {
    await insert(TABLE_NAME, {
      id: 1,
      name: 'Test Item',
      value: 100,
    });

    const data1 = await read(TABLE_NAME);
    expect(data1.length).toBe(1);
    expect(data1[0].value).toBe(100);

    const updatedCount = await update(TABLE_NAME, { value: 200 }, { where: { id: 1 } });
    expect(updatedCount).toBe(1);

    const data2 = await read(TABLE_NAME);
    expect(data2.length).toBe(1);
    expect(data2[0].value).toBe(200);

    const item = await findOne(TABLE_NAME, { where: { id: 1 } });
    expect(item).not.toBeNull();
    expect(item?.value).toBe(200);
  });

  it('returns the latest value after repeated updates and reads', async () => {
    await insert(TABLE_NAME, {
      id: 2,
      name: 'Test Item 2',
      value: 50,
    });

    for (let i = 0; i < 5; i++) {
      const newValue = 60 + i;

      const updatedCount = await update(TABLE_NAME, { value: newValue }, { where: { id: 2 } });
      expect(updatedCount).toBe(1);

      const data = await read(TABLE_NAME);
      expect(data[0].value).toBe(newValue);

      const item = await findOne(TABLE_NAME, { where: { id: 2 } });
      expect(item?.value).toBe(newValue);
    }
  });

  it('keeps query results current across query shapes after an update', async () => {
    await insert(TABLE_NAME, [
      { id: 3, name: 'Item A', value: 10 },
      { id: 4, name: 'Item B', value: 20 },
      { id: 5, name: 'Item C', value: 30 },
    ]);

    await read(TABLE_NAME);
    await findOne(TABLE_NAME, { where: { name: 'Item A' } });
    await findOne(TABLE_NAME, { where: { name: 'Item B' } });

    await update(TABLE_NAME, { value: 100 }, { where: { id: 3 } });

    const allData2 = await read(TABLE_NAME);
    expect(allData2.find(item => item.id === 3)?.value).toBe(100);

    const itemA2 = await findOne(TABLE_NAME, { where: { name: 'Item A' } });
    expect(itemA2?.value).toBe(100);

    const itemB2 = await findOne(TABLE_NAME, { where: { name: 'Item B' } });
    expect(itemB2?.value).toBe(20);
  });
});
