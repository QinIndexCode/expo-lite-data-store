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
  bulkWrite,
  countTable,
  read,
} from '../../expo-lite-data-store';

describe('API integration', () => {
  const INTEGRATION_TABLE = 'api_integration_test_table';

  beforeEach(async () => {
    if (await hasTable(INTEGRATION_TABLE)) {
      await deleteTable(INTEGRATION_TABLE);
    }
  });

  afterAll(async () => {
    if (await hasTable(INTEGRATION_TABLE)) {
      await deleteTable(INTEGRATION_TABLE);
    }
  });

  describe('CRUD lifecycle', () => {
    it('completes CRUD operations with a filtered sorted query', async () => {
      await createTable(INTEGRATION_TABLE);

      const initialData = [
        { id: 1, name: 'Product 1', category: 'Electronics', price: 100, stock: 50, active: true },
        { id: 2, name: 'Product 2', category: 'Clothing', price: 50, stock: 100, active: true },
        { id: 3, name: 'Product 3', category: 'Electronics', price: 200, stock: 25, active: false },
        { id: 4, name: 'Product 4', category: 'Books', price: 20, stock: 200, active: true },
        { id: 5, name: 'Product 5', category: 'Clothing', price: 80, stock: 75, active: true },
      ];

      const insertResult = await insert(INTEGRATION_TABLE, initialData);
      expect(insertResult.written).toBe(initialData.length);
      expect(insertResult.totalAfterWrite).toBe(initialData.length);

      const electronicsExpensive = await findMany(INTEGRATION_TABLE, {
        where: {
          $and: [{ category: 'Electronics' }, { price: { $gt: 50 } }],
        },
        sortBy: 'price',
        order: 'desc',
      });

      expect(electronicsExpensive.length).toBe(2);
      expect(electronicsExpensive[0].price).toBe(200);
      expect(electronicsExpensive[1].price).toBe(100);

      const updateResult = await update(
        INTEGRATION_TABLE,
        { $inc: { price: 10 } },
        { where: { category: 'Electronics' } }
      );

      expect(updateResult).toBe(2);

      const updatedProduct3 = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
      expect(updatedProduct3?.price).toBe(210);

      const deleteResult = await remove(INTEGRATION_TABLE, {
        where: { stock: { $lt: 50 } },
      });

      expect(deleteResult).toBe(1);

      const remainingCount = await countTable(INTEGRATION_TABLE);
      expect(remainingCount).toBe(4);

      const deletedProduct = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
      expect(deletedProduct).toBeNull();

      const remainingData = await read(INTEGRATION_TABLE);
      expect(remainingData.length).toBe(4);
    });
  });

  describe('bulk writes', () => {
    it('applies mixed insert, update, and delete operations', async () => {
      await createTable(INTEGRATION_TABLE);

      const initialData = [
        { id: 1, name: 'User 1', role: 'admin', active: true, score: 100 },
        { id: 2, name: 'User 2', role: 'user', active: true, score: 50 },
        { id: 3, name: 'User 3', role: 'user', active: false, score: 75 },
        { id: 4, name: 'User 4', role: 'user', active: true, score: 90 },
      ];

      await insert(INTEGRATION_TABLE, initialData);

      const operations = [
        {
          type: 'insert' as const,
          data: { id: 5, name: 'User 5', role: 'user', active: true, score: 85 },
        },
        {
          type: 'insert' as const,
          data: { id: 6, name: 'User 6', role: 'moderator', active: true, score: 95 },
        },
        {
          type: 'update' as const,
          data: { $inc: { score: 20 } },
          where: { role: 'admin' },
        },
        {
          type: 'update' as const,
          data: { role: 'premium' },
          where: { score: { $gt: 80 } },
        },
        {
          type: 'delete' as const,
          where: { active: false },
        },
        {
          type: 'update' as const,
          data: { active: false },
          where: { id: 2 },
        },
      ];

      await bulkWrite(INTEGRATION_TABLE, operations);

      const finalCount = await countTable(INTEGRATION_TABLE);
      expect(finalCount).toBe(5);

      const user5 = await findOne(INTEGRATION_TABLE, { where: { id: 5 } });
      const user6 = await findOne(INTEGRATION_TABLE, { where: { id: 6 } });
      expect(user5).toBeDefined();
      expect(user6).toBeDefined();

      const adminUser = await findOne(INTEGRATION_TABLE, { where: { role: 'admin' } });
      expect(adminUser).toBeNull();

      const premiumUsers = await findMany(INTEGRATION_TABLE, { where: { role: 'premium' } });
      expect(premiumUsers.length).toBeGreaterThan(0);

      const inactiveUsers = await findMany(INTEGRATION_TABLE, { where: { active: false } });
      expect(inactiveUsers.length).toBe(1);

      const deletedUser3 = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
      expect(deletedUser3).toBeNull();
    });

    it('inserts array data through bulkWrite', async () => {
      await createTable(INTEGRATION_TABLE);

      const bulkInsertData = [
        { id: 1, name: 'Bulk User 1', group: 'A' },
        { id: 2, name: 'Bulk User 2', group: 'B' },
        { id: 3, name: 'Bulk User 3', group: 'A' },
      ];

      const operations = [
        {
          type: 'insert' as const,
          data: bulkInsertData,
        },
      ];

      const result = await bulkWrite(INTEGRATION_TABLE, operations);
      expect(result.written).toBe(3);

      const count = await countTable(INTEGRATION_TABLE);
      expect(count).toBe(3);
    });
  });

  describe('transactions', () => {
    it('commits multiple related operations', async () => {
      await createTable(INTEGRATION_TABLE);

      await insert(INTEGRATION_TABLE, [
        { id: 1, name: 'Account 1', balance: 1000, status: 'active' },
        { id: 2, name: 'Account 2', balance: 500, status: 'active' },
        { id: 3, name: 'Account 3', balance: 2000, status: 'inactive' },
      ]);

      await beginTransaction({});
      let transactionActive = true;

      try {
        const account1 = await findOne<{ id: number; balance: number }>(INTEGRATION_TABLE, { where: { id: 1 } });
        if (!account1 || account1.balance < 200) {
          throw new Error('Insufficient balance');
        }

        await update(INTEGRATION_TABLE, { $inc: { balance: -200 } }, { where: { id: 1 } });

        await update(INTEGRATION_TABLE, { $inc: { balance: 200 } }, { where: { id: 2 } });

        await update(INTEGRATION_TABLE, { status: 'active' }, { where: { id: 3 } });

        await insert(INTEGRATION_TABLE, {
          id: 4,
          type: 'transaction',
          from: 1,
          to: 2,
          amount: 200,
          timestamp: Date.now(),
        });

        await commit({});
        transactionActive = false;

        const updatedAccount1 = await findOne(INTEGRATION_TABLE, { where: { id: 1 } });
        const updatedAccount2 = await findOne(INTEGRATION_TABLE, { where: { id: 2 } });
        const updatedAccount3 = await findOne(INTEGRATION_TABLE, { where: { id: 3 } });
        const transaction = await findOne(INTEGRATION_TABLE, { where: { id: 4 } });

        expect(updatedAccount1?.balance).toBe(800);
        expect(updatedAccount2?.balance).toBe(700);
        expect(updatedAccount3?.status).toBe('active');
        expect(transaction).toBeDefined();
        expect(transaction?.amount).toBe(200);
      } catch (error) {
        if (transactionActive) {
          await rollback({});
        }
        throw error;
      }
    });

    it('rolls back a failed transaction', async () => {
      await createTable(INTEGRATION_TABLE);

      await insert(INTEGRATION_TABLE, [
        { id: 1, name: 'Critical Data 1', value: 100 },
        { id: 2, name: 'Critical Data 2', value: 200 },
      ]);

      const initialData1 = await findOne(INTEGRATION_TABLE, { where: { id: 1 } });
      const initialData2 = await findOne(INTEGRATION_TABLE, { where: { id: 2 } });

      await beginTransaction({});
      let transactionActive = true;

      try {
        await update(INTEGRATION_TABLE, { value: 150 }, { where: { id: 1 } });

        throw new Error('Test rollback');

        await update(INTEGRATION_TABLE, { value: 250 }, { where: { id: 2 } });

        await commit({});
        transactionActive = false;
      } catch {
        if (transactionActive) {
          await rollback({});
        }
      }

      const rolledBackData1 = await findOne(INTEGRATION_TABLE, { where: { id: 1 } });
      const rolledBackData2 = await findOne(INTEGRATION_TABLE, { where: { id: 2 } });

      expect(rolledBackData1?.value).toBe(initialData1?.value);
      expect(rolledBackData2?.value).toBe(initialData2?.value);
    });
  });

  describe('query operators', () => {
    it('evaluates nested logical operators and preserves sort order', async () => {
      await createTable(INTEGRATION_TABLE);

      const testData = [
        { id: 1, name: 'Item 1', tags: ['A', 'B'], rating: 4.5, price: 100, available: true },
        { id: 2, name: 'Item 2', tags: ['B', 'C'], rating: 3.8, price: 150, available: true },
        { id: 3, name: 'Item 3', tags: ['A', 'C', 'D'], rating: 4.2, price: 200, available: false },
        { id: 4, name: 'Item 4', tags: ['B'], rating: 4.7, price: 50, available: true },
        { id: 5, name: 'Item 5', tags: ['A', 'B', 'C'], rating: 3.5, price: 120, available: true },
      ];

      await insert(INTEGRATION_TABLE, testData);

      const complexQueryResult = await findMany(INTEGRATION_TABLE, {
        where: {
          $and: [
            {
              $or: [
                { $and: [{ tags: { $in: ['A'] } }, { rating: { $gt: 4.0 } }] },
                { $and: [{ price: { $lt: 100 } }, { available: true }] },
              ],
            },
            { tags: { $nin: ['D'] } },
          ],
        },
        sortBy: ['rating', 'price'],
        order: ['desc', 'asc'],
      });

      expect(complexQueryResult.length).toBe(2);
      expect(complexQueryResult[0].id).toBe(4);
      expect(complexQueryResult[1].id).toBe(1);
    });

    it('matches array fields with compound conditions', async () => {
      await createTable(INTEGRATION_TABLE);

      await insert(INTEGRATION_TABLE, [
        { id: 1, name: 'User 1', roles: ['admin', 'editor'], permissions: [1, 2, 3], active: true },
        { id: 2, name: 'User 2', roles: ['editor', 'viewer'], permissions: [2, 3], active: true },
        { id: 3, name: 'User 3', roles: ['viewer'], permissions: [3], active: false },
        { id: 4, name: 'User 4', roles: ['admin', 'viewer'], permissions: [1, 3], active: true },
        { id: 5, name: 'User 5', roles: [], permissions: [], active: true },
      ]);

      const arrayQueryResult = await findMany(INTEGRATION_TABLE, {
        where: {
          $and: [
            {
              $or: [{ roles: { $in: ['admin'] } }, { permissions: { $in: [2] } }],
            },
            { active: true },
          ],
        },
      });

      expect(arrayQueryResult.length).toBe(3);

      const emptyArrayResult = await findMany(INTEGRATION_TABLE, {
        where: { roles: [] },
      });

      expect(emptyArrayResult.length).toBe(1);
    });
  });
});
