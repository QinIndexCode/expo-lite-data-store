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
        it('应该能够获取不存在表的元数据，返回undefined', () => {
            const result = metadataManager.get('non_existent_table');
            expect(result).toBeUndefined();
        });
        
        it('应该能够获取存在表的元数据', () => {
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
            
            const result = metadataManager.get(testTableName);
            expect(result).toBeDefined();
            expect(result?.mode).toBe('single');
            expect(result?.path).toBe(`${testTableName}.ldb`);
            expect(result?.count).toBe(0);
        });
    });
    
    describe('getPath', () => {
        it('应该能够获取表的路径', () => {
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
            
            const result = metadataManager.getPath(testTableName);
            expect(result).toBe(`${testTableName}.ldb`);
        });
        
        it('应该能够获取不存在表的默认路径', () => {
            const result = metadataManager.getPath('non_existent_table');
            expect(result).toBe('non_existent_table.ldb');
        });
    });
    
    describe('update', () => {
        it('应该能够创建新表的元数据', () => {
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
        
        it('应该能够更新现有表的元数据', () => {
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
            
            // 更新表元数据
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
        it('应该能够删除表的元数据', () => {
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
            
            // 删除表元数据
            metadataManager.delete(testTableName);
            
            const result = metadataManager.get(testTableName);
            expect(result).toBeUndefined();
        });
        
        it('应该能够安全删除不存在表的元数据', () => {
            // 直接删除不存在的表，不应该抛出错误
            expect(() => metadataManager.delete('non_existent_table')).not.toThrow();
        });
    });
    
    describe('allTables', () => {
        it('应该能够获取所有表名', () => {
            // 创建多个表元数据
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
        
        it('应该在没有表时返回空数组', () => {
            // 确保没有表元数据
            metadataManager.delete(testTableName);
            
            const result = metadataManager.allTables();
            expect(result).toEqual([]);
        });
    });
    
    describe('count', () => {
        it('应该能够获取表的记录数', () => {
            // 先创建表元数据
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
        
        it('应该能够获取不存在表的记录数，返回0', () => {
            const result = metadataManager.count('non_existent_table');
            expect(result).toBe(0);
        });
    });
    
    describe('debugDump_checkMetaCache', () => {
        it('应该能够获取完整的元数据缓存', () => {
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
            
            const result = metadataManager.debugDump_checkMetaCache();
            expect(result).toBeDefined();
            expect(result.version).toBeDefined();
            expect(result.generatedAt).toBeDefined();
            expect(result.tables).toBeDefined();
            expect(result.tables[testTableName]).toBeDefined();
        });
    });
});