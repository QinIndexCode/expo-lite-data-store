import withTimeout from '../withTimeout';
import { StorageError } from '../../types/storageErrorInfc';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves before the timeout', async () => {
    const promise = Promise.resolve('success');
    const result = withTimeout(promise, 1000, 'test operation');
    await expect(result).resolves.toBe('success');
  });

  it('rejects with StorageError when the timeout elapses', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 2000));
    const timeoutPromise = withTimeout(promise, 1000, 'test operation');

    jest.advanceTimersByTime(1000);
    await expect(timeoutPromise).rejects.toThrow(StorageError);
    await expect(timeoutPromise).rejects.toThrow('test operation timeout');
  });

  it('propagates errors rejected before the timeout', async () => {
    const promise = Promise.reject(new Error('original error'));
    await expect(withTimeout(promise, 1000, 'test operation')).rejects.toThrow('original error');
  });

  it('uses the configured default timeout when none is provided', async () => {
    const promise = Promise.resolve('success');
    const result = withTimeout(promise, undefined, 'test operation');
    await expect(result).resolves.toBe('success');
  });

  it('uses the default operation name when none is provided', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 2000));
    const timeoutPromise = withTimeout(promise, 1000);

    jest.advanceTimersByTime(1000);
    await expect(timeoutPromise).rejects.toThrow('chunked file operation timeout');
  });

  it('clears the timeout after success', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000, 'test operation');
    expect(result).toBe('success');

    jest.advanceTimersByTime(2000);
  });

  it('clears the timeout after rejection', async () => {
    const promise = Promise.reject(new Error('fail'));
    await expect(withTimeout(promise, 1000, 'test operation')).rejects.toThrow('fail');

    jest.advanceTimersByTime(2000);
  });

  it('rejects a zero timeout', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 100));
    const timeoutPromise = withTimeout(promise, 0, 'test operation');

    jest.advanceTimersByTime(0);
    await expect(timeoutPromise).rejects.toThrow(StorageError);
  });

  it('rejects a short timeout', async () => {
    const promise = new Promise(resolve => setTimeout(resolve, 10));
    const timeoutPromise = withTimeout(promise, 5, 'test operation');

    jest.advanceTimersByTime(5);
    await expect(timeoutPromise).rejects.toThrow(StorageError);
  });

  it('preserves the timeout error type', async () => {
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
