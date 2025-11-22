// src/core/file/ChunkedFileHandler.ts
// chunked file handler / 分块文件处理器

//待处理：分块写入、分块读取、分块删除
// src/core/file/ChunkedFileHandler.ts
// src/core/file/ChunkedFileHandler.ts
import { Directory, File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { meta } from "../meta/MetadataManager";

const CHUNK_EXT = ".ldb";
const META_FILE = "meta.ldb";

export class ChunkedFileHandler {
  constructor(private tableDir: Directory) {}

  private getChunkFile(index: number): File {
    return new File(this.tableDir, String(index).padStart(6, "0") + CHUNK_EXT);
  }

  private getMetaFile(): File {
    return new File(this.tableDir, META_FILE);
  }

  // write data to chunked file
  async append(data: Record<string, any>[]) {
    if (data.length === 0) return;

    // read current meta data
    // this place is to calculate the chunk index
    const currentMeta = meta.get(this.tableDir.name) || {
      mode: "chunked" as const,
      path: this.tableDir.name + "/",
      count: 0,
      chunks: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    let chunkIndex = currentMeta.chunks || 0;
    let currentChunk: Record<string, any>[] = [];

    for (const item of data) {
      currentChunk.push(item);

      // each 5000 items or 8MB, write a chunk
      // this place is to calculate the item number of chunk
      if (currentChunk.length >= 5000) {
        await this.writeChunk(chunkIndex, currentChunk);
        chunkIndex++;
        currentChunk = [];
      }
    }

    // write last chunk if not empty
    if (currentChunk.length > 0) {
      await this.writeChunk(chunkIndex, currentChunk);
      chunkIndex++;
    }

    // update meta data
    meta.update(this.tableDir.name, {
      mode: "chunked",
      count: currentMeta.count + data.length,
      chunks: chunkIndex,
    });
  }

  // write chunk to file
  private async writeChunk(index: number, data: Record<string, any>[]) {
    const file = this.getChunkFile(index);
    const content = JSON.stringify(data);
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      content
    );
    await file.write(JSON.stringify({ data, hash }));
  }

  // read all chunks
  async readAll(): Promise<Record<string, any>[]> {
    const metaFile = this.getMetaFile();
    const info = await metaFile.info();
    if (!info.exists) return [];

    let metaInfo;
    try {
      const text = await metaFile.text();
      metaInfo = JSON.parse(text);
    } catch {
      metaInfo = { chunks: 0 };
    }

    const all: Record<string, any>[] = [];
    for (let i = 0; i < metaInfo.chunks; i++) {
      const file = this.getChunkFile(i);
      const fileInfo = await file.info();
      if (!fileInfo.exists) continue;

      const text = await file.text();
      const parsed = JSON.parse(text);

      const expected = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(parsed.data)
      );
      if (expected !== parsed.hash) {
        console.warn(`Chunk ${i} corrupted, skipping`);
        continue;
      }

      all.push(...parsed.data);
    }

    return all;
  }

  async clear() {
    const entries = await this.tableDir.list();
    await Promise.all(
      entries.map(e => e.delete())
    );
  }
}