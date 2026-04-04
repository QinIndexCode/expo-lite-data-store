// src/utils/__tests__/withTimeout.test.ts

import withTimeout from '../withTimeout';
import { StorageError } from '../../types/storageErrorInfc';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should resolve if promise resolves before timeout', async () => {
    const promise = Promise.resolve('success');
    const result = withTimeout(promise, 1000, 'test operation');
    await expect(result).resolves.toBe('success');
  });

  it('should reject with StorageError if promise times out', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 2000));
    const timeoutPromise = withTimeout(promise, 1000, 'test operation');

    jest.advanceTimersByTime(1000);
    await expect(timeoutPromise).rejects.toThrow(StorageError);
    await expect(timeoutPromise).rejects.toThrow('test operation timeout');
  });

  it('should reject with original error if promise rejects before timeout', async () => {
    const promise = Promise.reject(new Error('original error'));
    await expect(withTimeout(promise, 1000, 'test operation')).rejects.toThrow('original error');
  });

  it('should use default timeout from config if not provided', async () => {
    const promise = Promise.resolve('success');
    const result = withTimeout(promise, undefined, 'test operation');
    await expect(result).resolves.toBe('success');
  });

  it('should use default operation name if not provided', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 2000));
    const timeoutPromise = withTimeout(promise, 1000);

    jest.advanceTimersByTime(1000);
    await expect(timeoutPromise).rejects.toThrow('chunked file operation timeout');
  });

  it('should clean up timeout on success', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000, 'test operation');
    expect(result).toBe('success');

    // Advance timers past timeout - should not cause issues
    jest.advanceTimersByTime(2000);
  });

  it('should clean up timeout on rejection', async () => {
    const promise = Promise.reject(new Error('fail'));
    await expect(withTimeout(promise, 1000, 'test operation')).rejects.toThrow('fail');

    // Advance timers past timeout - should not cause issues
    jest.advanceTimersByTime(2000);
  });

  it('should handle zero timeout', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 100));
    const timeoutPromise = withTimeout(promise, 0, 'test operation');

    jest.advanceTimersByTime(0);
    await expect(timeoutPromise).rejects.toThrow(StorageError);
  });

  it('should handle very short timeout', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 10));
    const timeoutPromise = withTimeout(promise, 5, 'test operation');

    jest.advanceTimersByTime(5);
    await expect(timeoutPromise).rejects.toThrow(StorageError);
  });

  it('should preserve error type for timeout errors', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 2000));
    const timeoutPromise = withTimeout(promise, 1000, 'test operation');

    jest.advanceTimersByTime(1000);
    try {
      await timeoutPromise;
      fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('TIMEOUT');
    }
  });
});
