type MockRecordRow = {
  table_name: string;
  id: number;
  payload: string;
};

type MockParams = (string | number | null | boolean)[] | undefined;

const mockDatabases: Record<string, MockRecordRow[]> = {};

const INSERT_RE = /^INSERT INTO __elds_records \(table_name, id, payload\) VALUES \(\?, \?, \?\)/i;
const DELETE_ALL_RE = /^DELETE FROM __elds_records WHERE table_name = \?/i;
const MAX_ID_RE = /^SELECT COALESCE\(MAX\(id\), 0\) \+ 1 AS nextId FROM __elds_records WHERE table_name = \?/i;
const READ_ALL_RE = /^SELECT id, payload FROM __elds_records WHERE table_name = \? ORDER BY id ASC/i;
const COUNT_ALL_RE = /^SELECT COUNT\(\*\) AS count FROM __elds_records WHERE table_name = \?/i;

class MockSQLiteDatabase {
  constructor(public readonly name: string) {}

  async execAsync(sql: string): Promise<void> {
    const trimmed = sql.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK|PRAGMA|CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX)/i.test(trimmed)) {
      return;
    }
    throw new Error(`Unsupported execAsync statement: ${sql}`);
  }

  async runAsync(sql: string, params: MockParams = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const rows = mockDatabases[this.name] ?? (mockDatabases[this.name] = []);
    if (INSERT_RE.test(sql)) {
      const [tableName, id, payload] = params as [string, number, string];
      const existingIndex = rows.findIndex(row => row.table_name === tableName && row.id === id);
      const inserted = { table_name: tableName, id, payload };
      if (existingIndex >= 0) {
        rows[existingIndex] = inserted;
        return { changes: 1, lastInsertRowId: id };
      }
      rows.push(inserted);
      return { changes: 1, lastInsertRowId: id };
    }
    if (DELETE_ALL_RE.test(sql)) {
      const [tableName] = params as [string];
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].table_name === tableName) {
          rows.splice(index, 1);
        }
      }
      return { changes: before - rows.length, lastInsertRowId: 0 };
    }
    throw new Error(`Unsupported runAsync statement: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: MockParams = []): Promise<T | null> {
    const rows = mockDatabases[this.name] ?? [];
    if (MAX_ID_RE.test(sql)) {
      const [tableName] = params as [string];
      const maxId = rows.reduce((max, row) => (row.table_name === tableName ? Math.max(max, row.id) : max), 0);
      return { nextId: maxId + 1 } as T;
    }
    if (COUNT_ALL_RE.test(sql)) {
      const [tableName] = params as [string];
      const count = rows.reduce((acc, row) => (row.table_name === tableName ? acc + 1 : acc), 0);
      return { count } as T;
    }
    throw new Error(`Unsupported getFirstAsync statement: ${sql}`);
  }

  async getAllAsync<T>(sql: string, params: MockParams = []): Promise<T[]> {
    const rows = mockDatabases[this.name] ?? [];
    if (READ_ALL_RE.test(sql)) {
      const [tableName] = params as [string];
      return rows
        .filter(row => row.table_name === tableName)
        .sort((a, b) => a.id - b.id)
        .map(row => ({ id: row.id, payload: row.payload })) as T[];
    }
    throw new Error(`Unsupported getAllAsync statement: ${sql}`);
  }
}

const openDatabaseAsync = async (
  databaseName: string,
  _options?: unknown,
  _directory?: string
): Promise<MockSQLiteDatabase> => {
  if (!mockDatabases[databaseName]) {
    mockDatabases[databaseName] = [];
  }
  return new MockSQLiteDatabase(databaseName);
};

const expoSqliteMock = {
  openDatabaseAsync,
  SQLiteProvider: undefined,
};

module.exports = Object.assign(expoSqliteMock, { default: expoSqliteMock });
