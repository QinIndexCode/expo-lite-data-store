import {
  createTable,
  deleteTable,
  hasTable,
  insert,
  overwrite,
  read,
  update,
  bulkWrite,
  db,
} from '../../expo-lite-data-store';

type LooseRecord = Record<string, unknown>;
type LooseUpdatePayload = Parameters<typeof update>[1];
type LooseUpdateOptions = Parameters<typeof update>[2];
type LooseBulkData = Parameters<typeof bulkWrite>[1][number];

const asCast = <T>(value: unknown): T => value as T;

describe('reserved envelope field names at the public surface', () => {
  const TEST_TABLE = 'reserved_envelope_test_table';

  beforeEach(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
    await createTable(TEST_TABLE);
  });

  afterAll(async () => {
    if (await hasTable(TEST_TABLE)) {
      await deleteTable(TEST_TABLE);
    }
  });

  it('rejects __enc and __enc_bulk on every public write entry before storage is touched', async () => {
    await expect(insert(TEST_TABLE, { id: 1, __enc: 'boom' })).rejects.toMatchObject({
      code: 'FILE_CONTENT_INVALID',
    });
    await expect(overwrite(TEST_TABLE, [{ id: 2, __enc_bulk: 'boom' }])).rejects.toMatchObject({
      code: 'FILE_CONTENT_INVALID',
    });
    await expect(
      update(
        TEST_TABLE,
        asCast<LooseUpdatePayload>({ __enc: 'boom' }),
        asCast<LooseUpdateOptions>({ where: { id: 1 } })
      )
    ).rejects.toMatchObject({ code: 'FILE_CONTENT_INVALID' });
    await expect(
      bulkWrite(TEST_TABLE, asCast<LooseBulkData[]>([{ type: 'insert', data: { id: 3, __enc: 'boom' } }]))
    ).rejects.toMatchObject({ code: 'FILE_CONTENT_INVALID' });
    await expect(
      bulkWrite(
        TEST_TABLE,
        asCast<LooseBulkData[]>([{ type: 'update', data: { $set: { __enc: 'boom' } }, where: { id: 1 } }])
      )
    ).rejects.toMatchObject({ code: 'FILE_CONTENT_INVALID' });

    // Nothing reached storage, so no envelope-looking record can poison a
    // later encrypted-surface read of the table.
    expect(await read(TEST_TABLE)).toHaveLength(0);
  });

  it('rejects reserved names in createTable initialData without creating the table', async () => {
    const table = `${TEST_TABLE}_init`;
    try {
      await expect(createTable(table, { initialData: [{ id: 1, __enc: 'boom' }] })).rejects.toMatchObject({
        code: 'FILE_CONTENT_INVALID',
      });
      expect(await hasTable(table)).toBe(false);
    } finally {
      if (await hasTable(table)) {
        await deleteTable(table);
      }
    }
  });

  it('rejects reserved createTable initialData on an already existing table', async () => {
    // The facade scan fires before the adapter in every case, including an
    // existing table where the adapter would discard initialData without a write.
    await expect(createTable(TEST_TABLE, { initialData: [{ id: 1, __enc: 'boom' }] })).rejects.toMatchObject({
      code: 'FILE_CONTENT_INVALID',
    });
    expect(await hasTable(TEST_TABLE)).toBe(true);
    expect(await read(TEST_TABLE)).toHaveLength(0);
  });

  it('still accepts ordinary fields shaped like the check', async () => {
    await expect(
      insert(TEST_TABLE, asCast<LooseRecord>({ id: 9, encoding: 'utf-8', dollar: '$set' }))
    ).resolves.toBeDefined();
    expect(await read(TEST_TABLE)).toHaveLength(1);
  });

  it('rejects reserved fields through the db.* object surface', async () => {
    await expect(db.insert(TEST_TABLE, { id: 11, __enc: 'boom' })).rejects.toMatchObject({
      code: 'FILE_CONTENT_INVALID',
    });
    await expect(
      db.update(
        TEST_TABLE,
        asCast<LooseUpdatePayload>({ $set: { __enc_bulk: 'boom' } }),
        asCast<LooseUpdateOptions>({ where: { id: 11 } })
      )
    ).rejects.toMatchObject({ code: 'FILE_CONTENT_INVALID' });
    expect(await read(TEST_TABLE)).toHaveLength(0);
  });

  it('validates payload shape before resolving the storage surface', async () => {
    // Facade validation wins over surface/policy resolution: the reserved field
    // is reported even though the write also selects the encrypted surface.
    await expect(insert(TEST_TABLE, { id: 12, __enc: 'boom' }, { encrypted: true })).rejects.toMatchObject({
      code: 'FILE_CONTENT_INVALID',
    });
  });
});
