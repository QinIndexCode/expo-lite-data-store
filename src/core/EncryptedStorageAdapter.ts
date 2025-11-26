// src/core/EncryptedStorageAdapter.ts
// 加密存储适配装饰器 
import type { StorageAdapterInfc } from "../types/storageAdapterInfc";
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from "../types/storageTypes";
import { decrypt, encrypt, getMasterKey } from "../utils/crypto";
import storage from "./adapter/FileSystemStorageAdapter";

export class EncryptedStorageAdapter implements StorageAdapterInfc {
  private keyPromise = getMasterKey();

  private async key() {
    return await this.keyPromise;
  }

  async createTable(tableName: string, options?: CreateTableOptions & {
    columns?: Record<string, string>;
    initialData?: Record<string, any>[];
    mode?: "single" | "chunked";
  }) {
    return storage.createTable(tableName, options);
  }

  async deleteTable(tableName: string) {
    return storage.deleteTable(tableName);
  }

  async hasTable(tableName: string) {
    return storage.hasTable(tableName);
  }

  async listTables() {
    return storage.listTables();
  }

  async write(
    tableName: string, 
    data: Record<string, any> | Record<string, any>[], 
    options?: WriteOptions
  ): Promise<WriteResult> {
    const key = await this.key();
    const encrypted = await encrypt(JSON.stringify(data), key);
    return storage.write(tableName, [{ __enc: encrypted }], { mode: "overwrite", ...options });
  }

  async read(
    tableName: string, 
    options?: ReadOptions
  ): Promise<Record<string, any>[]> {
    const raw = await storage.read(tableName, options);
    if (raw.length === 0) return [];
    const first = raw[0];
    if (first?.__enc) {
      const key = await this.key();
      return JSON.parse(await decrypt(first.__enc, key));
    }
    return raw;
  }

  async count(tableName: string): Promise<number> {
    // 对于加密表，我们需要读取所有数据来获取计数
    const data = await this.read(tableName);
    return data.length;
  }

  async findOne(
    tableName: string,
    filter: Record<string, any>
  ): Promise<Record<string, any> | null> {
    const data = await this.read(tableName);
    // 在解密后的数据上应用过滤
    const filtered = data.filter(item => {
      for (const [key, value] of Object.entries(filter)) {
        if (item[key] !== value) return false;
      }
      return true;
    });
    return filtered.length > 0 ? filtered[0] : null;
  }

  async findMany(
    tableName: string,
    filter?: Record<string, any>,
    options?: { skip?: number; limit?: number }
  ): Promise<Record<string, any>[]> {
    let data = await this.read(tableName);
    
    // 应用过滤
    if (filter) {
      data = data.filter(item => {
        for (const [key, value] of Object.entries(filter)) {
          if (item[key] !== value) return false;
        }
        return true;
      });
    }
    
    // 应用分页
    if (options?.skip) {
      data = data.slice(options.skip);
    }
    if (options?.limit) {
      data = data.slice(0, options.limit);
    }
    
    return data;
  }

  async bulkWrite(
    tableName: string,
    operations: Array<{
      type: "insert" | "update" | "delete";
      data: Record<string, any> | Record<string, any>[];
    }>
  ): Promise<WriteResult> {
    // 对于加密表，先读取所有数据，在内存中处理，然后重新加密写入
    let data = await this.read(tableName);
    let writtenCount = 0;

    for (const op of operations) {
      const items = Array.isArray(op.data) ? op.data : [op.data];

      switch (op.type) {
        case "insert":
          data.push(...items);
          writtenCount += items.length;
          break;
        case "update":
          for (const item of items) {
            if (item.id) {
              const index = data.findIndex(d => d.id === item.id);
              if (index !== -1) {
                data[index] = { ...data[index], ...item };
                writtenCount++;
              }
            }
          }
          break;
        case "delete":
          for (const item of items) {
            if (item.id) {
              const initialLength = data.length;
              data = data.filter(d => d.id !== item.id);
              if (data.length < initialLength) {
                writtenCount++;
              }
            }
          }
          break;
      }
    }

    // 重新加密并写入
    const result = await this.write(tableName, data);
    
    return {
      ...result,
      written: writtenCount
    };
  }

  async migrateToChunked(tableName: string): Promise<void> {
    // 读取解密后的数据
    const data = await this.read(tableName);
    
    // 删除原加密表
    await this.deleteTable(tableName);
    
    // 创建新的分片表并写入数据
    await this.createTable(tableName, { initialData: data, mode: "chunked" });
  }
}