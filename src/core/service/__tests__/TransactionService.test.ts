// src/core/service/__tests__/TransactionService.test.ts

import { TransactionService, TransactionError } from '../TransactionService';

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(() => {
    service = new TransactionService();
  });

  describe('beginTransaction', () => {
    it('should start a transaction', async () => {
      expect(service.isInTransaction()).toBe(false);
      await service.beginTransaction();
      expect(service.isInTransaction()).toBe(true);
    });

    it('should throw if transaction already in progress', async () => {
      await service.beginTransaction();
      await expect(service.beginTransaction()).rejects.toThrow(TransactionError);
      await expect(service.beginTransaction()).rejects.toThrow('Transaction already in progress');
    });
  });

  describe('commit', () => {
    it('should throw if no transaction in progress', async () => {
      await expect(
        service.commit(
          async () => {},
          async () => {},
          async () => {},
          async () => {}
        )
      ).rejects.toThrow(TransactionError);
    });

    it('should execute write operations', async () => {
      const writeFn = jest.fn().mockResolvedValue(undefined);
      const deleteFn = jest.fn().mockResolvedValue(undefined);
      const bulkWriteFn = jest.fn().mockResolvedValue(undefined);
      const updateFn = jest.fn().mockResolvedValue(undefined);

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 1, name: 'Alice' }] });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(writeFn).toHaveBeenCalledTimes(1);
      expect(writeFn).toHaveBeenCalledWith(
        'users',
        [{ id: 1, name: 'Alice' }],
        expect.objectContaining({ directWrite: true })
      );
      expect(service.isInTransaction()).toBe(false);
    });

    it('should execute update operations', async () => {
      const writeFn = jest.fn().mockResolvedValue(undefined);
      const deleteFn = jest.fn().mockResolvedValue(undefined);
      const bulkWriteFn = jest.fn().mockResolvedValue(undefined);
      const updateFn = jest.fn().mockResolvedValue(undefined);

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'update', data: { name: 'Bob' }, where: { id: 1 } });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(updateFn).toHaveBeenCalledTimes(1);
      expect(updateFn).toHaveBeenCalledWith(
        'users',
        { name: 'Bob' },
        { id: 1 },
        expect.objectContaining({ directWrite: true })
      );
    });

    it('should execute delete operations', async () => {
      const writeFn = jest.fn().mockResolvedValue(undefined);
      const deleteFn = jest.fn().mockResolvedValue(undefined);
      const bulkWriteFn = jest.fn().mockResolvedValue(undefined);
      const updateFn = jest.fn().mockResolvedValue(undefined);

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'delete', data: { id: 1 } });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(deleteFn).toHaveBeenCalledTimes(1);
      expect(deleteFn).toHaveBeenCalledWith('users', { id: 1 }, expect.objectContaining({ directWrite: true }));
    });

    it('should execute bulkWrite operations', async () => {
      const writeFn = jest.fn().mockResolvedValue(undefined);
      const deleteFn = jest.fn().mockResolvedValue(undefined);
      const bulkWriteFn = jest.fn().mockResolvedValue(undefined);
      const updateFn = jest.fn().mockResolvedValue(undefined);

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'bulkWrite', data: [{ type: 'insert', data: { id: 1 } }] });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(bulkWriteFn).toHaveBeenCalledTimes(1);
    });

    it('should rollback on failure and rethrow error', async () => {
      const writeFn = jest.fn().mockRejectedValue(new Error('Write failed'));
      const deleteFn = jest.fn().mockResolvedValue(undefined);
      const bulkWriteFn = jest.fn().mockResolvedValue(undefined);
      const updateFn = jest.fn().mockResolvedValue(undefined);

      await service.beginTransaction();
      service.saveSnapshot('users', [{ id: 1, name: 'Alice' }]);
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 2 }] });

      await expect(service.commit(writeFn, deleteFn, bulkWriteFn, updateFn)).rejects.toThrow('Write failed');
      expect(service.isInTransaction()).toBe(false);
    });
  });

  describe('rollback', () => {
    it('should throw if no transaction in progress', async () => {
      await expect(service.rollback(async () => {})).rejects.toThrow(TransactionError);
    });

    it('should restore snapshot data', async () => {
      const writeFn = jest.fn().mockResolvedValue(undefined);
      const snapshotData = [{ id: 1, name: 'Alice' }];

      await service.beginTransaction();
      service.saveSnapshot('users', snapshotData);
      await service.rollback(writeFn);

      expect(writeFn).toHaveBeenCalledWith('users', snapshotData, { mode: 'overwrite', directWrite: true });
      expect(service.isInTransaction()).toBe(false);
    });

    it('should reset state even if write fails', async () => {
      const writeFn = jest.fn().mockRejectedValue(new Error('Write failed'));

      await service.beginTransaction();
      service.saveSnapshot('users', [{ id: 1 }]);
      await expect(service.rollback(writeFn)).rejects.toThrow('Write failed');
      expect(service.isInTransaction()).toBe(false);
    });
  });

  describe('saveSnapshot', () => {
    it('should throw if no transaction in progress', () => {
      expect(() => service.saveSnapshot('users', [])).toThrow(TransactionError);
    });

    it('should save deep-copied snapshot data', async () => {
      await service.beginTransaction();
      const data = [{ id: 1, name: 'Alice' }];
      service.saveSnapshot('users', data);
      data[0].name = 'Modified';

      const writeFn = jest.fn().mockResolvedValue(undefined);
      await service.rollback(writeFn);
      expect(writeFn).toHaveBeenCalledWith('users', [{ id: 1, name: 'Alice' }], expect.any(Object));
    });

    it('should only save snapshot once per table', async () => {
      await service.beginTransaction();
      service.saveSnapshot('users', [{ id: 1 }]);
      service.saveSnapshot('users', [{ id: 2 }]);

      const writeFn = jest.fn().mockResolvedValue(undefined);
      await service.rollback(writeFn);
      expect(writeFn).toHaveBeenCalledWith('users', [{ id: 1 }], expect.any(Object));
    });
  });

  describe('addOperation', () => {
    it('should throw if no transaction in progress', () => {
      expect(() => service.addOperation({ tableName: 'users', type: 'write', data: [] })).toThrow(TransactionError);
    });

    it('should add operation to queue', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 1 }] });

      const writeFn = jest.fn().mockResolvedValue(undefined);
      await service.commit(writeFn, jest.fn(), jest.fn(), jest.fn());
      expect(writeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('transaction data management', () => {
    it('should get and set transaction data', async () => {
      await service.beginTransaction();
      const data = [{ id: 1, name: 'Alice' }];
      service.setTransactionData('users', data);
      expect(service.getTransactionData('users')).toEqual(data);
    });

    it('should return undefined for non-existent table', async () => {
      await service.beginTransaction();
      expect(service.getTransactionData('nonexistent')).toBeUndefined();
    });

    it('should clear transaction data on commit', async () => {
      await service.beginTransaction();
      service.setTransactionData('users', [{ id: 1 }]);
      await service.commit(jest.fn(), jest.fn(), jest.fn(), jest.fn());
      expect(service.getTransactionData('users')).toBeUndefined();
    });
  });

  describe('getCurrentTransactionData', () => {
    it('should apply write operations to data', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 2, name: 'Bob' }] });

      const readFn = jest.fn().mockResolvedValue([{ id: 1, name: 'Alice' }]);
      const data = await service.getCurrentTransactionData('users', readFn);
      expect(data).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
    });

    it('should cache computed transaction data', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 2 }] });

      const readFn = jest.fn().mockResolvedValue([{ id: 1 }]);
      await service.getCurrentTransactionData('users', readFn);
      await service.getCurrentTransactionData('users', readFn);
      expect(readFn).toHaveBeenCalledTimes(1);
    });

    it('should apply delete operations to data', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'delete', data: { id: 1 } });

      const readFn = jest.fn().mockResolvedValue([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
      const data = await service.getCurrentTransactionData('users', readFn);
      expect(data).toEqual([{ id: 2, name: 'Bob' }]);
    });

    it('should skip operations for other tables', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'posts', type: 'write', data: [{ id: 100 }] });

      const readFn = jest.fn().mockResolvedValue([{ id: 1, name: 'Alice' }]);
      const data = await service.getCurrentTransactionData('users', readFn);
      expect(data).toEqual([{ id: 1, name: 'Alice' }]);
    });
  });
});
