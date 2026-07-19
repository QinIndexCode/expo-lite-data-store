import {
  getLogicalRecordCount,
  hasInternalDirectWrite,
  TransactionService,
  TransactionError,
} from '../TransactionService';

type WriteFn = Parameters<TransactionService['commit']>[0];
type DeleteFn = Parameters<TransactionService['commit']>[1];
type BulkWriteFn = Parameters<TransactionService['commit']>[2];
type UpdateFn = Parameters<TransactionService['commit']>[3];
type ReadFn = Parameters<TransactionService['getCurrentTransactionData']>[1];

const successfulWriteResult = { written: 0, totalAfterWrite: 0, chunked: false };

const createWriteFn = () =>
  jest.fn<ReturnType<WriteFn>, Parameters<WriteFn>>().mockResolvedValue(successfulWriteResult);

const createDeleteFn = () => jest.fn<ReturnType<DeleteFn>, Parameters<DeleteFn>>().mockResolvedValue(0);

const createBulkWriteFn = () =>
  jest.fn<ReturnType<BulkWriteFn>, Parameters<BulkWriteFn>>().mockResolvedValue(successfulWriteResult);

const createUpdateFn = () => jest.fn<ReturnType<UpdateFn>, Parameters<UpdateFn>>().mockResolvedValue(0);

