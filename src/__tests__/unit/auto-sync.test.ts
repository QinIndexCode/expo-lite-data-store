// src/__tests__/unit/auto-sync.test.ts
import { FileSystemStorageAdapter } from '../../core/adapter/FileSystemStorageAdapter';
import { AutoSyncService } from '../../core/service/AutoSyncService';

describe('AutoSyncService Tests', () => {
  let storageAdapter: FileSystemStorageAdapter;
  let autoSyncService: AutoSyncService;

  beforeEach(async () => {
    // 创建新的存储适配器实例
    storageAdapter = new FileSystemStorageAdapter();
    // 获取自动同步服务实例
    autoSyncService = (storageAdapter as any).autoSyncService;
  });

  afterEach(async () => {
    // 清理测试数据
    try {
      await storageAdapter.deleteTable('test_auto_sync');
    } catch (error) {
      // 忽略表不存在的错误
    }
    // 清理自动同步服务
    await AutoSyncService.cleanupInstance();
    // 清理缓存管理器，停止定时器
    const cacheManager = (storageAdapter as any).cacheManager;
    if (cacheManager && typeof cacheManager.cleanup === 'function') {
      cacheManager.cleanup();
    }
  });

  it('should start auto-sync service correctly', async () => {
    // 检查自动同步服务是否已启动
    const config = autoSyncService.getConfig();
    expect(config.enabled).toBe(true);
    // 注意：全局配置可能会覆盖默认值，所以我们只检查enabled是否为true
    expect(config.enabled).toBe(true);
  });

  it('should detect dirty data and sync when minItems is reached', async () => {
    // 创建测试表
    await storageAdapter.createTable('test_auto_sync', { mode: 'single' });
    
    // 写入初始数据
    await storageAdapter.write('test_auto_sync', { id: 1, name: 'Test Item 1', value: 'Initial value' });
    
    // 直接操作缓存，将数据标记为脏
    const cacheManager = (storageAdapter as any).cacheManager;
    
    // 先将minItems设置为1，确保单个脏数据就能触发同步
    await autoSyncService.updateConfig({ minItems: 1 });
    
    // 手动更新缓存并标记为脏（注意参数顺序：key, data, expiry, dirty）
    cacheManager.set('test_auto_sync_1', { id: 1, name: 'Test Item 1', value: 'Updated value 1' }, undefined, true);
    
    // 检查脏数据
    const dirtyData = cacheManager.getDirtyData();
    expect(dirtyData.size).toBe(1);
    
    // 手动触发同步
    await autoSyncService.sync();
    
    // 检查同步后的数据
    const syncedData = await storageAdapter.findMany('test_auto_sync');
    expect(syncedData).toHaveLength(1);
    expect(syncedData[0].value).toBe('Updated value 1');
    
    // 再次检查脏数据，应该已经清空
    const dirtyDataAfterSync = cacheManager.getDirtyData();
    expect(dirtyDataAfterSync.size).toBe(0);
  });

  it('should skip sync when dirty item count is below minItems', async () => {
    // 更新配置，将minItems设为2
    await autoSyncService.updateConfig({ minItems: 2 });
    
    // 创建测试表
    await storageAdapter.createTable('test_auto_sync', { mode: 'single' });
    
    // 写入初始数据
    await storageAdapter.write('test_auto_sync', { id: 1, name: 'Test Item 1', value: 'Initial value' });
    
    // 直接操作缓存，将数据标记为脏
    const cacheManager = (storageAdapter as any).cacheManager;
    
    // 手动更新缓存并标记为脏（注意参数顺序：key, data, expiry, dirty）
    cacheManager.set('test_auto_sync_1', { id: 1, name: 'Test Item 1', value: 'Updated value 1' }, undefined, true);
    
    // 检查脏数据
    const dirtyData = cacheManager.getDirtyData();
    expect(dirtyData.size).toBe(1);
    
    // 手动触发同步，应该被跳过
    await autoSyncService.sync();
    
    // 检查脏数据，应该仍然存在（因为同步被跳过）
    const dirtyDataAfterSync = cacheManager.getDirtyData();
    expect(dirtyDataAfterSync.size).toBe(1);
    
    // 恢复默认配置
    await autoSyncService.updateConfig({ minItems: 1 });
  });

  it('should correctly update config when updateConfig is called', async () => {
    // 更新配置
    await autoSyncService.updateConfig({ 
      interval: 10000, 
      minItems: 5, 
      batchSize: 200 
    });
    
    // 检查配置是否已更新
    const config = autoSyncService.getConfig();
    expect(config.interval).toBe(10000);
    expect(config.minItems).toBe(5);
    expect(config.batchSize).toBe(200);
    
    // 恢复默认配置
    await autoSyncService.updateConfig({ 
      interval: 30000, 
      minItems: 1, 
      batchSize: 100 
    });
  });
});
