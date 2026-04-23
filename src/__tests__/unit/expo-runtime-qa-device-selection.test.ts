const {
  buildPhaseEventMatcher,
  buildVerdicts,
  buildNativeRunAndroidArgs,
  buildQaConsumerTempPrefix,
  isSinglePackageExpoGoDoctorPeerWarning,
  parseAdbDevicesOutput,
  resolveRequestedAdbSerial,
  resolveExpoAndroidDeviceTargetFromDevices,
} = require('../../../scripts/expo-runtime-qa.cjs');

describe('expo runtime QA Android device selection', () => {
  it('matches only events from the current lane identity', () => {
    const matcher = buildPhaseEventMatcher({
      channel: 'managed-compatible',
      mode: 'runtime',
      profile: 'expo-go-js',
      runId: 'managed-compatible-expo-go-js-runtime-123',
    });

    expect(
      matcher({
        channel: 'managed-compatible',
        mode: 'runtime',
        profile: 'expo-go-js',
        runId: 'managed-compatible-expo-go-js-runtime-123',
        type: 'summary',
      })
    ).toBe(true);
    expect(
      matcher({
        channel: 'managed-compatible',
        mode: 'recovery',
        profile: 'expo-go-js',
        runId: 'managed-compatible-expo-go-js-runtime-123',
        type: 'summary',
      })
    ).toBe(false);
    expect(
      matcher({
        channel: 'managed-compatible',
        mode: 'runtime',
        profile: 'expo-go-js',
        runId: 'stale-run',
        type: 'summary',
      })
    ).toBe(false);
  });

  it('parses the Expo CLI device name from adb devices output', () => {
    const devices = parseAdbDevicesOutput(`List of devices attached
127.0.0.1:7555 device product:HapburnP model:HBP_AL00 device:HapburnP transport_id:1
`);

    expect(devices).toEqual([
      {
        serial: '127.0.0.1:7555',
        state: 'device',
        model: 'HBP_AL00',
        product: 'HapburnP',
        device: 'HapburnP',
        transportId: '1',
      },
    ]);
  });

  it('uses the adb model field when resolving Expo run:android targets', () => {
    const target = resolveExpoAndroidDeviceTargetFromDevices('127.0.0.1:7555', [
      {
        serial: '127.0.0.1:7555',
        state: 'device',
        model: 'HBP_AL00',
        product: 'HapburnP',
        device: 'HapburnP',
        transportId: '1',
      },
    ]);

    expect(target).toEqual({
      deviceArg: 'HBP_AL00',
      resolution: 'model',
    });
  });

  it('falls back to implicit selection when the target is the only attached device', () => {
    const target = resolveExpoAndroidDeviceTargetFromDevices('127.0.0.1:7555', [
      {
        serial: '127.0.0.1:7555',
        state: 'device',
        model: null,
        product: 'HapburnP',
        device: 'HapburnP',
        transportId: '1',
      },
    ]);

    expect(target).toEqual({
      deviceArg: null,
      resolution: 'implicit-single-device',
    });
  });

  it('throws when multiple devices are attached and the target has no Expo device name', () => {
    expect(() =>
      resolveExpoAndroidDeviceTargetFromDevices('127.0.0.1:7555', [
        {
          serial: '127.0.0.1:7555',
          state: 'device',
          model: null,
          product: 'HapburnP',
          device: 'HapburnP',
          transportId: '1',
        },
        {
          serial: 'emulator-5554',
          state: 'device',
          model: 'Pixel_8',
          product: 'sdk_gphone64_x86_64',
          device: 'emu64xa',
          transportId: '2',
        },
      ])
    ).toThrow('Unable to resolve Expo device name');
  });

  it('builds expo run:android args without the invalid port and no-bundler combination', () => {
    expect(buildNativeRunAndroidArgs('HBP_AL00')).toEqual([
      'expo',
      'run:android',
      '--device',
      'HBP_AL00',
      '--no-bundler',
    ]);
  });

  it('uses a short Windows temp prefix for native QA consumers', () => {
    expect(
      buildQaConsumerTempPrefix({
        channel: 'managed-compatible',
        profile: 'native-quick-crypto',
        platform: 'win32',
        qaTempRoot: 'C:\\qtmp',
      })
    ).toBe('C:\\qtmp\\lds-mc-nqc-');
  });

  it('falls back to the only attached adb serial when MuMu remaps the requested network endpoint', () => {
    expect(resolveRequestedAdbSerial('127.0.0.1:7555', ['emulator-5554'])).toBe('emulator-5554');
  });

  it('treats single-package Expo Go peer warnings from expo-doctor as non-blocking', () => {
    expect(
      isSinglePackageExpoGoDoctorPeerWarning({
        channel: 'single-package',
        profile: 'expo-go-js',
        caseId: 'contract_expo_doctor',
        combinedOutput: `Missing peer dependency: expo-constants
Missing peer dependency: expo-crypto
Missing peer dependency: expo-file-system
Missing peer dependency: expo-secure-store`,
      })
    ).toBe(true);
    expect(
      isSinglePackageExpoGoDoctorPeerWarning({
        channel: 'managed-compatible',
        profile: 'expo-go-js',
        caseId: 'contract_expo_doctor',
        combinedOutput: 'Missing peer dependency: expo-constants',
      })
    ).toBe(false);
  });

  it('treats a native probe failure as non-blocking when runtime and recovery validate the native client', () => {
    const verdicts = buildVerdicts(
      [
        {
          channel: 'managed-compatible',
          profile: 'native-quick-crypto',
          records: [
            {
              caseId: 'native_client_probe',
              status: 'fail',
              error: {
                message: 'Failed to build the native flagship dev client',
              },
            },
            {
              caseId: 'native_client_runtime',
              status: 'pass',
              metrics: {
                provider: 'react-native-quick-crypto',
              },
              fatalError: null,
            },
            {
              caseId: 'native_client_recovery',
              status: 'pass',
              metrics: {
                provider: 'react-native-quick-crypto',
              },
              fatalError: null,
            },
          ],
        },
      ],
      {
        profiles: ['native-quick-crypto'],
        layers: ['contract', 'runtime'],
      }
    );

    expect(verdicts.nativeFlagshipVerdict.status).toBe('pass');
    expect(verdicts.nativeFlagshipVerdict.evidence).toContain(
      'native_client_probe failed, but runtime/recovery validated the installed dev client'
    );
  });

  it('keeps unrequested native lanes out of the top-level verdicts for Expo Go-only runs', () => {
    const verdicts = buildVerdicts(
      [
        {
          channel: 'single-package',
          profile: 'expo-go-js',
          records: [
            {
              caseId: 'expo_go_probe',
              status: 'pass',
              stage: 'probe',
            },
            {
              caseId: 'expo_go_runtime',
              status: 'pass',
              stage: 'runtime',
            },
          ],
        },
        {
          channel: 'managed-compatible',
          profile: 'expo-go-js',
          records: [
            {
              caseId: 'expo_go_probe',
              status: 'pass',
              stage: 'probe',
            },
            {
              caseId: 'expo_go_runtime',
              status: 'pass',
              stage: 'runtime',
              metrics: {
                summary: {
                  performanceSummary: {
                    sampleCount: 43,
                    p95Ms: 3378,
                    throughputOpsPerSec: 266.67,
                  },
                },
              },
            },
            {
              caseId: 'expo_go_recovery',
              status: 'pass',
              stage: 'recovery',
            },
          ],
        },
      ],
      {
        channels: ['single-package', 'managed-compatible'],
        profiles: ['expo-go-js'],
        layers: ['contract', 'runtime'],
      }
    );

    expect(verdicts.zeroConfigVerdict.status).toBe('pass');
    expect(verdicts.expoGoRuntimeVerdict.status).toBe('pass');
    expect(verdicts.nativeFlagshipVerdict.status).toBe('not-requested');
    expect(verdicts.performanceAndStabilityVerdict.status).toBe('pass');
  });
});
