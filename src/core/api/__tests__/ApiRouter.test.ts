// src/core/api/__tests__/ApiRouter.test.ts
// API路由器测试

import { ApiRouter } from '../ApiRouter';

describe('ApiRouter', () => {
  let apiRouter: ApiRouter;

  beforeEach(() => {
    apiRouter = new ApiRouter();
  });

  describe('API版本管理测试', () => {
    it('应该返回默认API版本', () => {
      const result = apiRouter.getApiVersion();
      expect(result).toBe('2.0.0'); // 默认版本
    });

    it('应该返回请求的有效API版本', () => {
      const result = apiRouter.getApiVersion('2.0.0');
      expect(result).toBe('2.0.0');
    });

    it('应该在请求无效版本时返回默认版本', () => {
      const result = apiRouter.getApiVersion('invalid-version');
      expect(result).toBe('2.0.0'); // 应该返回默认版本
    });

    it('应该能够获取支持的版本列表', () => {
      const versions = apiRouter.getSupportedVersions();
      expect(versions).toEqual(['1.0.0', '2.0.0']);
    });

    it('应该能够检查版本是否受支持', () => {
      const isSupported1 = apiRouter.isVersionSupported('1.0.0');
      expect(isSupported1).toBe(true);
      
      const isSupported2 = apiRouter.isVersionSupported('2.0.0');
      expect(isSupported2).toBe(true);
      
      const isNotSupported = apiRouter.isVersionSupported('3.0.0');
      expect(isNotSupported).toBe(false);
    });

    it('应该能够获取默认版本', () => {
      const defaultVersion = apiRouter.getDefaultVersion();
      expect(defaultVersion).toBe('2.0.0');
    });
  });

  describe('自定义配置测试', () => {
    it('应该能够使用自定义默认版本', () => {
      const customRouter = new ApiRouter({
        defaultVersion: '2.0.0',
        supportedVersions: ['1.0.0', '2.0.0']
      });
      const result = customRouter.getApiVersion();
      expect(result).toBe('2.0.0');
    });

    it('应该能够支持多个API版本', () => {
      const customRouter = new ApiRouter({
        supportedVersions: ['1.0.0', '2.0.0', '3.0.0']
      });
      
      expect(customRouter.isVersionSupported('1.0.0')).toBe(true);
      expect(customRouter.isVersionSupported('2.0.0')).toBe(true);
      expect(customRouter.isVersionSupported('3.0.0')).toBe(true);
      expect(customRouter.isVersionSupported('4.0.0')).toBe(false);
      
      // 获取支持的版本列表
      const versions = customRouter.getSupportedVersions();
      expect(versions).toEqual(['1.0.0', '2.0.0', '3.0.0']);
    });
  });
});