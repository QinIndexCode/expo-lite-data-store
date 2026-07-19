import type { ApiResponse } from '../../types/apiResponse';
import type { IStorageAdapter } from '../../types/storageAdapterInfc';
import type {
  BulkOperation,
  CreateTableOptions,
  FilterCondition,
  FindOptions,
  NonInfer,
  ReadOptions,
  StorageInput,
  StorageRecord,
  WriteOptions,
  WriteResult,
} from '../../types/storageTypes';
import { ApiRouter } from './ApiRouter';
import { ErrorHandler as ApiErrorHandler } from './ApiErrorHandler';
import { RateLimitWrapper } from './RateLimitWrapper';
import type { RateLimitStatus } from './RateLimiter';
import { ValidationWrapper } from './ValidationWrapper';

/** Coordinates validation, throttling, storage, and response formatting for API calls. */
export class ApiWrapper {
  private apiRouter: ApiRouter;
  private rateLimitWrapper: RateLimitWrapper;
  private validationWrapper: ValidationWrapper;
  private errorHandler: ApiErrorHandler;
  private storageAdapter: IStorageAdapter;

  constructor(
    storageAdapter: IStorageAdapter,
    options: {
      defaultVersion?: string;
      supportedVersions?: string[];
      rateLimit?: {
        rate?: number;
        capacity?: number;
        enabled?: boolean;
      };
    } = {}
  ) {
    this.storageAdapter = storageAdapter;

    this.apiRouter = new ApiRouter({
      defaultVersion: options.defaultVersion,
      supportedVersions: options.supportedVersions,
    });

    this.rateLimitWrapper = new RateLimitWrapper(options.rateLimit);
    this.validationWrapper = new ValidationWrapper();
    this.errorHandler = new ApiErrorHandler();
  }

