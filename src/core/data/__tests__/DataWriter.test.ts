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
    
    describe('createTable', () => {
        it('应该能够创建新表', async () => {
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
            
            // 检查表是否创建成功
            const tableMeta = metadataManager.get(testTableName);
            expect(tableMeta).toBeDefined();
            expect(tableMeta?.mode).toBe('single');
            expect(tableMeta?.count).toBe(2);
        });
        
        it('应该能够创建分片表', async () => {
            await dataWriter.createTable(testTableName, {
                mode: 'chunked',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // 检查表是否创建成功
            const tableMeta = metadataManager.get(testTableName);
            expect(tableMeta).toBeDefined();
            expect(tableMeta?.mode).toBe('chunked');
        });
    });
    
    describe('write', () => {
        it('应该能够写入数据到存在的表', async () => {
            // 先创建表
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // 写入数据
            const result = await dataWriter.write(testTableName, {
                id: '1',
                name: 'test',
                age: 20
            });
            
            // 检查写入结果
            expect(result).toBeDefined();
            expect(result.written).toBe(1);
            expect(result.totalAfterWrite).toBe(1);
        });
        
        it('应该能够批量写入数据到存在的表', async () => {
            // 先创建表
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // 批量写入数据
            const result = await dataWriter.write(testTableName, [
                { id: '1', name: 'test1', age: 20 },
                { id: '2', name: 'test2', age: 25 },
                { id: '3', name: 'test3', age: 30 }
            ]);
            
            // 检查写入结果
            expect(result).toBeDefined();
            expect(result.written).toBe(3);
            expect(result.totalAfterWrite).toBe(3);
        });
    });
    
    describe('delete', () => {
        it('应该能够删除表中的数据', async () => {
            // 先创建表并写入数据
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
            
            // 删除数据
            const result = await dataWriter.delete(testTableName, { age: { $gt: 25 } });
            
            // 检查删除结果
            expect(result).toBe(1);
        });
        
        it('应该能够删除所有符合条件的数据', async () => {
            // 先创建表并写入数据
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
            
            // 删除所有数据
            const result = await dataWriter.delete(testTableName, {});
            
            // 检查删除结果
            expect(result).toBe(3);
        });
    });
    
    describe('count', () => {
        it('应该能够获取表的记录数', async () => {
            // 先创建表并写入数据
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
            
            // 获取表的记录数
            const count = await dataWriter.count(testTableName);
            
            // 检查结果
            expect(count).toBe(2);
        });
        
        it('应该能够获取不存在表的记录数，返回0', async () => {
            // 获取不存在表的记录数
            const count = await dataWriter.count('non_existent_table');
            
            // 检查结果
            expect(count).toBe(0);
        });
    });
    
    describe('deleteTable', () => {
        it('应该能够删除存在的表', async () => {
            // 先创建表
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // 删除表
            await dataWriter.deleteTable(testTableName);
            
            // 检查表是否删除成功
            const tableMeta = metadataManager.get(testTableName);
            expect(tableMeta).toBeUndefined();
        });
        
        it('应该能够安全删除不存在的表', async () => {
            // 直接删除不存在的表，不应该抛出错误
            await expect(dataWriter.deleteTable('non_existent_table')).resolves.not.toThrow();
        });
    });
    
    describe('hasTable', () => {
        it('应该能够检查存在的表，返回true', async () => {
            // 先创建表
            await dataWriter.createTable(testTableName, {
                mode: 'single',
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // 检查表是否存在
            const result = await dataWriter.hasTable(testTableName);
            
            // 检查结果
            expect(result).toBe(true);
        });
        
        it('应该能够检查不存在的表，返回false', async () => {
            // 检查不存在的表
            const result = await dataWriter.hasTable('non_existent_table');
            
            // 检查结果
            expect(result).toBe(false);
        });
    });
});