// src/core/data/__tests__/DataWriter.test.ts
// DataWriter 单元测试

import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { FileOperationManager } from '../../FileOperationManager';
import { IndexManager } from '../../index/IndexManager';
import { MetadataManager } from '../../meta/MetadataManager';
import { DataWriter } from '../DataWriter';

describe('DataWriter', () => {
    let dataWriter: DataWriter;
    let metadataManager: MetadataManager;
    let cacheManager: CacheManager;
    let indexManager: IndexManager;
    let fileOperationManager: FileOperationManager;
    const testTableName = 'test_table';
    
    beforeEach(() => {
        // 创建新的实例用于每个测试
        metadataManager = new MetadataManager();
        cacheManager = new CacheManager({
            strategy: CacheStrategy.LRU,
            maxSize: 100,
            defaultExpiry: 3600000,
            enablePenetrationProtection: true,
            enableBreakdownProtection: true,
            enableAvalancheProtection: true,
        });
        indexManager = new IndexManager(metadataManager);
        fileOperationManager = new FileOperationManager(8 * 1024 * 1024, metadataManager);
        
        dataWriter = new DataWriter(
            metadataManager,
            indexManager,
            cacheManager,
            fileOperationManager
        );
        
        // 清除测试表元数据
        metadataManager.delete(testTableName);
    });
    
    afterEach((done) => {
        // 清理定时器，防止测试挂起
        console.log('[DataWriter.test] afterEach: 开始清理');
        if (cacheManager) {
            console.log('[DataWriter.test] afterEach: 清理 CacheManager');
            cacheManager.cleanup();
        }
        if (metadataManager) {
            console.log('[DataWriter.test] afterEach: 清理 MetadataManager');
            metadataManager.cleanup();
        }
        // 使用 process.nextTick 而不是 setTimeout，避免阻塞
        process.nextTick(() => {
            console.log('[DataWriter.test] afterEach: 清理完成');
            done();
        });
    });
    
    describe('createTable', () => {
        it('should be able to create new table', async () => {
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                },
                initialData: [
                    { id: '1', name: 'test1', age: 20 },
                    { id: '2', name: 'test2', age: 25 }
                ]
            });
            
            // Check if table was created successfully
            const tableMeta = metadataManager.get(testTableName);
            expect(tableMeta).toBeDefined();
            expect(tableMeta?.mode).toBe('single');
            expect(tableMeta?.count).toBe(2);
        });
        
        it('should be able to create chunked table', async () => {
            await dataWriter.createTable(testTableName, {
                mode: 'chunked',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // Check if table was created successfully
            const tableMeta = metadataManager.get(testTableName);
            expect(tableMeta).toBeDefined();
            expect(tableMeta?.mode).toBe('chunked');
        });
    });
    
    describe('write', () => {
        it('should be able to write data to existing table', async () => {
            // Create table first
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // Write data
            const result = await dataWriter.write(testTableName, {
                id: '1',
                name: 'test',
                age: 20
            });
            
            // Check write result
            expect(result).toBeDefined();
            expect(result.written).toBe(1);
            expect(result.totalAfterWrite).toBe(1);
        });
        
        it('should be able to batch write data to existing table', async () => {
            // Create table first
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // Batch write data
            const result = await dataWriter.write(testTableName, [
                { id: '1', name: 'test1', age: 20 },
                { id: '2', name: 'test2', age: 25 },
                { id: '3', name: 'test3', age: 30 }
            ]);
            
            // Check write result
            expect(result).toBeDefined();
            expect(result.written).toBe(3);
            expect(result.totalAfterWrite).toBe(3);
        });
    });
    
    describe('delete', () => {
        it('should be able to delete data from table', async () => {
            // Create table and write data first
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                },
                initialData: [
                    { id: '1', name: 'test1', age: 20 },
                    { id: '2', name: 'test2', age: 25 },
                    { id: '3', name: 'test3', age: 30 }
                ]
            });
            
            // Delete data
            const result = await dataWriter.delete(testTableName, { age: { $gt: 25 } });
            
            // Check delete result
            expect(result).toBe(1);
        });
        
        it('should be able to delete all matching data', async () => {
            // Create table and write data first
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                },
                initialData: [
                    { id: '1', name: 'test1', age: 20 },
                    { id: '2', name: 'test2', age: 25 },
                    { id: '3', name: 'test3', age: 30 }
                ]
            });
            
            // Delete all data
            const result = await dataWriter.delete(testTableName, {});
            
            // Check delete result
            expect(result).toBe(3);
        });
    });
    
    describe('count', () => {
        it('should be able to get table record count', async () => {
            // Create table and write data first
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                },
                initialData: [
                    { id: '1', name: 'test1', age: 20 },
                    { id: '2', name: 'test2', age: 25 }
                ]
            });
            
            // Get table record count
            const count = await dataWriter.count(testTableName);
            
            // Check result
            expect(count).toBe(2);
        });
        
        it('should be able to get record count for non-existent table, return 0', async () => {
            // Get record count for non-existent table
            const count = await dataWriter.count('non_existent_table');
            
            // Check result
            expect(count).toBe(0);
        });
    });
    
    describe('deleteTable', () => {
        it('should be able to delete existing table', async () => {
            // Create table first
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // Delete table
            await dataWriter.deleteTable(testTableName);
            
            // Check if table was deleted successfully
            const tableMeta = metadataManager.get(testTableName);
            expect(tableMeta).toBeUndefined();
        });
        
        it('should be able to safely delete non-existent table', async () => {
            // Directly delete non-existent table, should not throw error
            await expect(dataWriter.deleteTable('non_existent_table')).resolves.not.toThrow();
        });
    });
    
    describe('hasTable', () => {
        it('should be able to check existing table, return true', async () => {
            // Create table first
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // Check if table exists
            const result = await dataWriter.hasTable(testTableName);
            
            // Check result
            expect(result).toBe(true);
        });
        
        it('should be able to check non-existent table, return false', async () => {
            // Check non-existent table
            const result = await dataWriter.hasTable('non_existent_table');
            
            // Check result
            expect(result).toBe(false);
        });
    });
});