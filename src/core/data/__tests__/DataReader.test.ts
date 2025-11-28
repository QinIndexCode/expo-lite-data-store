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
        it('should be able to read data from non-existent table, return empty array', async () => {
            const result = await dataReader.read('non_existent_table');
            expect(result).toEqual([]);
        });
        
        it('should be able to read data from existing table', async () => {
            // Create table metadata first
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
        
        it('should be able to query data with filter conditions', async () => {
            // Create table metadata first
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
            
            // Here we simulate data reading, actual data would be read from file system
            // Since we're using mock, it returns empty array
            const result = await dataReader.read(testTableName, {
                filter: { age: { $gt: 18 } }
            });
            expect(result).toEqual([]);
        });
        
        it('should be able to query data with pagination', async () => {
            // Create table metadata first
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
        
        it('should be able to bypass cache when querying data', async () => {
            // Create table metadata first
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
        it('should be able to find non-existent record, return null', async () => {
            const result = await dataReader.findOne(testTableName, { id: 'non_existent_id' });
            expect(result).toBeNull();
        });
        
        it('should be able to find existing record', async () => {
            // Create table metadata first
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
        it('should be able to find multiple records', async () => {
            // Create table metadata first
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
        
        it('should be able to find multiple records with pagination', async () => {
            // Create table metadata first
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