// src/core/api/ApiRouter.ts
// API路由器，负责API版本管理和路由分发
// 创建于: 2025-12-03
// 最后修改: 2025-12-11

/**
 * API路由器类
 * 负责API版本管理和路由分发
 * 支持多版本API共存和自动版本回退
 */
export class ApiRouter {
  /**
   * 支持的API版本列表
   */
  private readonly supportedVersions: string[];

  /**
   * 默认API版本
   */
  private readonly defaultVersion: string;

  /**
   * 构造函数
   * @param options 路由配置选项
   */
  constructor(
    options: {
      defaultVersion?: string;
      supportedVersions?: string[];
    } = {}
  ) {
    this.supportedVersions = options.supportedVersions || ['1.0.0', '2.0.0'];
    this.defaultVersion = options.defaultVersion || '2.0.0';
  }

  /**
   * 检查并返回有效的API版本
   * @param version 请求的版本
   * @returns 有效的API版本
   */
  getApiVersion(version?: string): string {
    const requestedVersion = version || this.defaultVersion;

    if (this.supportedVersions.includes(requestedVersion)) {
      return requestedVersion;
    }

    // 如果请求的版本不支持，返回默认版本
    return this.defaultVersion;
  }

  /**
   * 获取支持的版本列表
   */
  getSupportedVersions(): string[] {
    return [...this.supportedVersions];
  }

  /**
   * 获取默认版本
   */
  getDefaultVersion(): string {
    return this.defaultVersion;
  }

  /**
   * 检查版本是否受支持
   * @param version 要检查的版本
   */
  isVersionSupported(version: string): boolean {
    return this.supportedVersions.includes(version);
  }
}
