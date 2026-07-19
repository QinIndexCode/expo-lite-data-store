/// <reference path="../../../__tests__/test-globals.d.ts" />

import { getFileSystem } from '../../../utils/fileSystemCompat';
import { pathHelper } from '../../../utils/PathHelper';
import { PermissionChecker } from '../PermissionChecker';

describe('PermissionChecker', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    global.__expo_file_system_mock__.mockFileSystem = {};
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    pathHelper.reset();
    jest.restoreAllMocks();
  });

  it('shares concurrent probes but rechecks the root on a later lifecycle', async () => {
    pathHelper.setStorageFolder('permission-cache-success');
    const fileSystem = getFileSystem();
    const writeSpy = jest.spyOn(fileSystem, 'writeAsStringAsync');
    const first = new PermissionChecker();
    const second = new PermissionChecker();

    await Promise.all([first.checkPermissions(), second.checkPermissions()]);
    await second.checkPermissions();

    expect(writeSpy.mock.calls.filter(([path]) => path.endsWith('permission-check.tmp'))).toHaveLength(2);
  });

  it('does not cache a failed probe', async () => {
    pathHelper.setStorageFolder('permission-cache-retry');
    const fileSystem = getFileSystem();
    const writeAsStringAsync = fileSystem.writeAsStringAsync.bind(fileSystem);
    let permissionProbeAttempts = 0;
    const writeSpy = jest.spyOn(fileSystem, 'writeAsStringAsync').mockImplementation(async (path, content, options) => {
      if (path.endsWith('permission-check.tmp')) {
        permissionProbeAttempts++;
        if (permissionProbeAttempts === 1) {
          throw new Error('permission denied');
        }
      }
      await writeAsStringAsync(path, content, options);
    });
    const checker = new PermissionChecker();

    await expect(checker.checkPermissions()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(checker.checkPermissions()).resolves.toBeUndefined();

    expect(permissionProbeAttempts).toBe(2);
    writeSpy.mockRestore();
  });
});
