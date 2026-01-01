// src/core/api/__tests__/ValidationWrapper.test.ts
// ValidationWrapper 单元测试

import { ValidationWrapper } from '../ValidationWrapper';
import { StorageError } from '../../../types/storageErrorInfc';

describe('ValidationWrapper', () => {
  let validationWrapper: ValidationWrapper;

  beforeEach(() => {
    validationWrapper = new ValidationWrapper();
  });

  describe('validateTableName 测试', () => {
    it('应该验证有效表名', () => {
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

    it('应该拒绝空表名', () => {
      expect(() => {
        validationWrapper.validateTableName('');
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName('   ');
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName(null as any);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateTableName(undefined as any);
      }).toThrow(StorageError);
    });

    it('应该拒绝无效字符的表名', () => {
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

    it('应该拒绝过长的表名', () => {
      // 创建一个超过最大长度的表名
      const longTableName = 'a'.repeat(101);
      expect(() => {
        validationWrapper.validateTableName(longTableName);
      }).toThrow(StorageError);
    });
  });

  describe('validateWriteData 测试', () => {
    it('应该验证有效的写入数据', () => {
      // 验证单个对象
      expect(() => {
        validationWrapper.validateWriteData({ id: 1, name: 'Test' });
      }).not.toThrow();

      // 验证对象数组
      expect(() => {
        validationWrapper.validateWriteData([
          { id: 1, name: 'Test 1' },
          { id: 2, name: 'Test 2' }
        ]);
      }).not.toThrow();
    });

    it('应该拒绝空数据', () => {
      expect(() => {
        validationWrapper.validateWriteData([]);
      }).toThrow(StorageError);
    });

    it('应该拒绝非对象数据', () => {
      expect(() => {
        validationWrapper.validateWriteData('string' as any);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData(123 as any);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData(null as any);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData(undefined as any);
      }).toThrow(StorageError);
    });

    it('应该拒绝数组中的无效对象', () => {
      expect(() => {
        validationWrapper.validateWriteData([
          { id: 1, name: 'Valid' },
          'invalid' as any,
          { id: 3, name: 'Valid' }
        ]);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData([
          { id: 1, name: 'Valid' },
          null as any,
          { id: 3, name: 'Valid' }
        ]);
      }).toThrow(StorageError);
    });

    it('应该拒绝空对象', () => {
      expect(() => {
        validationWrapper.validateWriteData({});
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateWriteData([
          { id: 1, name: 'Valid' },
          {},
          { id: 3, name: 'Valid' }
        ]);
      }).toThrow(StorageError);
    });
  });

  describe('validateFilter 测试', () => {
    it('应该验证有效的过滤条件', () => {
      expect(() => {
        validationWrapper.validateFilter({ id: 1 });
      }).not.toThrow();

      expect(() => {
        validationWrapper.validateFilter({ name: 'Test', age: { $gt: 18 } });
      }).not.toThrow();
    });

    it('应该拒绝无效的过滤条件', () => {
      expect(() => {
        validationWrapper.validateFilter({});
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateFilter(null as any);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateFilter('string' as any);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateFilter(123 as any);
      }).toThrow(StorageError);
    });
  });

  describe('validateBulkOperations 测试', () => {
    it('应该验证有效的批量操作', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([
          { type: 'insert', data: { id: 1, name: 'Test' } },
          { type: 'update', data: { name: 'Updated' }, where: { id: 1 } },
          { type: 'delete', where: { id: 1 } }
        ]);
      }).not.toThrow();
    });

    it('应该拒绝空操作数组', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([]);
      }).toThrow(StorageError);
    });

    it('应该拒绝非数组操作', () => {
      expect(() => {
        validationWrapper.validateBulkOperations({} as any);
      }).toThrow(StorageError);

      expect(() => {
        validationWrapper.validateBulkOperations('string' as any);
      }).toThrow(StorageError);
    });

    it('应该拒绝无效操作类型', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([
          { type: 'invalid' as any, data: { id: 1, name: 'Test' } }
        ]);
      }).toThrow(StorageError);
    });

    it('应该拒绝缺少数据的插入操作', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([
          { type: 'insert' } as any
        ]);
      }).toThrow(StorageError);
    });

    it('应该拒绝缺少数据的更新操作', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([
          { type: 'update', data: { name: 'Updated' } } as any
        ]);
      }).toThrow(StorageError);
    });

    it('应该拒绝缺少过滤条件的删除操作', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([
          { type: 'delete' } as any
        ]);
      }).toThrow(StorageError);
    });

    it('应该拒绝无效操作对象', () => {
      expect(() => {
        validationWrapper.validateBulkOperations([
          null as any
        ]);
      }).toThrow(StorageError);
      expect(() => {
        validationWrapper.validateBulkOperations([
          'string' as any
        ]);
      }).toThrow(StorageError);
    });
  });
});