import { FILE_OPERATION, REGEX } from '../core/constants';
import { StorageError } from '../types/storageErrorInfc';

const RESERVED_TABLE_NAMES = new Set(['meta']);

export const assertValidTableName = (tableName: string): void => {
  if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
    throw new StorageError('Invalid table name: table name cannot be empty', 'TABLE_NAME_INVALID');
  }

  if (tableName.length > FILE_OPERATION.MAX_TABLE_NAME_LENGTH) {
    throw new StorageError(
      `Invalid table name: table name too long (max ${FILE_OPERATION.MAX_TABLE_NAME_LENGTH} characters)`,
      'TABLE_NAME_INVALID'
    );
  }

  if (!REGEX.TABLE_NAME.test(tableName)) {
    throw new StorageError(
      'Invalid table name: table name must start with a letter and contain only letters, numbers, and underscores',
      'TABLE_NAME_INVALID'
    );
  }

  if (RESERVED_TABLE_NAMES.has(tableName.toLowerCase())) {
    throw new StorageError('Invalid table name: table name is reserved for internal storage', 'TABLE_NAME_INVALID');
  }
};
