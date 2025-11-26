import { StorageErrorCode } from "./storageErrorCode.js";
export class StorageError extends Error {
    constructor(
        message: string,
        public readonly code: StorageErrorCode,
        public readonly cause?: unknown
    ) {
        super(message);
        this.name = "StorageError";
    }
}
