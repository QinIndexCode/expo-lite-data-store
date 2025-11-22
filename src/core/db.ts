import { storage } from "./adapter/FileSystemStorageAdapter";
import { EncryptedStorageAdapter } from "./EncryptedStorageAdapter";

const USE_ENCRYPTION = true; // 上线改 true，调试改 false

export const db = USE_ENCRYPTION
  ? new EncryptedStorageAdapter()
  : storage;

// 调试时可以直接看明文
export const plainStorage = storage;