const createReadFn = (records: Awaited<ReturnType<ReadFn>>) =>
  jest.fn<ReturnType<ReadFn>, Parameters<ReadFn>>().mockResolvedValue(records);

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(() => {
    service = new TransactionService();
  });

  describe('beginTransaction', () => {
    it('starts a transaction', async () => {
      expect(service.isInTransaction()).toBe(false);
      await service.beginTransaction();
      expect(service.isInTransaction()).toBe(true);
    });

    it('rejects a second transaction while one is in progress', async () => {
      await service.beginTransaction();
      await expect(service.beginTransaction()).rejects.toThrow(TransactionError);
      await expect(service.beginTransaction()).rejects.toThrow('Transaction already in progress');
    });

    it('rejects transaction work from a different owner without ending the transaction', async () => {
      const owner = {};
      const otherOwner = {};
      await service.beginTransaction(owner);

      expect(() => service.saveSnapshot('users', [], true, otherOwner)).toThrow(
        'active transaction belongs to a different storage adapter'
      );
      await expect(service.getCurrentTransactionData('users', createReadFn([]), otherOwner)).rejects.toMatchObject({
        code: 'TRANSACTION_IN_PROGRESS',
      });
      await expect(
        service.commit(
          createWriteFn(),
          createDeleteFn(),
          createBulkWriteFn(),
          createUpdateFn(),
          undefined,
          undefined,
          otherOwner
        )
      ).rejects.toMatchObject({ code: 'TRANSACTION_IN_PROGRESS' });

      expect(service.isInTransaction()).toBe(true);
      await service.rollback(createWriteFn(), undefined, false, owner);
    });
  });

  describe('commit', () => {
    it('rejects a commit when no transaction is in progress', async () => {
      await expect(
        service.commit(createWriteFn(), createDeleteFn(), createBulkWriteFn(), createUpdateFn())
      ).rejects.toThrow(TransactionError);
    });

    it('executes queued write operations', async () => {
      const writeFn = createWriteFn();
      const deleteFn = createDeleteFn();
      const bulkWriteFn = createBulkWriteFn();
      const updateFn = createUpdateFn();

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 1, name: 'Alice' }] });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(writeFn).toHaveBeenCalledTimes(1);
      expect(writeFn).toHaveBeenCalledWith('users', [{ id: 1, name: 'Alice' }], expect.any(Object));
      expect(hasInternalDirectWrite(writeFn.mock.calls[0]?.[2])).toBe(true);
      expect(service.isInTransaction()).toBe(false);
    });

    it('executes queued overwrite operations in overwrite mode', async () => {
      const writeFn = createWriteFn();

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'overwrite', data: [{ id: 2, name: 'Bob' }] });
      await service.commit(writeFn, createDeleteFn(), createBulkWriteFn(), createUpdateFn());

      expect(writeFn).toHaveBeenCalledWith(
        'users',
        [{ id: 2, name: 'Bob' }],
        expect.objectContaining({ mode: 'overwrite' })
      );
      expect(hasInternalDirectWrite(writeFn.mock.calls[0]?.[2])).toBe(true);
    });

    it('executes queued update operations', async () => {
      const writeFn = createWriteFn();
      const deleteFn = createDeleteFn();
      const bulkWriteFn = createBulkWriteFn();
      const updateFn = createUpdateFn();

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'update', data: { name: 'Bob' }, where: { id: 1 } });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(updateFn).toHaveBeenCalledTimes(1);
      expect(updateFn).toHaveBeenCalledWith('users', { name: 'Bob' }, { id: 1 }, expect.any(Object));
      expect(hasInternalDirectWrite(updateFn.mock.calls[0]?.[3])).toBe(true);
    });

    it('executes queued delete operations', async () => {
      const writeFn = createWriteFn();
      const deleteFn = createDeleteFn();
      const bulkWriteFn = createBulkWriteFn();
      const updateFn = createUpdateFn();

      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'delete', where: { id: 1 } });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(deleteFn).toHaveBeenCalledTimes(1);
      expect(deleteFn).toHaveBeenCalledWith('users', { id: 1 }, expect.any(Object));
      expect(hasInternalDirectWrite(deleteFn.mock.calls[0]?.[2])).toBe(true);
    });

    it('executes queued bulk write operations', async () => {
      const writeFn = createWriteFn();
      const deleteFn = createDeleteFn();
      const bulkWriteFn = createBulkWriteFn();
      const updateFn = createUpdateFn();

      await service.beginTransaction();
      service.addOperation({
        tableName: 'users',
        type: 'bulkWrite',
        operations: [{ type: 'insert', data: { id: 1 } }],
      });
      await service.commit(writeFn, deleteFn, bulkWriteFn, updateFn);

      expect(bulkWriteFn).toHaveBeenCalledTimes(1);
    });

    it('rolls back and rethrows when a commit fails', async () => {
      const writeFn = jest.fn<ReturnType<WriteFn>, Parameters<WriteFn>>().mockRejectedValue(new Error('Write failed'));
      const deleteFn = createDeleteFn();
      const bulkWriteFn = createBulkWriteFn();
      const updateFn = createUpdateFn();

      await service.beginTransaction();
      service.saveSnapshot('users', [{ id: 1, name: 'Alice' }]);
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 2 }] });

      await expect(service.commit(writeFn, deleteFn, bulkWriteFn, updateFn)).rejects.toThrow('Write failed');
      expect(service.isInTransaction()).toBe(false);
    });
  });

  describe('rollback', () => {
    it('rejects a rollback when no transaction is in progress', async () => {
      await expect(service.rollback(createWriteFn())).rejects.toThrow(TransactionError);
    });

    it('restores snapshot data', async () => {
      const writeFn = createWriteFn();
      const snapshotData = [{ id: 1, name: 'Alice' }];

      await service.beginTransaction();
      service.saveSnapshot('users', snapshotData);
      await service.rollback(writeFn);

      expect(writeFn).toHaveBeenCalledWith('users', snapshotData, expect.objectContaining({ mode: 'overwrite' }));
      expect(hasInternalDirectWrite(writeFn.mock.calls[0]?.[2])).toBe(true);
      expect(service.isInTransaction()).toBe(false);
    });

    it('restores a snapshot with its persisted logical record count', async () => {
      const writeFn = createWriteFn();
      const envelope = [{ __enc: 'encrypted-envelope' }];

      await service.beginTransaction();
      service.saveSnapshot('secure_records', envelope, true, undefined, 7);
      await service.rollback(writeFn);

      expect(writeFn).toHaveBeenCalledWith('secure_records', envelope, expect.any(Object));
      expect(getLogicalRecordCount(writeFn.mock.calls[0]?.[2])).toBe(7);
    });

    it('resets state when a write fails', async () => {
      const writeFn = jest.fn<ReturnType<WriteFn>, Parameters<WriteFn>>().mockRejectedValue(new Error('Write failed'));

      await service.beginTransaction();
      service.saveSnapshot('users', [{ id: 1 }]);
      await expect(service.rollback(writeFn)).rejects.toThrow('Write failed');
      expect(service.isInTransaction()).toBe(false);
    });

    it('continues restoring other tables after one snapshot restore fails', async () => {
      await service.beginTransaction();
      service.saveSnapshot('users', [{ id: 1 }]);
      service.saveSnapshot('posts', [{ id: 2 }]);
      const writeFn = jest.fn<ReturnType<WriteFn>, Parameters<WriteFn>>().mockImplementation(async tableName => {
        if (tableName === 'posts') {
          throw new Error('posts restore failed');
        }
        return successfulWriteResult;
      });

      await expect(service.rollback(writeFn)).rejects.toMatchObject({ code: 'TRANSACTION_ROLLBACK_FAILED' });
      expect(writeFn).toHaveBeenCalledTimes(2);
      expect(writeFn).toHaveBeenCalledWith('users', [{ id: 1 }], expect.any(Object));
      expect(service.isInTransaction()).toBe(false);
    });
  });

  describe('saveSnapshot', () => {
    it('rejects snapshot saving when no transaction is in progress', () => {
      expect(() => service.saveSnapshot('users', [])).toThrow(TransactionError);
    });

    it('stores deep-copied snapshot data', async () => {
      await service.beginTransaction();
      const data = [{ id: 1, name: 'Alice' }];
      service.saveSnapshot('users', data);
      data[0].name = 'Modified';

      const writeFn = createWriteFn();
      await service.rollback(writeFn);
      expect(writeFn).toHaveBeenCalledWith('users', [{ id: 1, name: 'Alice' }], expect.any(Object));
    });

    it('stores one snapshot per table', async () => {
      await service.beginTransaction();
      service.saveSnapshot('users', [{ id: 1 }]);
      service.saveSnapshot('users', [{ id: 2 }]);

      const writeFn = createWriteFn();
      await service.rollback(writeFn);
      expect(writeFn).toHaveBeenCalledWith('users', [{ id: 1 }], expect.any(Object));
    });
  });

  describe('addOperation', () => {
    it('rejects queuing an operation when no transaction is in progress', () => {
      expect(() => service.addOperation({ tableName: 'users', type: 'write', data: [] })).toThrow(TransactionError);
    });

    it('queues an operation', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 1 }] });

      const writeFn = createWriteFn();
      await service.commit(writeFn, createDeleteFn(), createBulkWriteFn(), createUpdateFn());
      expect(writeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('transaction data management', () => {
    it('gets and sets transaction data', async () => {
      await service.beginTransaction();
      const data = [{ id: 1, name: 'Alice' }];
      service.setTransactionData('users', data);
      expect(service.getTransactionData('users')).toEqual(data);
    });

    it('returns undefined for a nonexistent table', async () => {
      await service.beginTransaction();
      expect(service.getTransactionData('nonexistent')).toBeUndefined();
    });

    it('clears transaction data on commit', async () => {
      await service.beginTransaction();
      service.setTransactionData('users', [{ id: 1 }]);
      await service.commit(createWriteFn(), createDeleteFn(), createBulkWriteFn(), createUpdateFn());
      expect(service.getTransactionData('users')).toBeUndefined();
    });
  });

  describe('getCurrentTransactionData', () => {
    it('applies queued write operations to data', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 2, name: 'Bob' }] });

      const readFn = createReadFn([{ id: 1, name: 'Alice' }]);
      const data = await service.getCurrentTransactionData('users', readFn);
      expect(data).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
    });

    it('exposes queued overwrite data inside the transaction', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'overwrite', data: [{ id: 2, name: 'Bob' }] });

      const readFn = createReadFn([{ id: 1, name: 'Alice' }]);
      await expect(service.getCurrentTransactionData('users', readFn)).resolves.toEqual([{ id: 2, name: 'Bob' }]);
    });

    it('caches computed transaction data', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'write', data: [{ id: 2 }] });

      const readFn = createReadFn([{ id: 1 }]);
      await service.getCurrentTransactionData('users', readFn);
      await service.getCurrentTransactionData('users', readFn);
      expect(readFn).toHaveBeenCalledTimes(1);
    });

    it('applies queued delete operations to data', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'users', type: 'delete', where: { id: 1 } });

      const readFn = createReadFn([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
      const data = await service.getCurrentTransactionData('users', readFn);
      expect(data).toEqual([{ id: 2, name: 'Bob' }]);
    });

    it('skips operations for other tables', async () => {
      await service.beginTransaction();
      service.addOperation({ tableName: 'posts', type: 'write', data: [{ id: 100 }] });

      const readFn = createReadFn([{ id: 1, name: 'Alice' }]);
      const data = await service.getCurrentTransactionData('users', readFn);
      expect(data).toEqual([{ id: 1, name: 'Alice' }]);
    });
  });
});
