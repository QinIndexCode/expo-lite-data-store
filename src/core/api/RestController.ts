// src/core/api/RestController.ts
// RESTful API控制器，用于优化API设计和批量操作
// 创建于: 2025-11-28
// 最后修改: 2025-12-11

import { ApiResponse } from '../../types/apiResponse';
import type { CreateTableOptions, ReadOptions, WriteOptions, WriteResult } from '../../types/storageTypes';
import { ApiWrapper } from './ApiWrapper';

/**
 * RESTful API控制器类，用于优化API设计和批量操作
 */
export class RestController {
  /**
   * API包装器实例
   */
  private apiWrapper: ApiWrapper;

  /**
   * 构造函数
   * @param apiWrapper API包装器实例
   */
  constructor(apiWrapper: ApiWrapper) {
    this.apiWrapper = apiWrapper;
  }

  // ==================== 表管理（RESTful设计） ====================

  /**
   * 创建表（POST /tables）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async createTable(request: {
    tableName: string;
    options?: CreateTableOptions & {
      columns?: Record<string, string>;
      initialData?: Record<string, any>[];
      mode?: 'single' | 'chunked';
    };
    version?: string;
  }): Promise<ApiResponse<void>> {
    return this.apiWrapper.createTable(request.tableName, request.options, request.version);
  }

  /**
   * 获取表列表（GET /tables）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async listTables(request: { version?: string }): Promise<ApiResponse<string[]>> {
    return this.apiWrapper.listTables(request.version);
  }

  /**
   * 获取表信息（GET /tables/{tableName}）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async getTableInfo(request: {
    tableName: string;
    version?: string;
  }): Promise<ApiResponse<{ exists: boolean; count: number }>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    const apiVersion = request.version || '1.0.0';

    try {
      const exists = await this.apiWrapper.hasTable(request.tableName, request.version);
      let count = 0;

      if (exists.data) {
        const countResult = await this.apiWrapper.count(request.tableName, request.version);
        count = countResult.data || 0;
      }

      return {
        success: true,
        data: { exists: exists.data || false, count },
        error: undefined,
        meta: {
          requestId,
          timestamp: Date.now(),
          version: apiVersion,
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        success: false,
        data: undefined,
        error: {
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : 'An unknown error occurred',
          details: 'Failed to get table info',
          suggestion: 'Please check the table name and try again',
        },
        meta: {
          requestId,
          timestamp: Date.now(),
          version: apiVersion,
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * 删除表（DELETE /tables/{tableName}）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async deleteTable(request: { tableName: string; version?: string }): Promise<ApiResponse<void>> {
    return this.apiWrapper.deleteTable(request.tableName, request.version);
  }

  // ==================== 数据操作（RESTful设计） ====================

  /**
   * 创建数据（POST /tables/{tableName}/records）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async createRecord(request: {
    tableName: string;
    data: Record<string, any> | Record<string, any>[];
    options?: WriteOptions;
    version?: string;
  }): Promise<ApiResponse<WriteResult>> {
    return this.apiWrapper.write(
      request.tableName,
      request.data,
      {
        ...request.options,
        mode: 'append',
      },
      request.version
    );
  }

  /**
   * 获取数据列表（GET /tables/{tableName}/records）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async getRecords(request: {
    tableName: string;
    options?: ReadOptions;
    version?: string;
  }): Promise<ApiResponse<Record<string, any>[]>> {
    return this.apiWrapper.read(request.tableName, request.options, request.version);
  }

  /**
   * 获取单条数据（GET /tables/{tableName}/records/{id}）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async getRecord(request: {
    tableName: string;
    id: string | number;
    version?: string;
  }): Promise<ApiResponse<Record<string, any> | null>> {
    return this.apiWrapper.findOne(request.tableName, { id: request.id }, request.version);
  }

  /**
   * 更新数据（PUT /tables/{tableName}/records/{id}）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async updateRecord(request: {
    tableName: string;
    id: string | number;
    data: Record<string, any>;
    version?: string;
  }): Promise<ApiResponse<WriteResult>> {
    // 先获取现有数据
    const existingRecord = await this.apiWrapper.findOne(request.tableName, { id: request.id }, request.version);

    if (!existingRecord.data) {
      return {
        success: false,
        data: undefined,
        error: {
          code: 'RECORD_NOT_FOUND',
          message: `Record with id ${request.id} not found`,
          details: `No record found with the specified id`,
          suggestion: 'Please check the record id and try again',
        },
        meta: {
          requestId: this.generateRequestId(),
          timestamp: Date.now(),
          version: request.version || '1.0.0',
          duration: Date.now() - 0,
        },
      };
    }

    // 合并数据
    const updatedData = { ...existingRecord.data, ...request.data, id: request.id };

    // 使用bulkWrite进行更新操作
    return this.apiWrapper.bulkWrite(
      request.tableName,
      [
        {
          type: 'update',
          data: updatedData,
          where: { id: request.id },
        },
      ],
      request.version
    );
  }

  /**
   * 删除数据（DELETE /tables/{tableName}/records/{id}）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async deleteRecord(request: {
    tableName: string;
    id: string | number;
    version?: string;
  }): Promise<ApiResponse<WriteResult>> {
    // 使用bulkWrite进行删除操作
    return this.apiWrapper.bulkWrite(
      request.tableName,
      [
        {
          type: 'delete',
          where: { id: request.id },
        },
      ],
      request.version
    );
  }

  // ==================== 批量操作优化 ====================

  /**
   * 批量操作（POST /tables/{tableName}/bulk）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async bulkOperation(request: {
    tableName: string;
    operations: Array<
      | {
          type: 'insert';
          data: Record<string, any> | Record<string, any>[];
        }
      | {
          type: 'update';
          data: Record<string, any>;
          where: Record<string, any>;
        }
      | {
          type: 'delete';
          where: Record<string, any>;
        }
    >;
    version?: string;
  }): Promise<ApiResponse<WriteResult>> {
    return this.apiWrapper.bulkWrite(request.tableName, request.operations, request.version);
  }

  /**
   * 批量创建数据（POST /tables/{tableName}/bulk/insert）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async bulkInsert(request: {
    tableName: string;
    data: Record<string, any>[];
    version?: string;
  }): Promise<ApiResponse<WriteResult>> {
    return this.apiWrapper.bulkWrite(
      request.tableName,
      [
        {
          type: 'insert',
          data: request.data,
        },
      ],
      request.version
    );
  }

  /**
   * 批量更新数据（PUT /tables/{tableName}/bulk/update）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async bulkUpdate(request: {
    tableName: string;
    data: Record<string, any>[];
    version?: string;
  }): Promise<ApiResponse<WriteResult>> {
    // 使用bulkWrite进行更新操作
    const operations = request.data.map(item => ({
      type: 'update' as const,
      data: item,
      where: { id: item.id }
    }));
    return this.apiWrapper.bulkWrite(request.tableName, operations, request.version);
  }

  /**
   * 批量删除数据（DELETE /tables/{tableName}/bulk/delete）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async bulkDelete(request: {
    tableName: string;
    ids: Array<string | number>;
    version?: string;
  }): Promise<ApiResponse<WriteResult>> {
    // 将ids转换为delete操作
    const operations = request.ids.map(id => ({
      type: 'delete' as const,
      where: { id }
    }));

    return this.apiWrapper.bulkWrite(request.tableName, operations, request.version);
  }

  // ==================== 表迁移 ====================

  /**
   * 迁移到分片模式（POST /tables/{tableName}/migrate/chunked）
   * @param request 请求对象
   * @returns 统一格式的API响应
   */
  async migrateToChunked(request: { tableName: string; version?: string }): Promise<ApiResponse<void>> {
    return this.apiWrapper.migrateToChunked(request.tableName, request.version);
  }

  // ==================== 辅助方法 ====================

  /**
   * 生成请求ID
   * @returns 请求ID
   */
  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
