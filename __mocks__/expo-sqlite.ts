type MockParams = (string | number | null | boolean | undefined)[] | undefined;

interface NodeSqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (location: string) => NodeSqliteDatabase;
}

let sqliteModule: NodeSqliteModule | undefined;
try {
  sqliteModule = require('node:sqlite') as NodeSqliteModule;
} catch {
  // node:sqlite fallback handled below
}

interface MockState {
  databases: Record<string, unknown[]>;
  syncDbs: Record<string, NodeSqliteDatabase>;
}

declare global {
  var __expo_sqlite_mock__: MockState | undefined;
}

if (!globalThis.__expo_sqlite_mock__) {
  globalThis.__expo_sqlite_mock__ = {
    databases: {},
    syncDbs: {},
  };
}

const getMockState = (): MockState => {
  if (!globalThis.__expo_sqlite_mock__) {
    globalThis.__expo_sqlite_mock__ = {
      databases: {},
      syncDbs: {},
    };
  }
  return globalThis.__expo_sqlite_mock__;
};

const normalizeParams = (params: MockParams = []): (string | number | null)[] =>
  (params || []).map(p => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p === undefined) return null;
    return p;
  });

class MockSQLiteDatabase {
  constructor(public readonly name: string) {}

  private getDb(): NodeSqliteDatabase {
    const state = getMockState();
    if (!state.databases[this.name] || !state.syncDbs[this.name]) {
      if (state.syncDbs[this.name]) {
        try {
          state.syncDbs[this.name].close();
        } catch {
          // ignore close error
        }
      }
      if (sqliteModule) {
        state.syncDbs[this.name] = new sqliteModule.DatabaseSync(':memory:');
      } else {
        throw new Error('node:sqlite is required for SQLite mock execution');
      }
      state.databases[this.name] = [];
    }
    return state.syncDbs[this.name];
  }

  async execAsync(sql: string): Promise<void> {
    this.getDb().exec(sql);
  }

  async runAsync(sql: string, params: MockParams = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const stmt = this.getDb().prepare(sql);
    const result = stmt.run(...normalizeParams(params));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirstAsync<T>(sql: string, params: MockParams = []): Promise<T | null> {
    const stmt = this.getDb().prepare(sql);
    const row = stmt.get(...normalizeParams(params));
    return (row ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, params: MockParams = []): Promise<T[]> {
    const stmt = this.getDb().prepare(sql);
    return stmt.all(...normalizeParams(params)) as T[];
  }

  async closeAsync(): Promise<void> {
    const state = getMockState();
    if (state.syncDbs[this.name]) {
      try {
        state.syncDbs[this.name].close();
      } catch {
        // ignore
      }
      delete state.syncDbs[this.name];
      delete state.databases[this.name];
    }
  }
}

const openDatabaseAsync = async (
  databaseName: string,
  _options?: unknown,
  _directory?: string
): Promise<MockSQLiteDatabase> => {
  const state = getMockState();
  if (!state.databases[databaseName]) {
    state.databases[databaseName] = [];
  }
  return new MockSQLiteDatabase(databaseName);
};

const expoSqliteMock = {
  openDatabaseAsync,
  SQLiteProvider: undefined,
  useSQLiteContext: undefined,
};

export default expoSqliteMock;
export { openDatabaseAsync };
