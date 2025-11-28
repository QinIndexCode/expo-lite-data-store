// src/core/file/__tests__/ChunkedFileHandler.test.ts

import { MetadataManager } from '../../meta/MetadataManager';
import { ChunkedFileHandler } from '../ChunkedFileHandler';

describe('ChunkedFileHandler', () => {
    let chunkedFileHandler: ChunkedFileHandler;
    const testTableName = 'test_chunked_table';
    const metadataManager = new MetadataManager();

    beforeEach(() => {
        // 创建新的 ChunkedFileHandler 实例用于每个测试
        chunkedFileHandler = new ChunkedFileHandler(testTableName, metadataManager);
    });

    afterEach(async () => {
        // 清理测试数据
        await chunkedFileHandler.clear();
    });

    describe('Basic Functionality Tests', () => {
        it('should be able to write and read data', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // Write data
            await chunkedFileHandler.write(testData);
            
            // Read data
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual(testData);
        });

        it('should be able to append data', async () => {
            const initialData = [{ id: 1, name: 'test1' }];
            const appendData = [{ id: 2, name: 'test2' }, { id: 3, name: 'test3' }];
            
            // Write initial data
            await chunkedFileHandler.write(initialData);
            
            // Append data
            await chunkedFileHandler.append(appendData);
            
            // Read all data
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([...initialData, ...appendData]);
        });

        it('should be able to clear data', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // Write data
            await chunkedFileHandler.write(testData);
            
            // Clear data
            await chunkedFileHandler.clear();
            
            // Read data, should return empty array
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([]);
        });

        it('should be able to delete data', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // Write data
            await chunkedFileHandler.write(testData);
            
            // Delete data
            await chunkedFileHandler.delete();
            
            // Read data, should return empty array
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([]);
        });
    });

    describe('Advanced Functionality Tests', () => {
        it('should be able to read all data', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }, { id: 3, name: 'test3' }];
            
            // Write data
            await chunkedFileHandler.write(testData);
            
            // Read all data using readAll
            const result = await chunkedFileHandler.readAll();
            
            expect(result).toEqual(testData);
        });

        it('should be able to read data from specified chunk range', async () => {
            // Write enough data to ensure multiple chunks are created
            const testData = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `test${i}` }));
            
            // Write data
            await chunkedFileHandler.write(testData);
            
            // Read data from specified chunk range
            const result = await chunkedFileHandler.readRange(0, 0);
            
            // Verify result is not empty
            expect(result.length).toBeGreaterThan(0);
            expect(result.length).toBeLessThanOrEqual(1000);
        });
    });

    describe('Edge Case Tests', () => {
        it('should be able to handle empty data', async () => {
            // Write empty data
            await chunkedFileHandler.write([]);
            
            // Read data, should return empty array
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([]);
        });

        it('should be able to handle large data write in single operation', async () => {
            // Generate large test data
            const testData = Array.from({ length: 500 }, (_, i) => ({ 
                id: i, 
                name: `test${i}`, 
                data: `test data ${i}`.repeat(100) // Increase data size to ensure chunking
            }));
            
            // Write data
            await chunkedFileHandler.write(testData);
            
            // Read data
            const result = await chunkedFileHandler.readAll();
            
            // Verify data integrity
            expect(result.length).toBe(testData.length);
            expect(result[0]).toEqual(testData[0]);
            expect(result[result.length - 1]).toEqual(testData[testData.length - 1]);
        });
    });

    describe('Error Handling Tests', () => {
        it('should be able to handle invalid data', async () => {
            // @ts-ignore - Intentionally passing invalid data type
            await expect(chunkedFileHandler.write('invalid data')).rejects.toThrow();
        });
    });

    describe('Chunk Processing Tests', () => {
        it('should correctly handle chunked write and read operations', async () => {
            // Write multiple batches of data to ensure multiple chunks are created
            const batch1 = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `batch1-${i}` }));
            const batch2 = Array.from({ length: 300 }, (_, i) => ({ id: 300 + i, name: `batch2-${i}` }));
            const batch3 = Array.from({ length: 300 }, (_, i) => ({ id: 600 + i, name: `batch3-${i}` }));
            
            // Write first batch
            await chunkedFileHandler.write(batch1);
            
            // Append second batch
            await chunkedFileHandler.append(batch2);
            
            // Append third batch
            await chunkedFileHandler.append(batch3);
            
            // Read all data
            const result = await chunkedFileHandler.readAll();
            
            // Verify data integrity
            expect(result.length).toBe(batch1.length + batch2.length + batch3.length);
            
            // Verify data order
            expect(result[0]).toEqual(batch1[0]);
            expect(result[300]).toEqual(batch2[0]);
            expect(result[600]).toEqual(batch3[0]);
        });
    });
});