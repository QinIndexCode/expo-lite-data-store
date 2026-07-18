/// <reference path="../../../__tests__/test-globals.d.ts" />

import { MetadataManager } from '../MetadataManager';
import { getFileSystem } from '../../../utils/fileSystemCompat';

describe('MetadataManager', () => {
  let metadataManager: MetadataManager;
  const testTableName = 'test_table';

  beforeEach(() => {
    metadataManager = new MetadataManager();

    metadataManager.delete(testTableName);
  });

  describe('get', () => {
    it('returns undefined for a nonexistent table', () => {
      const result = metadataManager.get('non_existent_table');
      expect(result).toBeUndefined();
    });

    it('returns metadata for an existing table', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.get(testTableName);
      expect(result).toBeDefined();
      expect(result?.mode).toBe('single');
      expect(result?.path).toBe(`${testTableName}.ldb`);
      expect(result?.count).toBe(0);
    });
  });

  describe('getPath', () => {
    it('returns a table path', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.getPath(testTableName);
      expect(result).toBe(`${testTableName}.ldb`);
    });

    it('returns a default path for a nonexistent table', () => {
      const result = metadataManager.getPath('non_existent_table');
      expect(result).toBe('non_existent_table.ldb');
    });
  });

  describe('update', () => {
    it('creates metadata for a new table', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.get(testTableName);
      expect(result).toBeDefined();
      expect(result?.mode).toBe('single');
      expect(result?.count).toBe(0);
      expect(result?.columns).toEqual({
        id: 'string',
        name: 'string',
      });
    });

    it('updates metadata for an existing table', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      metadataManager.update(testTableName, {
        count: 10,
        mode: 'chunked',
        path: `${testTableName}/`,
      });

      const result = metadataManager.get(testTableName);
      expect(result).toBeDefined();
      expect(result?.count).toBe(10);
      expect(result?.mode).toBe('chunked');
      expect(result?.path).toBe(`${testTableName}/`);
      expect(result?.columns).toEqual({
        id: 'string',
        name: 'string',
      });
    });
  });

  describe('delete', () => {
    it('deletes table metadata', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      metadataManager.delete(testTableName);

      const result = metadataManager.get(testTableName);
      expect(result).toBeUndefined();
    });

    it('does not throw when deleting metadata for a nonexistent table', () => {
      expect(() => metadataManager.delete('non_existent_table')).not.toThrow();
    });
  });

  describe('allTables', () => {
    it('returns all table names', () => {
      metadataManager.update('table1', {
        mode: 'single',
        path: 'table1.ldb',
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
        },
      });

      metadataManager.update('table2', {
        mode: 'single',
        path: 'table2.ldb',
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
        },
      });

      metadataManager.update('table3', {
        mode: 'single',
        path: 'table3.ldb',
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
        },
      });

      const result = metadataManager.allTables();
      expect(result).toEqual(expect.arrayContaining(['table1', 'table2', 'table3']));
      expect(result.length).toBe(3);
    });

    it('returns an empty array when no tables exist', () => {
      metadataManager.delete(testTableName);

      const result = metadataManager.allTables();
      expect(result).toEqual([]);
    });
  });

  describe('count', () => {
    it('returns a table record count', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.count(testTableName);
      expect(result).toBe(5);
    });

    it('returns zero records for a nonexistent table', () => {
      const result = metadataManager.count('non_existent_table');
      expect(result).toBe(0);
    });
  });

  describe('debugDump_checkMetaCache', () => {
    it('returns the complete metadata cache', () => {
      metadataManager.update(testTableName, {
        mode: 'single',
        path: `${testTableName}.ldb`,
        count: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {
          id: 'string',
          name: 'string',
        },
      });

      const result = metadataManager.debugDump_checkMetaCache();
      expect(result).toBeDefined();
      expect(result.version).toBeDefined();
      expect(result.generatedAt).toBeDefined();
      expect(result.tables).toBeDefined();
      expect(result.tables[testTableName]).toBeDefined();
    });
  });

  it('rejects corrupted existing metadata without overwriting it', async () => {
    const metaPath = '/mock/documents/lite-data-store/meta.ldb';
    const fileSystem = global.__expo_file_system_mock__.mockFileSystem;
    fileSystem[metaPath] = 'not-valid-json';

    const manager = new MetadataManager();
    await expect(manager.waitForLoad()).rejects.toMatchObject({ code: 'META_FILE_READ_ERROR' });
    expect(fileSystem[metaPath]).toBe('not-valid-json');
    manager.cleanup();
  });

  it('serializes overlapping metadata flushes without losing later table updates', async () => {
    await metadataManager.saveImmediately();

    const fileSystem = getFileSystem();
    const originalWrite = fileSystem.writeAsStringAsync.bind(fileSystem);
    let releaseFirstWrite: (() => void) | undefined;
    let markFirstWriteStarted: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>(resolve => {
      markFirstWriteStarted = resolve;
    });
    const firstWriteGate = new Promise<void>(resolve => {
      releaseFirstWrite = resolve;
    });
    let metadataWriteCount = 0;

    const writeSpy = jest.spyOn(fileSystem, 'writeAsStringAsync').mockImplementation(async (uri, contents, options) => {
      if (uri.endsWith('meta.ldb.tmp')) {
        metadataWriteCount++;
        if (metadataWriteCount === 1) {
          markFirstWriteStarted?.();
          await firstWriteGate;
        }
      }
      return originalWrite(uri, contents, options);
    });

    try {
      metadataManager.update('concurrent_a', {
        mode: 'single',
        path: 'concurrent_a.ldb',
        count: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {},
      });
      const firstFlush = metadataManager.saveImmediately();
      await firstWriteStarted;

      metadataManager.update('concurrent_b', {
        mode: 'single',
        path: 'concurrent_b.ldb',
        count: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        columns: {},
      });
      const secondFlush = metadataManager.saveImmediately();

      releaseFirstWrite?.();
      await Promise.all([firstFlush, secondFlush]);

      const persistedText = global.__expo_file_system_mock__.mockFileSystem['/mock/documents/lite-data-store/meta.ldb'];
      if (typeof persistedText !== 'string') {
        throw new Error('Expected metadata persistence to create a file');
      }
      const persisted = JSON.parse(persistedText);
      expect(persisted.tables.concurrent_a.count).toBe(1);
      expect(persisted.tables.concurrent_b.count).toBe(2);
      expect(metadataWriteCount).toBe(2);
      expect(
        global.__expo_file_system_mock__.mockFileSystem['/mock/documents/lite-data-store/meta.ldb.tmp']
      ).toBeUndefined();
    } finally {
      releaseFirstWrite?.();
      writeSpy.mockRestore();
    }
  });
});
