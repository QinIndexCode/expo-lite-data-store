// src/core/__tests__/FileOperationManager.test.ts

import { FileOperationManager } from '../FileOperationManager';
import { MetadataManager } from '../meta/MetadataManager';

describe('FileOperationManager', () => {
    let fileOperationManager: FileOperationManager;
    const testTableName = 'test_file_operation_table';
    const chunkSize = 1024 * 1024; // 1MB

    const metadataManager = new MetadataManager();
    
    beforeEach(() => {
        // 创建新的 FileOperationManager 实例用于每个测试
        fileOperationManager = new FileOperationManager(chunkSize, metadataManager);
    });

    describe('基本功能测试', () => {
        it('应该能够创建实例', () => {
            expect(fileOperationManager).toBeInstanceOf(FileOperationManager);
        });

        it('应该能够检查权限', async () => {
            // 权限检查应该能够正常执行，不会抛出错误
            await expect(fileOperationManager.checkPermissions()).resolves.not.toThrow();
        });

        it('应该能够清除文件信息缓存', () => {
            // 清除文件信息缓存应该能够正常执行，不会抛出错误
            expect(() => fileOperationManager.clearFileInfoCache()).not.toThrow();
            expect(() => fileOperationManager.clearFileInfoCache('test_path')).not.toThrow();
        });
    });

    describe('文件处理器测试', () => {
        it('应该能够获取单文件处理器', () => {
            const singleFileHandler = fileOperationManager.getSingleFileHandler(testTableName);
            expect(singleFileHandler).toBeDefined();
        });

        it('应该能够获取分片文件处理器', () => {
            const chunkedFileHandler = fileOperationManager.getChunkedFileHandler(testTableName);
            expect(chunkedFileHandler).toBeDefined();
        });

        it('应该能够判断是否使用分片模式', () => {
            // 小数据量不应该使用分片模式
            const smallData = [{ id: 1, name: 'test' }];
            expect(fileOperationManager.shouldUseChunkedMode(smallData)).toBe(false);

            // 大数据量应该使用分片模式
            const largeData = Array.from({ length: 1000 }, (_, i) => ({
                id: i,
                name: `test${i}`,
                data: `large data ${i}`.repeat(1000) // 增加数据大小
            }));
            expect(fileOperationManager.shouldUseChunkedMode(largeData)).toBe(true);
        });
    });

    describe('文件操作测试', () => {
        it('应该能够处理单文件读写操作', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // 写入单文件数据
            await fileOperationManager.writeSingleFile(testTableName, testData);
            
            // 读取单文件数据
            const result = await fileOperationManager.readSingleFile(testTableName);
            
            expect(result).toEqual(testData);
            
            // 清理测试数据
            await fileOperationManager.deleteSingleFile(testTableName);
        });

        it('应该能够处理分片文件读写操作', async () => {
            const testData = [{ id: 1, name: 'test1' }, { id: 2, name: 'test2' }];
            
            // 写入分片文件数据
            await fileOperationManager.writeChunkedFile(testTableName, testData);
            
            // 读取分片文件数据
            const result = await fileOperationManager.readChunkedFile(testTableName);
            
            expect(result.length).toBeGreaterThan(0);
            
            // 清理测试数据
            await fileOperationManager.clearChunkedFile(testTableName);
        });
    });

    describe('边界条件测试', () => {
        it('应该能够处理空数据', async () => {
            // 写入空数据到单文件
            await expect(fileOperationManager.writeSingleFile(testTableName, [])).resolves.not.toThrow();
            
            // 写入空数据到分片文件
            await expect(fileOperationManager.writeChunkedFile(testTableName, [])).resolves.not.toThrow();
            
            // 清理测试数据
            await fileOperationManager.deleteSingleFile(testTableName);
            await fileOperationManager.clearChunkedFile(testTableName);
        });
    });
});