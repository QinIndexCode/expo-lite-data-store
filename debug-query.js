// Debug script to check why queries are failing
const { createTable, insert, findMany, read, hasTable, deleteTable } = require('./dist/js/expo-lite-data-store.js');

async function debugQueries() {
  const TEST_TABLE = 'debug_test_table';

  // Cleanup if table exists
  if (await hasTable(TEST_TABLE)) {
    await deleteTable(TEST_TABLE);
  }

  // Create table
  await createTable(TEST_TABLE);

  // Insert test data
  const TEST_DATA = [
    { id: 1, name: 'Test User 1', age: 25, active: true },
    { id: 2, name: 'Test User 2', age: 30, active: false },
    { id: 3, name: 'Test User 3', age: 35, active: true },
  ];

  console.log('Inserting test data...');
  await insert(TEST_TABLE, TEST_DATA);

  // Read raw data to see what's actually stored
  console.log('\nRaw data in table:');
  const rawData = await read(TEST_TABLE);
  console.log(rawData);

  // Test simple find
  console.log('\nTesting simple find (id: 1):');
  const simpleFind = await findMany(TEST_TABLE, { id: 1 });
  console.log(simpleFind);

  // Test IN operator
  console.log('\nTesting IN operator (id: [1, 3]):');
  const inFind = await findMany(TEST_TABLE, { id: { $in: [1, 3] } });
  console.log(inFind);

  // Test LIKE operator
  console.log('\nTesting LIKE operator (name: %User%):');
  const likeFind = await findMany(TEST_TABLE, { name: { $like: '%User%' } });
  console.log(likeFind);

  // Test AND operator
  console.log('\nTesting AND operator (active: true, age: > 25):');
  const andFind = await findMany(TEST_TABLE, { $and: [{ active: true }, { age: { $gt: 25 } }] });
  console.log(andFind);

  // Cleanup
  await deleteTable(TEST_TABLE);
  console.log('\nDebug test completed.');
}

debugQueries().catch(console.error);
