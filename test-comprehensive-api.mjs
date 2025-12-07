// Comprehensive API test script for expo-lite-data-store
// Tests all exposed APIs to verify they match the README features

import {
  createTable,
  deleteTable,
  hasTable,
  listTables,
  insert,
  read,
  findOne,
  findMany,
  update,
  remove,
  bulkWrite,
  beginTransaction,
  commit,
  rollback,
  migrateToChunked,
  clearTable,
} from './dist/js/expo-lite-data-store.js';

console.log('=== Testing expo-lite-data-store Comprehensive APIs ===\n');

// Helper function to print test results
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    console.error(`❌ ${name}:`, error.message);
    return false;
  }
};

// Helper to cleanup test tables
const cleanupTables = async tables => {
  for (const tableName of tables) {
    if (await hasTable(tableName)) {
      await deleteTable(tableName);
    }
  }
};

// Main test suite
const runTests = async () => {
  const testTables = ['test_users', 'test_products', 'test_transactions'];

  // Cleanup any existing test tables
  await cleanupTables(testTables);

  console.log('1. Testing Table Management APIs...');

  // Create Table
  await test('createTable', async () => {
    await createTable('test_users', {
      columns: {
        id: 'number',
        name: 'string',
        age: 'number',
        email: 'string',
      },
    });
  });

  // Has Table
  await test('hasTable', async () => {
    const exists = await hasTable('test_users');
    if (!exists) throw new Error('Table should exist');
  });

  // List Tables
  await test('listTables', async () => {
    const tables = await listTables();
    if (!tables.includes('test_users')) throw new Error('Table should be in list');
  });

  // Create another table for testing
  await createTable('test_products', {
    columns: {
      id: 'number',
      name: 'string',
      price: 'number',
      category: 'string',
    },
  });

  console.log('\n2. Testing Data Operations APIs...');

  // Insert Data
  await test('insert (single record)', async () => {
    await insert('test_users', {
      id: 1,
      name: 'John Doe',
      age: 30,
      email: 'john@example.com',
    });
  });

  // Insert Multiple Records
  await test('insert (multiple records)', async () => {
    await insert('test_users', [
      { id: 2, name: 'Jane Smith', age: 25, email: 'jane@example.com' },
      { id: 3, name: 'Bob Johnson', age: 35, email: 'bob@example.com' },
    ]);
  });

  // Read Data
  await test('read', async () => {
    const users = await read('test_users');
    if (users.length !== 3) throw new Error('Should have 3 users');
  });

  // Find One
  await test('findOne', async () => {
    const user = await findOne('test_users', { id: 1 });
    if (!user || user.name !== 'John Doe') throw new Error('Should find John Doe');
  });

  // Find Many with filter
  await test('findMany with filter', async () => {
    const users = await findMany('test_users', { age: { $gte: 30 } });
    if (users.length !== 2) throw new Error('Should find 2 users over 30');
  });

  // Find Many with sorting
  await test('findMany with sorting', async () => {
    const users = await findMany(
      'test_users',
      {},
      {
        sortBy: 'age',
        order: 'desc',
      }
    );
    if (users[0].age !== 35 || users[2].age !== 25) throw new Error('Sorting should work correctly');
  });

  // Find Many with pagination
  await test('findMany with pagination', async () => {
    const users = await findMany(
      'test_users',
      {},
      {
        skip: 1,
        limit: 1,
      }
    );
    if (users.length !== 1 || users[0].id !== 2) throw new Error('Pagination should work correctly');
  });

  // Update
  await test('update', async () => {
    const updatedCount = await update('test_users', { age: 31 }, { id: 1 });
    if (updatedCount !== 1) throw new Error('Should update 1 record');

    const updatedUser = await findOne('test_users', { id: 1 });
    if (updatedUser.age !== 31) throw new Error('User age should be updated to 31');
  });

  // Remove
  await test('remove', async () => {
    const removedCount = await remove('test_users', { id: 3 });
    if (removedCount !== 1) throw new Error('Should remove 1 record');

    const remainingUsers = await read('test_users');
    if (remainingUsers.length !== 2) throw new Error('Should have 2 users remaining');
  });

  // Clear Table
  await test('clearTable', async () => {
    await clearTable('test_users');
    const users = await read('test_users');
    if (users.length !== 0) throw new Error('Table should be empty after clearTable');
  });

  // Reinsert data for bulkWrite test
  await insert('test_users', [
    { id: 1, name: 'John Doe', age: 30, email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', age: 25, email: 'jane@example.com' },
  ]);

  // Bulk Write
  await test('bulkWrite', async () => {
    await bulkWrite('test_users', [
      { type: 'insert', data: { id: 3, name: 'Bob Johnson', age: 35, email: 'bob@example.com' } },
      { type: 'update', data: { age: 32 }, where: { id: 1 } },
      { type: 'delete', where: { id: 2 } },
    ]);

    const users = await read('test_users');
    if (users.length !== 2) throw new Error('Should have 2 users after bulkWrite');

    const john = await findOne('test_users', { id: 1 });
    if (john.age !== 32) throw new Error("John's age should be updated to 32");
  });

  console.log('\n3. Testing Transaction APIs...');

  // Successful Transaction
  await test('Transaction - commit', async () => {
    await beginTransaction();
    try {
      await insert('test_products', { id: 1, name: 'Product 1', price: 100, category: 'electronics' });
      await insert('test_products', { id: 2, name: 'Product 2', price: 200, category: 'clothing' });
      await commit();

      const products = await read('test_products');
      if (products.length !== 2) throw new Error('Should have 2 products after commit');
    } catch (error) {
      await rollback();
      throw error;
    }
  });

  // Rollback Transaction
  await test('Transaction - rollback', async () => {
    const initialCount = (await read('test_products')).length;

    await beginTransaction();
    try {
      await insert('test_products', { id: 3, name: 'Product 3', price: 300, category: 'books' });
      await insert('test_products', { id: 4, name: 'Product 4', price: 400, category: 'toys' });
      await rollback();

      const finalCount = (await read('test_products')).length;
      if (finalCount !== initialCount) throw new Error('Rollback should preserve initial count');
    } catch (error) {
      await rollback();
      throw error;
    }
  });

  console.log('\n4. Testing Advanced Features...');

  // Mode Migration - migrateToChunked
  await test('migrateToChunked', async () => {
    // Create a table with initial data
    await createTable('test_transactions', {
      initialData: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        amount: 100 + i * 10,
        description: `Transaction ${i + 1}`,
        timestamp: Date.now(),
      })),
      mode: 'single',
    });

    await migrateToChunked('test_transactions');

    // Verify the table still exists and has data
    const exists = await hasTable('test_transactions');
    if (!exists) throw new Error('Table should still exist after migration');

    const transactions = await read('test_transactions');
    if (transactions.length !== 10) throw new Error('Should have 10 transactions after migration');
  });

  // Test complex queries with operators
  await test('Complex queries with operators', async () => {
    // Insert test data
    await createTable('test_products_complex', {
      initialData: [
        { id: 1, name: 'Laptop', price: 1500, category: 'electronics', inStock: true },
        { id: 2, name: 'Phone', price: 800, category: 'electronics', inStock: true },
        { id: 3, name: 'Shirt', price: 50, category: 'clothing', inStock: false },
        { id: 4, name: 'Pants', price: 75, category: 'clothing', inStock: true },
        { id: 5, name: 'Book', price: 25, category: 'books', inStock: true },
      ],
    });

    // Test AND query
    const electronicsInStock = await findMany('test_products_complex', {
      $and: [{ category: 'electronics' }, { inStock: true }],
    });
    if (electronicsInStock.length !== 2) throw new Error('Should find 2 electronics in stock');

    // Test OR query
    const cheapOrBooks = await findMany('test_products_complex', {
      $or: [{ price: { $lt: 100 } }, { category: 'books' }],
    });
    if (cheapOrBooks.length !== 4) throw new Error('Should find 4 cheap items or books');

    // Test combined operators
    const midRangeElectronics = await findMany('test_products_complex', {
      category: 'electronics',
      price: { $gte: 500, $lte: 2000 },
    });
    if (midRangeElectronics.length !== 2) throw new Error('Should find 2 mid-range electronics');
  });

  // Cleanup all test tables
  await cleanupTables([...testTables, 'test_products_complex']);

  console.log('\n=== All Tests Completed ===');
  console.log('Note: Sync-related APIs (getSyncStats, syncNow, setAutoSyncConfig) are not exposed in the public API.');
  console.log(
    'Encryption is implemented but disabled by default. To test encryption, set USE_ENCRYPTION = true in src/core/db.ts.'
  );
};

runTests();
