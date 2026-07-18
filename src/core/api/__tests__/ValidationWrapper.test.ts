import { API_INPUT_LIMITS, ValidationWrapper } from '../ValidationWrapper';
import { StorageError } from '../../../types/storageErrorInfc';

const asInvalidInput = <T>(value: unknown): T => value as T;

describe('ValidationWrapper', () => {
  let validationWrapper: ValidationWrapper;
  type BulkOperations = Parameters<ValidationWrapper['validateBulkOperations']>[0];
  type Filter = Parameters<ValidationWrapper['validateFilter']>[0];
  type TableName = Parameters<ValidationWrapper['validateTableName']>[0];
  type WriteData = Parameters<ValidationWrapper['validateWriteData']>[0];

  beforeEach(() => {
    validationWrapper = new ValidationWrapper();
  });

  describe('validateTableName', () => {
    it('accepts valid table names', () => {
      expect(() => {
        validationWrapper.validateTableName('valid_table_name');
      }).not.toThrow();

      expect(() => {
        validationWrapper.validateTableName('table123');
      }).not.toThrow();

      expect(() => {
        validationWrapper.validateTableName('a');
      }).not.toThrow();
    });

    it('rejects blank table names', () => {
      expect(() => {
        validationWrapper.validateTableName('');
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName('   ');
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName(asInvalidInput<TableName>(null));
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName(asInvalidInput<TableName>(undefined));
      }).toThrow(StorageError);
    });

    it('rejects table names with invalid characters', () => {
      expect(() => {
        validationWrapper.validateTableName('invalid-table-name');
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName('invalid table name');
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName('123invalid');
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName('invalid@table@name');
      }).toThrow(StorageError);
    });

    it('rejects a table name longer than the limit', () => {
      const longTableName = 'a'.repeat(101);
      expect(() => {
        validationWrapper.validateTableName(longTableName);
      }).toThrow(StorageError);
    });
  });

  describe('validateWriteData', () => {
    it('accepts valid single and array record payloads', () => {
      expect(() => {
        validationWrapper.validateWriteData({ id: 1, name: 'Test' });
      }).not.toThrow();

      expect(() => {
        validationWrapper.validateWriteData([
          { id: 1, name: 'Test 1' },
          { id: 2, name: 'Test 2' },
        ]);
      }).not.toThrow();
    });

    it('rejects empty write data', () => {
      expect(() => {
        validationWrapper.validateWriteData([]);
      }).toThrow(StorageError);
    });

    it('rejects non-record write data', () => {
      expect(() => {
        validationWrapper.validateWriteData(asInvalidInput<WriteData>('string'));
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData(asInvalidInput<WriteData>(123));
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData(asInvalidInput<WriteData>(null));
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData(asInvalidInput<WriteData>(undefined));
      }).toThrow(StorageError);
    });

    it('rejects invalid records in an array payload', () => {
      expect(() => {
        validationWrapper.validateWriteData(
          asInvalidInput<WriteData>([{ id: 1, name: 'Valid' }, 'invalid', { id: 3, name: 'Valid' }])
        );
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData(
          asInvalidInput<WriteData>([{ id: 1, name: 'Valid' }, null, { id: 3, name: 'Valid' }])
        );
      }).toThrow(StorageError);
    });

    it('rejects empty records', () => {
      expect(() => {
        validationWrapper.validateWriteData({});
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData([{ id: 1, name: 'Valid' }, {}, { id: 3, name: 'Valid' }]);
      }).toThrow(StorageError);
    });

    it('limits record counts and serialized payload size', () => {
      expect(() => {
        validationWrapper.validateWriteData(
          Array.from({ length: API_INPUT_LIMITS.maxWriteRecords + 1 }, (_, id) => ({ id }))
        );
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData({ payload: 'x'.repeat(API_INPUT_LIMITS.maxSerializedPayloadBytes) });
      }).toThrow(StorageError);
    });
  });

  describe('validateFilter', () => {
    it('accepts valid filters', () => {
      expect(() => {
        validationWrapper.validateFilter({ id: 1 });
      }).not.toThrow();

      expect(() => {
        validationWrapper.validateFilter({ name: 'Test', age: { $gt: 18 } });
      }).not.toThrow();
    });

    it('rejects invalid filters', () => {
      expect(() => {
        validationWrapper.validateFilter({});
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateFilter(asInvalidInput<Filter>(null));
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateFilter(asInvalidInput<Filter>('string'));
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateFilter(asInvalidInput<Filter>(123));
      }).toThrow(StorageError);
    });
  });

  describe('validateBulkOperations', () => {
    it('accepts valid bulk operations', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([
          { type: 'insert', data: { id: 1, name: 'Test' } },
          { type: 'update', data: { name: 'Updated' }, where: { id: 1 } },
          { type: 'delete', where: { id: 1 } },
        ]);
      }).not.toThrow();
    });

    it('rejects an empty bulk operation array', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([]);
      }).toThrow(StorageError);
    });

    it('rejects non-array bulk operations', () => {
      expect(() => {
        validationWrapper.validateBulkOperations(asInvalidInput<BulkOperations>({}));
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateBulkOperations(asInvalidInput<BulkOperations>('string'));
      }).toThrow(StorageError);
    });

    it('rejects an invalid bulk operation type', () => {
      expect(() => {
        validationWrapper.validateBulkOperations(
          asInvalidInput<BulkOperations>([{ type: 'invalid', data: { id: 1, name: 'Test' } }])
        );
      }).toThrow(StorageError);
    });

    it('rejects an insert operation without data', () => {
      expect(() => {
        validationWrapper.validateBulkOperations(asInvalidInput<BulkOperations>([{ type: 'insert' }]));
      }).toThrow(StorageError);
    });

    it('rejects an update operation without data', () => {
      expect(() => {
        validationWrapper.validateBulkOperations(
          asInvalidInput<BulkOperations>([{ type: 'update', data: { name: 'Updated' } }])
        );
      }).toThrow(StorageError);
    });

    it('rejects a delete operation without a filter', () => {
      expect(() => {
        validationWrapper.validateBulkOperations(asInvalidInput<BulkOperations>([{ type: 'delete' }]));
      }).toThrow(StorageError);
    });

    it('rejects invalid bulk operation objects', () => {
      expect(() => {
        validationWrapper.validateBulkOperations(asInvalidInput<BulkOperations>([null]));
      }).toThrow(StorageError);
      expect(() => {
        validationWrapper.validateBulkOperations(asInvalidInput<BulkOperations>(['string']));
      }).toThrow(StorageError);
    });

    it('limits bulk operation and valid record counts', () => {
      expect(
        validationWrapper.validateBulkOperations([
          { type: 'insert', data: [{ id: 1 }, { id: 2 }] },
          { type: 'update', data: { status: 'done' }, where: { id: 1 } },
          { type: 'delete', where: { id: 2 } },
        ])
      ).toBe(4);

      expect(() => {
        validationWrapper.validateBulkOperations(
          Array.from({ length: API_INPUT_LIMITS.maxBulkOperations + 1 }, (_, id) => ({
            type: 'delete' as const,
            where: { id },
          }))
        );
      }).toThrow(StorageError);
    });
  });
});
