import { Directory, Paths } from "expo-file-system";
import { File } from "expo-file-system";
import { SingleFileHandler } from "../file/SingleFileHandler";
import { QueryEngine } from "../query/QueryEngine";
import { meta } from "../meta/MetadataManager";
import type { StorageAdapter } from "../../types/storageAdapter";
import type { WriteOptions, ReadOptions, WriteResult } from "../../types/storageTypes";
import config from "../../ldb.config.js";
export const ROOT = new Directory(Paths.document, config.storageFolder);
 await ROOT.create({ intermediates: true });

export class FileSystemStorageAdapter implements StorageAdapter {
  private chunkSize = config.chunkSize;

  private getSingleFile(tableName: string) {
    const file = new File(ROOT, tableName + ".ldb");
    return new SingleFileHandler(file);
  }

  async createTable(dir: any, options: any) {
    const tableName = options?.name || dir;
    const handler = this.getSingleFile(tableName);
    
  }

  async deleteTable(tableName: string) {
    await this.getSingleFile(tableName).delete();
    meta.delete(tableName);
  }

  async hasTable(tableName: string) {
    return meta.get(tableName) !== undefined;
  }

  async listTables() {
    return meta.allTables();
  }

  async write(
    tableName: string,
    data: Record<string, any> | Record<string, any>[],
    options?: WriteOptions
  ): Promise<WriteResult> {
    const items = Array.isArray(data) ? data : [data];
    if (items.length === 0) return { written: 0, totalAfterWrite: await this.count(tableName), chunked: false };

    const handler = this.getSingleFile(tableName);
    const existing = options?.mode === "overwrite" ? [] : await handler.read();
    const final = options?.mode === "overwrite" ? items : [...existing, ...items];

    await handler.write(final);

    meta.update(tableName, {
      mode: "single",
      path: `${tableName}.ldb`,
      count: final.length,
    });

    return {
      written: items.length,
      totalAfterWrite: final.length,
      chunked: false,
    };
  }

  async read(tableName: string, options?: ReadOptions) {
    const handler = this.getSingleFile(tableName);
    let data = await handler.read();

    if (options?.filter) {
      data = QueryEngine.filter(data, options.filter);
    }
    data = QueryEngine.paginate(data, options?.skip, options?.limit);

    return data;
  }

  async count(tableName: string) {
    return meta.count(tableName);
  }
}

export const storage = new FileSystemStorageAdapter();