  private createRateLimitExceededResponse<T>(
    rateLimitStatus: RateLimitStatus,
    requestId: string,
    startTime: number,
    apiVersion: string
  ): ApiResponse<T> {
    return {
      success: false,
      data: undefined,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
        details: `Too many requests. Please try again after ${rateLimitStatus.retryAfter}ms.`,
        suggestion: 'Reduce the frequency of requests or contact support to increase your rate limit',
      },
      meta: {
        requestId,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        version: apiVersion,
      },
      status: 'error',
    };
  }

  private getWriteTokenCost<T extends object>(data: StorageInput<T>): number {
    return Array.isArray(data) ? Math.min(data.length, 10) : 3;
  }

  private getBulkWriteTokenCost(totalRecords: number): number {
    return Math.min(totalRecords * 2, 20);
  }

  async createTable<T extends object = StorageRecord>(
    tableName: string,
    options?: CreateTableOptions<NonInfer<T>>,
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<void>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      this.validationWrapper.validateTableName(tableName);
      if (options?.initialData !== undefined) {
        this.validationWrapper.validateInitialData(options.initialData);
      }

      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 5);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<void>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      await this.storageAdapter.createTable<T>(tableName, options);

      return {
        success: true,
        data: undefined,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<void>(error, requestId, startTime, apiVersion);
    }
  }

  async deleteTable(tableName: string, version?: string, clientId: string = 'default'): Promise<ApiResponse<void>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 3);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<void>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      this.validationWrapper.validateTableName(tableName);

      await this.storageAdapter.deleteTable(tableName);

      return {
        success: true,
        data: undefined,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<void>(error, requestId, startTime, apiVersion);
    }
  }

  async hasTable(tableName: string, version?: string, clientId: string = 'default'): Promise<ApiResponse<boolean>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 1);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<boolean>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      this.validationWrapper.validateTableName(tableName);

      const result = await this.storageAdapter.hasTable(tableName);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<boolean>(error, requestId, startTime, apiVersion);
    }
  }

  async listTables(version?: string, clientId: string = 'default'): Promise<ApiResponse<string[]>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 2);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<string[]>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      const result = await this.storageAdapter.listTables();

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<string[]>(error, requestId, startTime, apiVersion);
    }
  }

  async overwrite<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<NonInfer<T>>,
    options?: Omit<WriteOptions, 'mode'>,
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<WriteResult>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      this.validationWrapper.validateTableName(tableName);
      this.validationWrapper.validateWriteData(data);

      const tokens = this.getWriteTokenCost(data);
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, tokens);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<WriteResult>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      const result = await this.storageAdapter.overwrite<T>(tableName, data, options);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<WriteResult>(error, requestId, startTime, apiVersion);
    }
  }

  /**
   * Delegates to the legacy write operation.
   *
   * @deprecated Use insert or overwrite to make write semantics explicit.
   */
  async write<T extends object = StorageRecord>(
    tableName: string,
    data: StorageInput<NonInfer<T>>,
    options?: WriteOptions,
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<WriteResult>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      this.validationWrapper.validateTableName(tableName);
      this.validationWrapper.validateWriteData(data);

      const tokens = this.getWriteTokenCost(data);
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, tokens);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<WriteResult>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      const result = await this.storageAdapter.write<T>(tableName, data, options);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<WriteResult>(error, requestId, startTime, apiVersion);
    }
  }

  async read<T extends object = StorageRecord>(
    tableName: string,
    options?: ReadOptions<NonInfer<T>>,
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<T[]>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 2);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<T[]>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      this.validationWrapper.validateTableName(tableName);

      const result = await this.storageAdapter.read<T>(tableName, options);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<T[]>(error, requestId, startTime, apiVersion);
    }
  }

  async count(tableName: string, version?: string, clientId: string = 'default'): Promise<ApiResponse<number>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 1);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<number>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      this.validationWrapper.validateTableName(tableName);

      const result = await this.storageAdapter.count(tableName);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<number>(error, requestId, startTime, apiVersion);
    }
  }

  async findOne<T extends object = StorageRecord>(
    tableName: string,
    filter: FilterCondition<NonInfer<T>>,
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<T | null>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 1);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<T | null>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      this.validationWrapper.validateTableName(tableName);
      this.validationWrapper.validateFilter(filter);

      const result = await this.storageAdapter.findOne<T>(tableName, filter);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<T | null>(error, requestId, startTime, apiVersion);
    }
  }

  async findMany<T extends object = StorageRecord>(
    tableName: string,
    filter?: FilterCondition<NonInfer<T>>,
    options?: FindOptions<NonInfer<T>>,
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<T[]>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 2);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<T[]>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      this.validationWrapper.validateTableName(tableName);
      if (filter) {
        this.validationWrapper.validateFilter(filter);
      }

      const result = await this.storageAdapter.findMany<T>(tableName, filter, options);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<T[]>(error, requestId, startTime, apiVersion);
    }
  }

  async bulkWrite<T extends object = StorageRecord>(
    tableName: string,
    operations: BulkOperation<NonInfer<T>>[],
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<WriteResult>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      this.validationWrapper.validateTableName(tableName);
      const totalRecords = this.validationWrapper.validateBulkOperations(operations);

      const tokens = this.getBulkWriteTokenCost(totalRecords);
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, tokens);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<WriteResult>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      const result = await this.storageAdapter.bulkWrite<T>(tableName, operations);

      return {
        success: true,
        data: result,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<WriteResult>(error, requestId, startTime, apiVersion);
    }
  }

  async migrateToChunked(
    tableName: string,
    version?: string,
    clientId: string = 'default'
  ): Promise<ApiResponse<void>> {
    const startTime = Date.now();
    const requestId = this.errorHandler.generateRequestId();
    const apiVersion = this.apiRouter.getApiVersion(version);

    try {
      const rateLimitStatus = this.rateLimitWrapper.checkRateLimit(clientId, 10);
      if (!rateLimitStatus.allowed) {
        return this.createRateLimitExceededResponse<void>(rateLimitStatus, requestId, startTime, apiVersion);
      }

      this.validationWrapper.validateTableName(tableName);

      await this.storageAdapter.migrateToChunked(tableName);

      return {
        success: true,
        data: undefined,
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          version: apiVersion,
        },
        status: 'success',
      };
    } catch (error) {
      return this.errorHandler.handleError<void>(error, requestId, startTime, apiVersion);
    }
  }
}
