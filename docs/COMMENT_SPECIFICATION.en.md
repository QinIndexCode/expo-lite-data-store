# Expo Lite Data Store Comment Specification

// Created: 2025-12-11
// Last Modified: 2025-12-12

## 1. General Principles

- **Concise and Clear**: Comments should be concise, accurate, and avoid redundancy or outdated content
- **Professional and Standard**: Use professional terminology, maintain language consistency
- **Accurate Reflection**: Comment content must accurately reflect code functionality and logic
- **Easy to Maintain**: Unified comment format, easy for subsequent maintenance and modification
- **Add Only When Necessary**: Only add necessary comments, avoid over-commenting

## 2. Comment Format

### 2.1 File Header Comment

Each file should contain file description comments at the top, including:

- File path
- File purpose
- Creation/modification information (optional)

```typescript
// src/core/service/TransactionService.ts
// Transaction management service, responsible for handling database transactions (begin, commit, rollback)
// Created: 2025-01-01
// Last Modified: 2025-12-11
```

### 2.2 Class Comment

Add comments before class definitions to explain the class purpose, main functions, and design intent:

```typescript
/**
 * Transaction management service
 * Responsible for handling database transactions (begin, commit, rollback)
 * Supports transaction nesting and snapshot management
 */
export class TransactionService {
  // Class implementation...
}
```

### 2.3 Function/Method Comment

Add comments before function/method definitions to explain:

- Function/method purpose
- Parameter description (type, meaning, whether optional)
- Return value description
- Exception/error situations
- Notes

```typescript
/**
 * Begin transaction
 * @returns Promise<void>
 * @throws {TransactionError} Thrown when transaction already exists
 */
async beginTransaction(): Promise<void> {
  // Method implementation...
}

/**
 * Commit transaction
 * @param writeHandler Write processing function
 * @param deleteHandler Delete processing function
 * @param bulkWriteHandler Bulk write processing function
 * @returns Promise<void>
 * @throws {TransactionError} Thrown when transaction does not exist or commit fails
 */
async commit(
  writeHandler: (tableName: string, data: any, options?: any) => Promise<any>,
  deleteHandler: (tableName: string, where: any) => Promise<number>,
  bulkWriteHandler: (tableName: string, operations: any[]) => Promise<any>
): Promise<void> {
  // Method implementation...
}
```

### 2.4 Variable/Constant Comment

Important variables or constants should have comments explaining their purpose, value range, or special meaning:

```typescript
/** Default chunk size: 5MB */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/** Encryption cache timeout: 30 minutes */
const ENCRYPTION_CACHE_TIMEOUT = 30 * 60 * 1000;
```

### 2.5 Key Logic Comment

Add comments to complex or key code logic, explaining:

- Logic flow
- Design ideas
- Reasons for special handling

```typescript
// Restore snapshot data for each table
for (const [tableName, snapshot] of snapshots.entries()) {
  // Directly write snapshot data, overwriting current table data
  await this.dataWriter.write(tableName, snapshot.data, { mode: 'overwrite' });
}
```

### 2.6 Notes Annotation

For code that requires special attention, add note comments:

```typescript
// Note: Private property access is used here, only for testing environment
const snapshots = this.transactionService['snapshots'] as Map<string, any>;
```

## 3. Comment Language

- **Unified Use of English**: All comments are written in English
- **Professional Terminology**: Use accurate professional terminology
- **Concise and Clear**: Avoid verbose or ambiguous descriptions
- **Correct Grammar**: Maintain grammatical correctness, avoid typos

## 4. Comment Types

### 4.1 Document Comments

Comments used for generating documentation, using JSDoc format, mainly used for:

- Class definitions
- Function/method definitions
- Interface definitions

### 4.2 Line Comments

Comments used to explain single lines of code or code blocks, using `//` format, mainly used for:

- Key logic explanation
- Variable meaning explanation
- Notes annotation

### 4.3 Block Comments

Comments used to comment multiple lines of code or temporarily disable code, using `/* */` format, mainly used for:

- Temporarily commenting out code
- Detailed explanation of complex logic

## 5. Comment Check List

When writing or optimizing comments, check:

- [ ] Whether comment content accurately reflects code functionality
- [ ] Whether comment format meets specifications
- [ ] Whether redundant or outdated comments have been deleted
- [ ] Whether missing necessary comments have been added
- [ ] Whether comment language is concise and clear
- [ ] Whether professional terminology is used correctly

## 6. Example File

```typescript
// src/core/service/TransactionService.ts
// Transaction management service, responsible for handling database transactions (begin, commit, rollback)

import { Transaction } from '../../types/transaction';

/**
 * Transaction management service
 * Responsible for handling database transactions (begin, commit, rollback)
 * Supports transaction nesting and snapshot management
 */
export class TransactionService {
  private transactions: Transaction[] = [];
  private snapshots: Map<string, any> = new Map();

  /**
   * Begin transaction
   * @returns Promise<void>
   * @throws {TransactionError} Thrown when transaction already exists
   */
  async beginTransaction(): Promise<void> {
    // Check if transaction already exists
    if (this.isInTransaction()) {
      throw new Error('Transaction already exists');
    }

    // Create new transaction and add to transaction stack
    const transaction: Transaction = {
      id: Date.now().toString(),
      startTime: Date.now(),
      operations: [],
      status: 'pending',
    };

    this.transactions.push(transaction);
  }

  /**
   * Check if in transaction
   * @returns boolean Whether in transaction
   */
  isInTransaction(): boolean {
    return this.transactions.length > 0;
  }

  /**
   * Commit transaction
   * @param writeHandler Write processing function
   * @param deleteHandler Delete processing function
   * @param bulkWriteHandler Bulk write processing function
   * @returns Promise<void>
   * @throws {TransactionError} Thrown when transaction does not exist or commit fails
   */
  async commit(
    writeHandler: (tableName: string, data: any, options?: any) => Promise<any>,
    deleteHandler: (tableName: string, where: any) => Promise<number>,
    bulkWriteHandler: (tableName: string, operations: any[]) => Promise<any>
  ): Promise<void> {
    // Get current transaction
    const transaction = this.transactions.pop();
    if (!transaction) {
      throw new Error('No transaction to commit');
    }

    try {
      // Execute all transaction operations
      for (const operation of transaction.operations) {
        switch (operation.type) {
          case 'write':
            await writeHandler(operation.tableName, operation.data, operation.options);
            break;
          case 'delete':
            await deleteHandler(operation.tableName, operation.data);
            break;
          case 'bulkWrite':
            await bulkWriteHandler(operation.tableName, operation.data);
            break;
        }
      }

      transaction.status = 'committed';
    } catch (error) {
      transaction.status = 'failed';
      throw error;
    }
  }

  /**
   * Rollback transaction
   * @returns Promise<void>
   */
  async rollback(): Promise<void> {
    // Get current transaction
    const transaction = this.transactions.pop();
    if (!transaction) {
      return;
    }

    transaction.status = 'rolled-back';
  }

  /**
   * Save table data snapshot
   * @param tableName Table name
   * @param data Table data
   */
  saveSnapshot(tableName: string, data: any): void {
    // Only save snapshot for first operation on this table
    if (!this.snapshots.has(tableName)) {
      this.snapshots.set(tableName, {
        data,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Add transaction operation
   * @param operation Operation object
   */
  addOperation(operation: any): void {
    const transaction = this.transactions[this.transactions.length - 1];
    if (transaction) {
      transaction.operations.push(operation);
    }
  }
}