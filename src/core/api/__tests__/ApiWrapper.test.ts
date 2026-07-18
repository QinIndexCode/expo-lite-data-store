import { ApiWrapper } from '../ApiWrapper';
import { API_INPUT_LIMITS } from '../ValidationWrapper';
import type { IStorageAdapter } from '../../../types/storageAdapterInfc';

describe('ApiWrapper', () => {
  it('returns a standard rate-limit error instead of a success response', async () => {
    const wrapper = new ApiWrapper({} as IStorageAdapter, {
      rateLimit: {
        capacity: 1,
        rate: 0.001,
        enabled: true,
      },
    });

    const response = await wrapper.createTable('users');

    expect(response).toMatchObject({
      success: false,
      status: 'error',
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
      },
    });
  });

  it('rejects oversized bulk requests before rate-limit token calculation or storage access', async () => {
    const bulkWrite = jest.fn();
    const wrapper = new ApiWrapper({ bulkWrite } as unknown as IStorageAdapter, {
      rateLimit: {
        capacity: 1,
        rate: 1,
        enabled: true,
      },
    });

    const response = await wrapper.bulkWrite(
      'users',
      Array.from({ length: API_INPUT_LIMITS.maxBulkOperations + 1 }, (_, id) => ({
        type: 'delete' as const,
        where: { id },
      }))
    );

    expect(response).toMatchObject({
      success: false,
      status: 'error',
      error: {
        code: 'BULK_OPERATION_FAILED',
      },
    });
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
