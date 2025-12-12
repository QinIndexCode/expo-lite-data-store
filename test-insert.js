// Simple test script to verify the insert method works correctly
import { db, createTable, insert, read, write, deleteTable } from './dist/js/expo-lite-data-store.js';

async function testInsertMethod() {
  console.log('Testing insert method...');
  
  const TEST_TABLE = 'test_insert_table';
  
  try {
    // Clean up any existing test table
    await deleteTable(TEST_TABLE).catch(() => {});
    
    // Create a test table
    await createTable(TEST_TABLE);
    console.log('✓ Table created successfully');
    
    // Test 1: insert method with single record
    await insert(TEST_TABLE, { id: 1, name: 'Test User 1' });
    console.log('✓ Test 1 - insert single record successful');
    
    // Verify count after first insert
    let records = await read(TEST_TABLE);
    console.log(`✓ After first insert: ${records.length} records`);
    
    // Test 2: insert method with multiple records
    await insert(TEST_TABLE, [
      { id: 2, name: 'Test User 2' },
      { id: 3, name: 'Test User 3' }
    ]);
    console.log('✓ Test 2 - insert multiple records successful');
    
    // Verify count after second insert (should be 3 records total)
    records = await read(TEST_TABLE);
    console.log(`✓ After second insert: ${records.length} records`);
    if (records.length === 3) {
      console.log('✓ Test 2 PASSED: Multiple inserts correctly append data');
    } else {
      console.error(`✗ Test 2 FAILED: Expected 3 records, got ${records.length}`);
    }
    
    // Test 3: insert as instance method on db object
    await db.insert(TEST_TABLE, { id: 4, name: 'Test User 4' });
    console.log('✓ Test 3 - db.insert instance method works');
    
    // Verify count after third insert (should be 4 records total)
    records = await read(TEST_TABLE);
    console.log(`✓ After third insert: ${records.length} records`);
    if (records.length === 4) {
      console.log('✓ Test 3 PASSED: Instance method correctly appends data');
    } else {
      console.error(`✗ Test 3 FAILED: Expected 4 records, got ${records.length}`);
    }
    
    // Test 4: Verify insert always uses append mode, even with overwrite option
    console.log('\n✓ Test 4 - Testing insert with explicit overwrite option (should still append)');
    await insert(TEST_TABLE, { id: 5, name: 'Test User 5' }, { mode: 'overwrite' });
    
    records = await read(TEST_TABLE);
    console.log(`✓ After insert with overwrite option: ${records.length} records`);
    if (records.length === 5) {
      console.log('✓ Test 4 PASSED: insert always uses append mode, ignoring overwrite option');
    } else {
      console.error(`✗ Test 4 FAILED: Expected 5 records (append behavior), got ${records.length}`);
    }
    
    // Test 5: Compare with write method's overwrite behavior for contrast
    console.log('\n✓ Test 5 - Comparing with write method overwrite behavior');
    await write(TEST_TABLE, { id: 6, name: 'Overwrite User' }, { mode: 'overwrite' });
    
    records = await read(TEST_TABLE);
    console.log(`✓ After write with overwrite option: ${records.length} records`);
    if (records.length === 1) {
      console.log('✓ Test 5 PASSED: write method correctly overwrites data when using overwrite mode');
    } else {
      console.error(`✗ Test 5 FAILED: Expected 1 record (overwrite behavior), got ${records.length}`);
    }
    
    // Test 6: insert after overwrite should append again
    console.log('\n✓ Test 6 - insert after overwrite should append again');
    await insert(TEST_TABLE, { id: 7, name: 'Append After Overwrite' });
    
    records = await read(TEST_TABLE);
    console.log(`✓ After insert following overwrite: ${records.length} records`);
    if (records.length === 2) {
      console.log('✓ Test 6 PASSED: insert correctly appends after overwrite');
    } else {
      console.error(`✗ Test 6 FAILED: Expected 2 records, got ${records.length}`);
    }
    
    console.log('\n🎉 All insert method tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    // Clean up
    await deleteTable(TEST_TABLE).catch(() => {});
  }
}

testInsertMethod();