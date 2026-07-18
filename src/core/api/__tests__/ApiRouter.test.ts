import { ApiRouter } from '../ApiRouter';

describe('ApiRouter', () => {
  let apiRouter: ApiRouter;

  beforeEach(() => {
    apiRouter = new ApiRouter();
  });

  describe('version resolution', () => {
    it('returns the default API version when none is requested', () => {
      const result = apiRouter.getApiVersion();
      expect(result).toBe('2.0.0');
    });

    it('returns a requested supported API version', () => {
      const result = apiRouter.getApiVersion('2.0.0');
      expect(result).toBe('2.0.0');
    });

    it('falls back to the default version for an unsupported request', () => {
      const result = apiRouter.getApiVersion('invalid-version');
      expect(result).toBe('2.0.0');
    });

    it('returns an isolated supported-version list', () => {
      const versions = apiRouter.getSupportedVersions();
      expect(versions).toEqual(['1.0.0', '2.0.0']);

      versions.push('3.0.0');
      expect(apiRouter.getSupportedVersions()).toEqual(['1.0.0', '2.0.0']);
    });

    it('reports whether a version is supported', () => {
      const isSupported1 = apiRouter.isVersionSupported('1.0.0');
      expect(isSupported1).toBe(true);

      const isSupported2 = apiRouter.isVersionSupported('2.0.0');
      expect(isSupported2).toBe(true);

      const isNotSupported = apiRouter.isVersionSupported('3.0.0');
      expect(isNotSupported).toBe(false);
    });

    it('returns the configured default version', () => {
      const defaultVersion = apiRouter.getDefaultVersion();
      expect(defaultVersion).toBe('2.0.0');
    });
  });

  describe('custom configuration', () => {
    it('uses a configured supported default version', () => {
      const customRouter = new ApiRouter({
        defaultVersion: '2.0.0',
        supportedVersions: ['1.0.0', '2.0.0'],
      });
      const result = customRouter.getApiVersion();
      expect(result).toBe('2.0.0');
    });

    it('uses the newest configured version as the default when none is provided', () => {
      const customRouter = new ApiRouter({
        supportedVersions: ['1.0.0', '2.0.0', '3.0.0'],
      });

      expect(customRouter.isVersionSupported('1.0.0')).toBe(true);
      expect(customRouter.isVersionSupported('2.0.0')).toBe(true);
      expect(customRouter.isVersionSupported('3.0.0')).toBe(true);
      expect(customRouter.isVersionSupported('4.0.0')).toBe(false);

      const versions = customRouter.getSupportedVersions();
      expect(versions).toEqual(['1.0.0', '2.0.0', '3.0.0']);
      expect(customRouter.getDefaultVersion()).toBe('3.0.0');
    });

    it('rejects a default version outside the supported set', () => {
      expect(() => new ApiRouter({ defaultVersion: '3.0.0', supportedVersions: ['2.0.0'] })).toThrow(
        'defaultVersion must be included'
      );
    });

    it('rejects an empty supported-version set', () => {
      expect(() => new ApiRouter({ supportedVersions: [] })).toThrow('at least one supported API version');
    });
  });
});
