// src/core/file/SingleFileHandler.ts
import { File, FileInfo } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { StorageError } from "../../types/storageErrorInfc";
import withTimeout from "../../utils/withTimeout.js";


export class SingleFileHandler {
  constructor(private file: File) {}

  async write(data: Record<string, any>[]) {
    try {
      if (!Array.isArray(data)) {
        throw new StorageError(
          `DATA_TYPE_ERROR: expected array, received ${typeof data}`,
          "FILE_CONTENT_INVALID"
        );
      }

      const content = JSON.stringify(data);
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        content
      );

      await withTimeout(
        Promise.resolve(this.file.write(JSON.stringify({ data, hash }))),
        10000,
        `write ${this.file.name}`
      );
    } catch (error) {
      throw new StorageError(
        `FILE_WRITE_ERROR: ${this.file.name}:`,
        "FILE_WRITE_FAILED",
        error
      );
    }
  }

  async read(): Promise<Record<string, any>[]> {
    try {
      const info: FileInfo = await withTimeout(
        Promise.resolve(this.file.info()),
        10000,
        `check ${this.file.name} existence`
      );
      if (!info.exists) return [];

      const text = await withTimeout(
        Promise.resolve(this.file.text()),
        10000,
        `read ${this.file.name} content`
      );
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== "object") {
        throw new StorageError("FILE_CONTENT_INVALID: corrupted data", "CORRUPTED_DATA");
      }

      if (!Array.isArray(parsed.data) || parsed.hash === undefined) {
        throw new StorageError("FILE_FORMAT_ERROR: missing valid data array or hash field", "CORRUPTED_DATA");
      }

      const expected = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(parsed.data)
      );

      if (expected !== parsed.hash) {
        throw new StorageError("FILE_INTEGRITY_ERROR: data may have been tampered with or corrupted", "CORRUPTED_DATA");
      }

      return parsed.data;
    } catch (error) {
      console.warn(`READ_FILE_ERROR: ${this.file.name}:`, error);
      return [];
    }
  }

  async delete() {
    try {
      const info: FileInfo = await withTimeout(
        Promise.resolve(this.file.info()),
        10000,
        `check ${this.file.name} deletability`
      );
      if (info.exists) {
        await withTimeout(
          Promise.resolve(this.file.delete()),
          10000,
          `delete ${this.file.name}`
        );
      }
    } catch (error) {
      console.warn(`DELETE_FILE_ERROR: ${this.file.name}:`, error);
    }
  }
}