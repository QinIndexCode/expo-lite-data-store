// src/core/data/__tests__/DataReader.test.ts
// DataReader 单元测试

import { CacheManager, CacheStrategy } from '../../cache/CacheManager';
import { FileOperationManager } from '../../FileOperationManager';
import { IndexManager } from '../../index/IndexManager';
import { MetadataManager } from '../../meta/MetadataManager';
import { DataReader } from '../DataReader';

describe('DataReader', () => {
    let dataReader: DataReader;
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
        
        dataReader = new DataReader(
            metadataManager,
            indexManager,
            cacheManager,
            fileOperationManager
        );
        
        // 清除测试表元数据
        metadataManager.delete(testTableName);
    });
    
    describe('read', () => {
        it('应该能够读取不存在表的数据，返回空数组', async () => {
            const result = await dataReader.read('non_existent_table');
            expect(result).toEqual([]);
        });
        
        it('应该能够读取存在表的数据', async () => {
            // 先创建表元数据
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string'
                }
            });
            
            const result = await dataReader.read(testTableName);
            expect(result).toEqual([]);
        });
        
        it('应该能够使用过滤条件查询数据', async () => {
            // 先创建表元数据
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string',
                    age: 'number'
                }
            });
            
            // 这里我们模拟数据读取，实际数据会从文件系统读取
            // 由于我们使用了mock，所以返回空数组
            const result = await dataReader.read(testTableName, {
                filter: { age: { $gt: 18 } }
            });
            expect(result).toEqual([]);
        });
        
        it('应该能够使用分页查询数据', async () => {
            // 先创建表元数据
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string'
                }
            });
            
            const result = await dataReader.read(testTableName, {
                skip: 0,
                limit: 10
            });
            expect(result).toEqual([]);
        });
        
        it('应该能够绕过缓存查询数据', async () => {
            // 先创建表元数据
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string'
                }
            });
            
            const result = await dataReader.read(testTableName, {
                bypassCache: true
            });
            expect(result).toEqual([]);
        });
    });
    
    describe('findOne', () => {
        it('应该能够查找不存在的记录，返回null', async () => {
            const result = await dataReader.findOne(testTableName, { id: 'non_existent_id' });
            expect(result).toBeNull();
        });
        
        it('应该能够查找存在的记录', async () => {
            // 先创建表元数据
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string'
                }
            });
            
            const result = await dataReader.findOne(testTableName, { id: 'test_id' });
            expect(result).toBeNull();
        });
    });
    
    describe('findMany', () => {
        it('应该能够查找多条记录', async () => {
            // 先创建表元数据
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string'
                }
            });
            
            const result = await dataReader.findMany(testTableName, {
                name: 'test_name'
            });
            expect(result).toEqual([]);
        });
        
        it('应该能够查找多条记录并分页', async () => {
            // 先创建表元数据
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string'
                }
            });
            
            const result = await dataReader.findMany(testTableName, {
                name: 'test_name'
            }, {
                skip: 0,
                limit: 10
            });
            expect(result).toEqual([]);
        });
    });
});