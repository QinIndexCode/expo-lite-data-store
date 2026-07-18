import {
  createTable,
  insert,
  findOne,
  findMany,
  update,
  remove,
  deleteTable,
  hasTable,
  beginTransaction,
  commit,
  rollback,
} from '../../expo-lite-data-store';

const mockGetItemAsync = jest.fn().mockResolvedValue('mock-encrypted-key');
const mockSetItemAsync = jest.fn().mockResolvedValue(undefined);
const mockDeleteItemAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => mockGetItemAsync(),
  setItemAsync: (key: string, value: string) => mockSetItemAsync(key, value),
  deleteItemAsync: (key: string) => mockDeleteItemAsync(key),
}));

describe('enhanced encryption', () => {
  const ENCRYPTED_TABLE = 'enhanced_encrypted_table';
  const ENCRYPTED_OPTIONS = { encrypted: true } as const;
  const TEST_DATA = [
    { id: 1, name: 'User 1', age: 25, active: true, email: 'user1@example.com' },
    { id: 2, name: 'User 2', age: 30, active: false, email: 'user2@example.com' },
    { id: 3, name: 'User 3', age: 35, active: true, email: 'user3@example.com' },
  ];

  beforeEach(async () => {
    if (await hasTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS)) {
      await deleteTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS);
    }
  });

  afterAll(async () => {
    if (await hasTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS)) {
      await deleteTable(ENCRYPTED_TABLE, ENCRYPTED_OPTIONS);
    }
  });

  describe('encrypted table queries', () => {
    beforeEach(async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true,
      });
      await insert(ENCRYPTED_TABLE, TEST_DATA, { encrypted: true });
    });

    it('filters records with compound conditions', async () => {
      const users = await findMany(ENCRYPTED_TABLE, {
        where: { $and: [{ active: true }, { age: { $gt: 25 } }] },
        encrypted: true,
      });
      expect(users.length).toBe(1);
      expect(users[0].id).toBe(3);
    });

    it('sorts and paginates records', async () => {
      const users = await findMany(ENCRYPTED_TABLE, {
        where: {},
        sortBy: 'age',
        order: 'desc',
        limit: 2,
        encrypted: true,
      });
      expect(users.length).toBe(2);
      expect(users[0].age).toBe(35);
      expect(users[1].age).toBe(30);
    });

    it('updates records selected by compound conditions', async () => {
      const updatedCount = await update(
        ENCRYPTED_TABLE,
        { age: 40 },
        {
          where: { $or: [{ id: 1 }, { id: 3 }] },
          encrypted: true,
        }
      );
      expect(updatedCount).toBe(2);

      const updatedUsers = await findMany(ENCRYPTED_TABLE, {
        where: { id: { $in: [1, 3] } },
        encrypted: true,
      });
      expect(updatedUsers.every(user => user.age === 40)).toBe(true);
    });

    it('removes records selected by compound conditions', async () => {
      const removedCount = await remove(ENCRYPTED_TABLE, {
        where: { active: false },
        encrypted: true,
      });
      expect(removedCount).toBe(1);

      const remainingUsers = await findMany(ENCRYPTED_TABLE, {
        where: {},
        encrypted: true,
      });
      expect(remainingUsers.length).toBe(2);
      expect(remainingUsers.every(user => user.active === true)).toBe(true);
    });
  });

  describe('encrypted transactions', () => {
    it('commits writes on encrypted tables', async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true,
      });

      await beginTransaction(ENCRYPTED_OPTIONS);
      await insert(
        ENCRYPTED_TABLE,
        [
          { id: 1, name: 'Transaction User 1' },
          { id: 2, name: 'Transaction User 2' },
        ],
        { encrypted: true }
      );
      await commit(ENCRYPTED_OPTIONS);

      const users = await findMany(ENCRYPTED_TABLE, {
        where: {},
        encrypted: true,
      });
      expect(users.length).toBe(2);
    });

    it('rolls back writes on encrypted tables', async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true,
      });
      await insert(ENCRYPTED_TABLE, { id: 1, name: 'Initial User' }, { encrypted: true });

      await beginTransaction(ENCRYPTED_OPTIONS);
      await update(
        ENCRYPTED_TABLE,
        { name: 'Updated User' },
        {
          where: { id: 1 },
          encrypted: true,
        }
      );
      await insert(ENCRYPTED_TABLE, { id: 2, name: 'New User' }, { encrypted: true });
      await rollback(ENCRYPTED_OPTIONS);

      const users = await findMany(ENCRYPTED_TABLE, {
        where: {},
        encrypted: true,
      });
      expect(users.length).toBe(1);
      expect(users[0].name).toBe('Initial User');
    });
  });

  describe('encryption failures', () => {
    it('rejects an explicit plain-surface request for an encrypted table', async () => {
      await createTable(ENCRYPTED_TABLE, {
        encrypted: true,
      });

      await expect(
        findOne(ENCRYPTED_TABLE, {
          where: { id: 1 },
          encrypted: false,
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('allows encrypted table setup when the stored key is unavailable', async () => {
      mockGetItemAsync.mockResolvedValue(null);

      try {
        await expect(
          createTable(ENCRYPTED_TABLE, {
            encrypted: true,
          })
        ).resolves.not.toThrow();
      } finally {
        mockGetItemAsync.mockResolvedValue('mock-encrypted-key');
      }
    });
  });

  describe('full-table encryption', () => {
    const FULL_ENCRYPTION_TABLE = 'full_table_encryption_table';

    beforeEach(async () => {
      if (await hasTable(FULL_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS)) {
        await deleteTable(FULL_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS);
      }
    });

    afterAll(async () => {
      if (await hasTable(FULL_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS)) {
        await deleteTable(FULL_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS);
      }
    });

    it('round-trips a record encrypted as a full table', async () => {
      await createTable(FULL_ENCRYPTION_TABLE, {
        encrypted: true,
      });

      const testData = {
        id: 1,
        name: 'Test User',
        data: 'sensitive information',
      };

      await insert(FULL_ENCRYPTION_TABLE, testData, {
        encrypted: true,
        encryptFullTable: true,
      });

      const result = await findOne(FULL_ENCRYPTION_TABLE, {
        where: { id: 1 },
        encrypted: true,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(result?.name).toBe('Test User');
      expect(result?.data).toBe('sensitive information');
    });

    it('queries multiple records encrypted as a full table', async () => {
      await createTable(FULL_ENCRYPTION_TABLE, {
        encrypted: true,
      });

      const users = [
        { id: 1, name: 'User 1', email: 'user1@example.com', age: 25 },
        { id: 2, name: 'User 2', email: 'user2@example.com', age: 30 },
        { id: 3, name: 'User 3', email: 'user3@example.com', age: 35 },
      ];

      await insert(FULL_ENCRYPTION_TABLE, users, {
        encrypted: true,
        encryptFullTable: true,
      });

      const result = await findMany(FULL_ENCRYPTION_TABLE, {
        where: { age: { $gt: 25 } },
        encrypted: true,
      });

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('User 2');
      expect(result[1].name).toBe('User 3');
    });
  });

  describe('encryption mode changes', () => {
    const CONFLICT_TABLE = 'encryption_conflict_table';

    beforeEach(async () => {
      if (await hasTable(CONFLICT_TABLE, ENCRYPTED_OPTIONS)) {
        await deleteTable(CONFLICT_TABLE, ENCRYPTED_OPTIONS);
      }
    });

    afterAll(async () => {
      if (await hasTable(CONFLICT_TABLE, ENCRYPTED_OPTIONS)) {
        await deleteTable(CONFLICT_TABLE, ENCRYPTED_OPTIONS);
      }
    });

    it('updates a full-table encrypted record through the encrypted surface', async () => {
      await createTable(CONFLICT_TABLE, {
        encrypted: true,
      });

      await insert(
        CONFLICT_TABLE,
        {
          id: 1,
          name: 'Test User',
          email: 'test@example.com',
          password: 'secret123',
        },
        {
          encrypted: true,
          encryptFullTable: true,
        }
      );

      const user = await findOne(CONFLICT_TABLE, {
        where: { id: 1 },
        encrypted: true,
      });

      expect(user).not.toBeNull();
      expect(user?.name).toBe('Test User');

      await update(
        CONFLICT_TABLE,
        {
          name: 'Updated User',
        },
        {
          where: { id: 1 },
          encrypted: true,
        }
      );

      const updatedUser = await findOne(CONFLICT_TABLE, {
        where: { id: 1 },
        encrypted: true,
      });

      expect(updatedUser).not.toBeNull();
      expect(updatedUser?.name).toBe('Updated User');
    });
  });

  describe('encrypted field reads', () => {
    const FIELD_ENCRYPTION_TABLE = 'field_level_encryption_integration';

    beforeEach(async () => {
      if (await hasTable(FIELD_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS)) {
        await deleteTable(FIELD_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS);
      }
    });

    afterAll(async () => {
      if (await hasTable(FIELD_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS)) {
        await deleteTable(FIELD_ENCRYPTION_TABLE, ENCRYPTED_OPTIONS);
      }
    });

    it('returns encrypted record fields through findOne', async () => {
      await createTable(FIELD_ENCRYPTION_TABLE, {
        encrypted: true,
      });

      const testUser = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        password: 'secret123',
        age: 30,
        active: true,
      };

      await insert(FIELD_ENCRYPTION_TABLE, testUser, {
        encrypted: true,
      });

      const user = await findOne(FIELD_ENCRYPTION_TABLE, {
        where: { id: 1 },
        encrypted: true,
      });

      expect(user).not.toBeNull();
      expect(user?.name).toBe('John Doe');
      expect(user?.email).toBe('john@example.com');
      expect(user?.password).toBe('secret123');
      expect(user?.age).toBe(30);
      expect(user?.active).toBe(true);
    });

    it('returns encrypted record fields through findMany', async () => {
      await createTable(FIELD_ENCRYPTION_TABLE, {
        encrypted: true,
      });

      const users = [
        { id: 1, name: 'User 1', email: 'user1@example.com', password: 'pass1', age: 25 },
        { id: 2, name: 'User 2', email: 'user2@example.com', password: 'pass2', age: 30 },
        { id: 3, name: 'User 3', email: 'user3@example.com', password: 'pass3', age: 35 },
      ];

      await insert(FIELD_ENCRYPTION_TABLE, users, {
        encrypted: true,
      });

      const result = await findMany(FIELD_ENCRYPTION_TABLE, {
        where: { age: { $gt: 25 } },
        encrypted: true,
      });

      expect(result.length).toBe(2);
      expect(result[0].name).toBe('User 2');
      expect(result[1].name).toBe('User 3');
    });
  });
});
