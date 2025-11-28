// src/core/meta/__tests__/MetadataManager.test.ts
import { MetadataManager } from '../MetadataManager';

describe('MetadataManager', () => {
    let metadataManager: MetadataManager;
    const testTableName = 'test_table';
    
    beforeEach(() => {
        // 创建新的MetadataManager实例
        metadataManager = new MetadataManager();
        
        // 清除测试表元数据
        metadataManager.delete(testTableName);
    });
    
    describe('get', () => {
        it('should be able to get metadata for non-existent table, return undefined', () => {
            const result = metadataManager.get('non_existent_table');
            expect(result).toBeUndefined();
        });
        
        it('should be able to get metadata for existing table', () => {
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
            
            const result = metadataManager.get(testTableName);
            expect(result).toBeDefined();
            expect(result?.mode).toBe('single');
            expect(result?.path).toBe(`${testTableName}.ldb`);
            expect(result?.count).toBe(0);
        });
    });
    
    describe('getPath', () => {
        it('should be able to get table path', () => {
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
            
            const result = metadataManager.getPath(testTableName);
            expect(result).toBe(`${testTableName}.ldb`);
        });
        
        it('should be able to get default path for non-existent table', () => {
            const result = metadataManager.getPath('non_existent_table');
            expect(result).toBe('non_existent_table.ldb');
        });
    });
    
    describe('update', () => {
        it('should be able to create metadata for new table', () => {
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
            
            const result = metadataManager.get(testTableName);
            expect(result).toBeDefined();
            expect(result?.mode).toBe('single');
            expect(result?.count).toBe(0);
            expect(result?.columns).toEqual({
                id: 'string',
                name: 'string'
            });
        });
        
        it('should be able to update metadata for existing table', () => {
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
            
            // Update table metadata
            metadataManager.update(testTableName, {
                count: 10,
                mode: 'chunked',
                path: `${testTableName}/`
            });
            
            const result = metadataManager.get(testTableName);
            expect(result).toBeDefined();
            expect(result?.count).toBe(10);
            expect(result?.mode).toBe('chunked');
            expect(result?.path).toBe(`${testTableName}/`);
            expect(result?.columns).toEqual({
                id: 'string',
                name: 'string'
            });
        });
    });
    
    describe('delete', () => {
        it('should be able to delete table metadata', () => {
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
            
            // Delete table metadata
            metadataManager.delete(testTableName);
            
            const result = metadataManager.get(testTableName);
            expect(result).toBeUndefined();
        });
        
        it('should be able to safely delete metadata for non-existent table', () => {
            // Directly delete non-existent table, should not throw error
            expect(() => metadataManager.delete('non_existent_table')).not.toThrow();
        });
    });
    
    describe('allTables', () => {
        it('should be able to get all table names', () => {
            // Create multiple table metadata
            metadataManager.update('table1', {
                mode: 'single',
                path: 'table1.ldb',
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string'
                }
            });
            
            metadataManager.update('table2', {
                mode: 'single',
                path: 'table2.ldb',
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string'
                }
            });
            
            metadataManager.update('table3', {
                mode: 'single',
                path: 'table3.ldb',
                count: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string'
                }
            });
            
            const result = metadataManager.allTables();
            expect(result).toEqual(expect.arrayContaining(['table1', 'table2', 'table3']));
            expect(result.length).toBe(3);
        });
        
        it('should return empty array when no tables exist', () => {
            // Ensure no table metadata exists
            metadataManager.delete(testTableName);
            
            const result = metadataManager.allTables();
            expect(result).toEqual([]);
        });
    });
    
    describe('count', () => {
        it('should be able to get table record count', () => {
            // Create table metadata first
            metadataManager.update(testTableName, {
                mode: 'single',
                path: `${testTableName}.ldb`,
                count: 5,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                columns: {
                    id: 'string',
                    name: 'string'
                }
            });
            
            const result = metadataManager.count(testTableName);
            expect(result).toBe(5);
        });
        
        it('should be able to get record count for non-existent table, return 0', () => {
            const result = metadataManager.count('non_existent_table');
            expect(result).toBe(0);
        });
    });
    
    describe('debugDump_checkMetaCache', () => {
        it('should be able to get complete metadata cache', () => {
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
            
            const result = metadataManager.debugDump_checkMetaCache();
            expect(result).toBeDefined();
            expect(result.version).toBeDefined();
            expect(result.generatedAt).toBeDefined();
            expect(result.tables).toBeDefined();
            expect(result.tables[testTableName]).toBeDefined();
        });
    });
});