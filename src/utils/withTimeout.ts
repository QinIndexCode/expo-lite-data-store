import { StorageError } from "../types/storageErrorInfc";

export default function withTimeout<T>(
    promise: Promise<T>,
    ms = 10000,
    operation = "chunked file operation"
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            setTimeout(
                () =>
                    reject(new StorageError(`${operation} timeout`, "TIMEOUT")),
                ms
            );
        }),
    ]);
}