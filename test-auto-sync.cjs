/**
 * Test script to verify auto-sync functionality
 * This script directly tests the AutoSyncService initialization and start logic
 */

// Import the necessary components
const { AutoSyncService } = require('./dist/js/core/service/AutoSyncService.js');
const { CacheService } = require('./dist/js/core/service/CacheService.js');
const { CacheManager } = require('./dist/js/core/cache/CacheManager.js');

// Create mock components for testing
const cacheManager = new CacheManager();
const cacheService = new CacheService(cacheManager);

// Create a simple mock storage adapter
const mockStorageAdapter = {
  write: async (tableName, data, options) => {
    console.log(`Mock write to ${tableName}:`, data.length, 'items');
    return {
      written: data.length,
      totalAfterWrite: data.length,
      chunked: false
    };
  }
};

async function testAutoSyncInitialization() {
  console.log('=== AutoSyncService Initialization Test ===\n');
  
  try {
    // Get the singleton instance
    const autoSyncService = AutoSyncService.getInstance(cacheService, mockStorageAdapter);
    
    console.log('1. AutoSyncService instance created successfully');
    
    // Get current config
    const config = autoSyncService.getConfig();
    console.log('2. Current config:', config);
    
    // Check if enabled
    console.log('3. AutoSync enabled:', config.enabled);
    
    // Check stats
    const stats = autoSyncService.getStats();
    console.log('4. Initial stats:', stats);
    
    // Manually start the service
    console.log('5. Starting AutoSyncService...');
    autoSyncService.start();
    console.log('6. AutoSyncService started');
    
    // Check if it's running
    console.log('7. AutoSyncService should be running now');
    
    // Add some dirty data to trigger sync
    console.log('8. Adding dirty data to cache...');
    cacheService.set('test_table_1', { id: 1, name: 'Test Item 1' }, undefined, true);
    cacheService.set('test_table_2', { id: 2, name: 'Test Item 2' }, undefined, true);
    
    // Get dirty data
    const dirtyData = cacheService.getDirtyData();
    console.log('9. Dirty data count:', dirtyData.size);
    console.log('10. Dirty data:', Array.from(dirtyData.entries()));
    
    // Manually trigger sync
    console.log('11. Manually triggering sync...');
    await autoSyncService.sync();
    
    // Check stats after sync
    const statsAfterSync = autoSyncService.getStats();
    console.log('12. Stats after sync:', statsAfterSync);
    
    // Check if data is marked as clean
    const cleanDirtyData = cacheService.getDirtyData();
    console.log('13. Dirty data after sync:', cleanDirtyData.size);
    
    // Stop the service
    console.log('14. Stopping AutoSyncService...');
    await autoSyncService.stop();
    console.log('15. AutoSyncService stopped');
    
    console.log('\n=== Test Results ===');
    console.log('✅ AutoSyncService initialization test completed successfully');
    
  } catch (error) {
    console.error('❌ Error during test:', error);
    process.exit(1);
  }
}

// Run the test
testAutoSyncInitialization();