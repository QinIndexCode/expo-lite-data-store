import fs from 'fs';
import path from 'path';

describe('built PerformanceMonitor artifacts', () => {
  const distJsPath = path.resolve(__dirname, '../../../dist/js/core/monitor/PerformanceMonitor.js');
  const distTypesPath = path.resolve(__dirname, '../../../dist/types/core/monitor/PerformanceMonitor.d.ts');
  const distCjsModulePath = path.resolve(__dirname, '../../../dist/cjs/core/monitor/PerformanceMonitor.js');

  it('keeps the runtime configuration API in the ESM bundle', () => {
    const distJs = fs.readFileSync(distJsPath, 'utf8');

    expect(distJs).toContain('configure(options)');
    expect(distJs).toContain('resetRuntimeOptions()');
  });

  it('exposes the runtime configuration API from the CJS bundle', () => {
    const { performanceMonitor } = require(distCjsModulePath) as {
      performanceMonitor: {
        configure?: unknown;
        resetRuntimeOptions?: unknown;
      };
    };

    expect(typeof performanceMonitor.configure).toBe('function');
    expect(typeof performanceMonitor.resetRuntimeOptions).toBe('function');
  });

  it('declares the runtime configuration API in type definitions', () => {
    const distTypes = fs.readFileSync(distTypesPath, 'utf8');

    expect(distTypes).toContain('configure(options: PerformanceMonitorOptions): void;');
    expect(distTypes).toContain('resetRuntimeOptions(): void;');
  });
});
