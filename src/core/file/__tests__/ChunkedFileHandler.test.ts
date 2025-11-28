// src/core/file/__tests__/ChunkedFileHandler.test.ts

import { ChunkedFileHandler } from '../ChunkedFileHandler';
import { MetadataManager } from '../../meta/MetadataManager';

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

    describe('基本功能测试', () => {
        it('应该能够写入和读取数据', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // 写入数据
            await chunkedFileHandler.write(testData);
            
            // 读取数据
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual(testData);
        });

        it('应该能够追加数据', async () => {
            const initialData = [{ id: 1, name: 'test1' }];
            const appendData = [{ id: 2, name: 'test2' }, { id: 3, name: 'test3' }];
            
            // 写入初始数据
            await chunkedFileHandler.write(initialData);
            
            // 追加数据
            await chunkedFileHandler.append(appendData);
            
            // 读取所有数据
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([...initialData, ...appendData]);
        });

        it('应该能够清空数据', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // 写入数据
            await chunkedFileHandler.write(testData);
            
            // 清空数据
            await chunkedFileHandler.clear();
            
            // 读取数据，应该返回空数组
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([]);
        });

        it('应该能够删除数据', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // 写入数据
            await chunkedFileHandler.write(testData);
            
            // 删除数据
            await chunkedFileHandler.delete();
            
            // 读取数据，应该返回空数组
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([]);
        });
    });

    describe('高级功能测试', () => {
        it('应该能够读取所有数据', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }, { id: 3, name: 'test3' }];
            
            // 写入数据
            await chunkedFileHandler.write(testData);
            
            // 使用 readAll 读取所有数据
            const result = await chunkedFileHandler.readAll();
            
            expect(result).toEqual(testData);
        });

        it('应该能够读取指定范围的分片数据', async () => {
            // 写入足够多的数据，确保生成多个分片
            const testData = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `test${i}` }));
            
            // 写入数据
            await chunkedFileHandler.write(testData);
            
            // 读取指定范围的分片数据
            const result = await chunkedFileHandler.readRange(0, 0);
            
            // 验证结果不为空
            expect(result.length).toBeGreaterThan(0);
            expect(result.length).toBeLessThanOrEqual(1000);
        });
    });

    describe('边界条件测试', () => {
        it('应该能够处理空数据', async () => {
            // 写入空数据
            await chunkedFileHandler.write([]);
            
            // 读取数据，应该返回空数组
            const result = await chunkedFileHandler.read();
            
            expect(result).toEqual([]);
        });

        it('应该能够处理单次写入大量数据', async () => {
            // 生成大量测试数据
            const testData = Array.from({ length: 500 }, (_, i) => ({ 
                id: i, 
                name: `test${i}`, 
                data: `test data ${i}`.repeat(100) // 增加数据大小，确保分块
            }));
            
            // 写入数据
            await chunkedFileHandler.write(testData);
            
            // 读取数据
            const result = await chunkedFileHandler.readAll();
            
            // 验证数据完整性
            expect(result.length).toBe(testData.length);
            expect(result[0]).toEqual(testData[0]);
            expect(result[result.length - 1]).toEqual(testData[testData.length - 1]);
        });
    });

    describe('错误处理测试', () => {
        it('应该能够处理无效数据', async () => {
            // @ts-ignore - 故意传入无效数据类型
            await expect(chunkedFileHandler.write('invalid data')).rejects.toThrow();
        });
    });

    describe('分片处理测试', () => {
        it('应该能够正确处理分片写入和读取', async () => {
            // 写入多批数据，确保生成多个分片
            const batch1 = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `batch1-${i}` }));
            const batch2 = Array.from({ length: 300 }, (_, i) => ({ id: 300 + i, name: `batch2-${i}` }));
            const batch3 = Array.from({ length: 300 }, (_, i) => ({ id: 600 + i, name: `batch3-${i}` }));
            
            // 写入第一批数据
            await chunkedFileHandler.write(batch1);
            
            // 追加第二批数据
            await chunkedFileHandler.append(batch2);
            
            // 追加第三批数据
            await chunkedFileHandler.append(batch3);
            
            // 读取所有数据
            const result = await chunkedFileHandler.readAll();
            
            // 验证数据完整性
            expect(result.length).toBe(batch1.length + batch2.length + batch3.length);
            
            // 验证数据顺序
            expect(result[0]).toEqual(batch1[0]);
            expect(result[300]).toEqual(batch2[0]);
            expect(result[600]).toEqual(batch3[0]);
        });
    });
});