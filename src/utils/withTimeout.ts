/**
 * @module withTimeout
 * @description Promise timeout utility to prevent operations from hanging indefinitely
 * @since 2025-11-19
 * @version 1.0.0
 */
import { StorageError } from '../types/storageErrorInfc';
import { configManager } from '../core/config/ConfigManager';

/**
 * Adds a timeout mechanism to a Promise
 * @template T Return type of the Promise
 * @param promise Promise to add timeout to
 * @param ms Timeout duration in milliseconds (defaults to config timeout)
 * @param operation Operation description for error message
 * @returns Promise<T> Promise with timeout mechanism
 * @throws StorageError Throws timeout error when operation exceeds timeout
 * @example
 * // Add timeout to a file read operation
 * const result = await withTimeout(
 *   fileHandler.read(),
 *   5000, // 5 second timeout
 *   "file read operation"
 * );
 */
export default function withTimeout<T>(
  promise: Promise<T>,
  ms = configManager.getConfig().timeout,
  operation = 'chunked file operation'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new StorageError(`${operation} timeout`, 'TIMEOUT')), ms);
    }),
  ])
    .then(result => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      return result;
    })
    .catch(error => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      throw error;
    });
}
