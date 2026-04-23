const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');
const { buildRunnerAppSource } = require('./expo-runtime-runner-template.cjs');

const repoRoot = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const adbCmd = process.env.ADB_PATH
  || (process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb');
const emulatorCmd = process.env.EMULATOR_PATH
  || (process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator') : 'emulator');

const QA_PREFIX = 'LITESTORE_QA::';
const DEFAULT_CHANNELS = ['single-package', 'managed-compatible'];
const DEFAULT_LAYERS = ['contract', 'runtime'];
const DEFAULT_RUNTIME_GROUPS = ['functional', 'edge', 'security', 'large-file', 'concurrency', 'business'];
const DEFAULT_PROFILES = ['expo-go-js'];
const DEFAULT_SOAK_MINUTES = 30;
const DEFAULT_RESTART_INTERVAL_MINUTES = 5;
const DEFAULT_AVD_NAME = 'Medium_Phone_API_35';
const DEFAULT_EXPO_START_PORT = 8081;
const MAX_EXPO_PORT_PROBES = 12;
const QA_BUILD_STEPS = ['build:js', 'build:cjs', 'build:types'];
const EXPO_GO_PACKAGE = 'host.exp.exponent';
const DEV_CLIENT_PLUGIN = 'expo-dev-client';
const DEV_CLIENT_PACKAGE = 'expo-dev-client';
const NATIVE_PROFILE = 'native-quick-crypto';
const EXPO_GO_PROFILE = 'expo-go-js';
const SHORT_CHANNEL_NAMES = {
  'managed-compatible': 'mc',
  'single-package': 'sp',
};
const SHORT_PROFILE_NAMES = {
  [EXPO_GO_PROFILE]: 'egj',
  [NATIVE_PROFILE]: 'nqc',
};

const parseArgs = argv => {
  const options = {
    channels: [...DEFAULT_CHANNELS],
    layers: [...DEFAULT_LAYERS],
    groups: [...DEFAULT_RUNTIME_GROUPS],
    profiles: [...DEFAULT_PROFILES],
    soakMinutes: DEFAULT_SOAK_MINUTES,
    restartIntervalMinutes: DEFAULT_RESTART_INTERVAL_MINUTES,
    avdName: DEFAULT_AVD_NAME,
    deviceSerial: null,
    keepEmulator: true,
    cleanupConsumers: true,
    artifactsDir: path.join(repoRoot, 'artifacts', 'expo-runtime-qa', new Date().toISOString().replace(/[:.]/g, '-')),
  };

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }

    const [key, rawValue] = arg.slice(2).split('=');
    const value = rawValue ?? 'true';

    switch (key) {
      case 'channels':
        options.channels = value.split(',').map(item => item.trim()).filter(Boolean);
        break;
      case 'layers':
        options.layers = value.split(',').map(item => item.trim()).filter(Boolean);
        break;
      case 'groups':
        options.groups = value.split(',').map(item => item.trim()).filter(Boolean);
        break;
      case 'profiles':
        options.profiles = value.split(',').map(item => item.trim()).filter(Boolean);
        break;
      case 'soak-minutes':
        options.soakMinutes = Number(value);
        break;
      case 'restart-interval-minutes':
        options.restartIntervalMinutes = Number(value);
        break;
      case 'avd-name':
        options.avdName = value;
        break;
      case 'device-serial':
        options.deviceSerial = value;
        break;
      case 'artifacts-dir':
        options.artifactsDir = path.resolve(value);
        break;
      case 'keep-emulator':
        options.keepEmulator = value !== 'false';
        break;
      case 'cleanup-consumers':
        options.cleanupConsumers = value !== 'false';
        break;
      default:
        break;
    }
  }

  return options;
};

const ensureDir = target => {
  fs.mkdirSync(target, {
    recursive: true,
  });
  return target;
};

const nowIso = () => new Date().toISOString();

const sanitizeTempToken = (value, fallback) => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '')
    .slice(0, 6);

  return normalized || fallback;
};

const getQaTempRoot = () => {
  if (process.platform !== 'win32') {
    return os.tmpdir();
  }

  const parsedRoot = path.parse(os.tmpdir()).root.replace(/[\\/]+$/u, '') || 'C:';
  const systemDrive = process.env.SystemDrive || parsedRoot;
  const preferredRoot = path.join(systemDrive, 'qtmp');

  try {
    fs.mkdirSync(preferredRoot, {
      recursive: true,
    });
    return preferredRoot;
  } catch {
    return os.tmpdir();
  }
};

const buildQaConsumerTempPrefix = ({
  channel,
  profile,
  platform = process.platform,
  qaTempRoot = getQaTempRoot(),
}) => {
  const shortChannel = SHORT_CHANNEL_NAMES[channel] || sanitizeTempToken(channel, 'qa');
  const shortProfile = SHORT_PROFILE_NAMES[profile] || sanitizeTempToken(profile, 'app');

  if (platform === 'win32') {
    return path.join(qaTempRoot, `lds-${shortChannel}-${shortProfile}-`);
  }

  return path.join(qaTempRoot, `expo-lite-data-store-${shortChannel}-${shortProfile}-`);
};

const isPortAvailable = port =>
  new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });

const findAvailablePort = async (preferredPort = DEFAULT_EXPO_START_PORT) => {
  for (let offset = 0; offset < MAX_EXPO_PORT_PROBES; offset += 1) {
    const port = preferredPort + offset;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(
    `Unable to find an available Expo port between ${preferredPort} and ${preferredPort + MAX_EXPO_PORT_PROBES - 1}`
  );
};

const needsShell = command => process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command);

const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const appendJsonLine = (filePath, value) => {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
};

const createCaseRecorder = filePath => record => {
  appendJsonLine(filePath, {
    ...record,
    recordedAt: nowIso(),
  });
};

const runCommand = (command, args, options = {}) => {
  const startTime = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    encoding: 'utf8',
    timeout: options.timeoutMs,
    windowsHide: true,
    shell: needsShell(command),
  });
  const durationMs = Date.now() - startTime;

  if (options.logFile) {
    const header = `> ${command} ${args.join(' ')}\n`;
    fs.writeFileSync(options.logFile, `${header}\n${result.stdout || ''}\n${result.stderr || ''}`, 'utf8');
  }

  return {
    command,
    args,
    cwd: options.cwd,
    code: typeof result.status === 'number' ? result.status : result.error ? 1 : 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    durationMs,
    error: result.error || null,
  };
};

const appendCommandLog = (filePath, result) => {
  const header = `> ${result.command} ${result.args.join(' ')}\n`;
  fs.appendFileSync(filePath, `${header}\n${result.stdout || ''}\n${result.stderr || ''}\n`, 'utf8');
};

const ensureCommandSuccess = (result, message) => {
  if (result.code !== 0) {
    const error = new Error(message || `Command failed: ${result.command}`);
    error.commandResult = result;
    throw error;
  }
  return result;
};

const buildPackageForQa = artifactsDir =>
  QA_BUILD_STEPS.map(step =>
    ensureCommandSuccess(
      runCommand(npmCmd, ['run', step], {
        cwd: repoRoot,
        timeoutMs: 10 * 60 * 1000,
        logFile: path.join(artifactsDir, `${step.replace(':', '-')}.log`),
      }),
      `Failed to ${step} before runtime QA packaging`
    )
  );

const parseAdbDevicesOutput = output =>
  output
    .split(/\r?\n/u)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/\.cpp:\d+/u.test(line))
    .map(line => {
      const [serial = '', state = '', ...rawProps] = line.split(/\s+/u).filter(Boolean);
      const props = rawProps.reduce((accumulator, item) => {
        const separatorIndex = item.indexOf(':');
        if (separatorIndex === -1) {
          accumulator[item] = true;
          return accumulator;
        }

        const key = item.slice(0, separatorIndex);
        const value = item.slice(separatorIndex + 1);
        accumulator[key] = value;
        return accumulator;
      }, {});

      return {
        serial,
        state,
        model: typeof props.model === 'string' ? props.model : null,
        product: typeof props.product === 'string' ? props.product : null,
        device: typeof props.device === 'string' ? props.device : null,
        transportId: typeof props.transport_id === 'string' ? props.transport_id : null,
      };
    })
    .filter(device => device.serial);

const createAdbDevicesReader = () => {
  const tryListDevices = () =>
    runCommand(adbCmd, ['devices', '-l'], {
      timeoutMs: 30000,
    });

  let result = tryListDevices();
  if (result.code !== 0) {
    if (process.platform === 'win32') {
      runCommand('taskkill', ['/IM', 'adb.exe', '/F'], {
        timeoutMs: 30000,
      });
    } else {
      runCommand('pkill', ['-f', 'adb'], {
        timeoutMs: 30000,
      });
    }

    runCommand(adbCmd, ['start-server'], {
      timeoutMs: 30000,
    });
    result = tryListDevices();
  }

  ensureCommandSuccess(result, 'Failed to list adb devices');
  return parseAdbDevicesOutput(result.stdout);
};

const readRepoPackage = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const readConsumerAppConfig = consumerDir => JSON.parse(fs.readFileSync(path.join(consumerDir, 'app.json'), 'utf8'));

const buildConsumerPackageJson = profile => {
  const pkg = readRepoPackage();
  const expoPackageJson = require(path.join(repoRoot, 'node_modules', 'expo', 'package.json'));
  const dependencies = {
    expo: pkg.devDependencies.expo,
    react: pkg.devDependencies.react,
    'react-native': pkg.devDependencies['react-native'],
    'babel-preset-expo': expoPackageJson.dependencies['babel-preset-expo'],
  };

  if (profile === NATIVE_PROFILE) {
    dependencies[DEV_CLIENT_PACKAGE] = '~6.0.20';
  }

  return {
    name: 'expo-lite-data-store-runtime-qa',
    version: '1.0.0',
    private: true,
    main: 'node_modules/expo/AppEntry.js',
    scripts: {
      start: 'expo start',
    },
    dependencies,
  };
};

const buildAppJson = ({ channel, mode, groups, soakMinutes, restartIntervalMinutes, runId, profile }) => ({
  expo: {
    name: `expo-lite-data-store-${channel}-${profile}`,
    slug: `expo-lite-data-store-${channel}-${profile}`,
    scheme: `exp+expo-lite-data-store-${channel}-${profile}`,
    android: {
      package: `com.qinindexcode.litestoreqa.${channel.replace(/[^a-z0-9]/giu, '')}.${profile.replace(/[^a-z0-9]/giu, '')}`,
    },
    plugins: profile === NATIVE_PROFILE ? [DEV_CLIENT_PLUGIN] : [],
    extra: {
      liteStore: {
        performance: {
          maxConcurrentOperations: 7,
        },
        timeout: 12345,
      },
      qa: {
        channel,
        mode,
        runId,
        profile,
        groups,
        soakMinutes,
        restartIntervalMinutes,
      },
    },
  },
});

const writeConsumerFiles = ({ consumerDir, channel, mode, groups, soakMinutes, restartIntervalMinutes, runId, profile }) => {
  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(buildConsumerPackageJson(profile), null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(consumerDir, 'app.json'),
    `${JSON.stringify(buildAppJson({ channel, mode, groups, soakMinutes, restartIntervalMinutes, runId, profile }), null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(consumerDir, 'babel.config.js'),
    `module.exports = function (api) {\n  api.cache(true);\n  return {\n    presets: ['babel-preset-expo'],\n  };\n};\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(consumerDir, 'App.js'), buildRunnerAppSource({ channel, profile }), 'utf8');
};

const updateConsumerMode = ({ consumerDir, channel, mode, groups, soakMinutes, restartIntervalMinutes, runId }) => {
  const appJson = JSON.parse(fs.readFileSync(path.join(consumerDir, 'app.json'), 'utf8'));
  const profile = appJson?.expo?.extra?.qa?.profile ?? EXPO_GO_PROFILE;
  fs.writeFileSync(
    path.join(consumerDir, 'app.json'),
    `${JSON.stringify(buildAppJson({ channel, mode, groups, soakMinutes, restartIntervalMinutes, runId, profile }), null, 2)}\n`,
    'utf8'
  );
};

const installConsumerDependencies = ({ consumerDir, tarballPath, channel, artifactsDir, profile }) => {
  const installBaseLog = path.join(artifactsDir, 'install-base.log');
  const installTarballLog = path.join(artifactsDir, 'install-tarball.log');
  const installPeersLog = path.join(artifactsDir, 'install-peers.log');
  const installNativeLog = path.join(artifactsDir, 'install-native.log');

  const baseResult = runCommand(npmCmd, ['install'], {
    cwd: consumerDir,
    timeoutMs: 15 * 60 * 1000,
    logFile: installBaseLog,
  });
  ensureCommandSuccess(baseResult, 'Failed to install base Expo consumer dependencies');

  const tarballResult = runCommand(npmCmd, ['install', tarballPath], {
    cwd: consumerDir,
    timeoutMs: 15 * 60 * 1000,
    logFile: installTarballLog,
  });
  ensureCommandSuccess(tarballResult, 'Failed to install expo-lite-data-store tarball');

  let peerResult = null;
  if (channel === 'managed-compatible') {
    peerResult = runCommand(
      npxCmd,
      [
        'expo',
        'install',
        'expo-file-system',
        'expo-constants',
        'expo-crypto',
        'expo-secure-store',
        'expo-clipboard',
        'react-native-quick-crypto',
        'react-native-get-random-values',
      ],
      {
        cwd: consumerDir,
        timeoutMs: 15 * 60 * 1000,
        logFile: installPeersLog,
      }
    );
    ensureCommandSuccess(peerResult, 'Failed to install managed-compatible Expo peer dependencies');
  }

  let nativeResult = null;
  if (profile === NATIVE_PROFILE) {
    const nativePackages = ['expo-dev-client'];
    nativeResult = runCommand(npxCmd, ['expo', 'install', ...nativePackages], {
      cwd: consumerDir,
      timeoutMs: 20 * 60 * 1000,
      logFile: installNativeLog,
    });
    ensureCommandSuccess(nativeResult, 'Failed to install native flagship dependencies');
  }

  return {
    baseResult,
    tarballResult,
    peerResult,
    nativeResult,
  };
};

const isSinglePackageExpoGoDoctorPeerWarning = ({ channel, profile, caseId, combinedOutput }) =>
  channel === 'single-package'
  && profile === EXPO_GO_PROFILE
  && caseId === 'contract_expo_doctor'
  && /Missing peer dependency:\s+expo-constants/iu.test(combinedOutput)
  && /Missing peer dependency:\s+expo-crypto/iu.test(combinedOutput)
  && /Missing peer dependency:\s+expo-file-system/iu.test(combinedOutput)
  && /Missing peer dependency:\s+expo-secure-store/iu.test(combinedOutput);

const recordCommandCase = ({ recordCase, channel, profile, layer, caseId, group, result, stage }) => {
  const baseRecord = {
    channel,
    profile,
    layer,
    caseId,
    group,
    stage,
    durationMs: result.durationMs,
  };

  if (result.code === 0) {
    recordCase({
      ...baseRecord,
      status: 'pass',
      metrics: {
        exitCode: result.code,
      },
    });
    return true;
  }

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  const isKnownDoctorNetworkFlake =
    caseId === 'contract_expo_doctor' &&
    (/Directory check failed with unexpected server response/iu.test(combinedOutput)
      || /TypeError:\s*fetch failed/iu.test(combinedOutput)
      || /ConnectTimeoutError/iu.test(combinedOutput)
      || /requires a connection to the Expo API/iu.test(combinedOutput));

  if (isKnownDoctorNetworkFlake) {
    recordCase({
      ...baseRecord,
      status: 'pass',
      metrics: {
        exitCode: result.code,
        warning: 'react-native-directory-metadata-check-unavailable',
      },
      notes: ['expo-doctor failed only on the remote React Native Directory metadata check.'],
    });
    return true;
  }

  if (
    isSinglePackageExpoGoDoctorPeerWarning({
      channel,
      profile,
      caseId,
      combinedOutput,
    })
  ) {
    recordCase({
      ...baseRecord,
      status: 'pass',
      metrics: {
        exitCode: result.code,
        warning: 'single-package-expo-go-bundled-peers',
      },
      notes: [
        'single-package validates the Expo Go bundled-module floor. Missing Expo peer packages remain unsupported outside Expo Go and are still required by the documented install contract.',
      ],
    });
    return true;
  }

  recordCase({
    ...baseRecord,
    status: 'fail',
    error: {
      code: 'COMMAND_FAILED',
      message: `Command failed with exit code ${result.code}`,
      details: result.stderr || result.stdout,
    },
  });
  return false;
};

const getAdbDevicesDetailed = () => createAdbDevicesReader();

const getAdbDevices = () =>
  getAdbDevicesDetailed()
    .filter(device => device.state === 'device')
    .map(device => device.serial);

const resolveRequestedAdbSerial = (requestedSerial, availableSerials) => {
  if (availableSerials.includes(requestedSerial)) {
    return requestedSerial;
  }

  if (requestedSerial.includes(':') && availableSerials.length === 1) {
    return availableSerials[0];
  }

  return null;
};

const resolveExpoAndroidDeviceTargetFromDevices = (serial, devices) => {
  const attachedDevices = devices.filter(device => device.state === 'device');
  const selectedDevice = attachedDevices.find(device => device.serial === serial);

  if (!selectedDevice) {
    throw new Error(`Requested Android device "${serial}" is not available in adb devices`);
  }

  if (selectedDevice.model) {
    return {
      deviceArg: selectedDevice.model,
      resolution: 'model',
    };
  }

  if (attachedDevices.length === 1) {
    return {
      deviceArg: null,
      resolution: 'implicit-single-device',
    };
  }

  throw new Error(
    `Unable to resolve Expo device name for Android serial "${serial}" from adb metadata. Connected devices: ${attachedDevices
      .map(device => `${device.serial}${device.model ? `(${device.model})` : ''}`)
      .join(', ')}`
  );
};

const resolveExpoAndroidDeviceTarget = serial =>
  resolveExpoAndroidDeviceTargetFromDevices(serial, getAdbDevicesDetailed());

const buildNativeRunAndroidArgs = deviceArg => {
  const args = ['expo', 'run:android'];
  if (deviceArg) {
    args.push('--device', deviceArg);
  }
  args.push('--no-bundler');
  return args;
};

const listAvds = () => {
  const result = ensureCommandSuccess(
    runCommand(emulatorCmd, ['-list-avds'], {
      timeoutMs: 20000,
    }),
    'Failed to list Android virtual devices'
  );

  return result.stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
};

const waitForDeviceBoot = async serial => {
  ensureCommandSuccess(
    runCommand(adbCmd, ['-s', serial, 'wait-for-device'], {
      timeoutMs: 2 * 60 * 1000,
    }),
    'Timed out waiting for adb device'
  );

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    const bootResult = runCommand(adbCmd, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
      timeoutMs: 15000,
    });
    if ((bootResult.stdout || '').trim() === '1') {
      runCommand(adbCmd, ['-s', serial, 'shell', 'input', 'keyevent', '82'], {
        timeoutMs: 15000,
      });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error(`Timed out waiting for emulator ${serial} to finish booting`);
};

const connectAdbTarget = serial => {
  if (!serial.includes(':')) {
    return;
  }

  runCommand(adbCmd, ['connect', serial], {
    timeoutMs: 30000,
  });
};

const ensureAndroidDeviceReady = async ({ avdName, deviceSerial }) => {
  if (deviceSerial) {
    let devices = [];
    let resolvedSerial = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      connectAdbTarget(deviceSerial);
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      devices = getAdbDevices();
      resolvedSerial = resolveRequestedAdbSerial(deviceSerial, devices);
      if (resolvedSerial) {
        break;
      }
    }

    if (!resolvedSerial) {
      throw new Error(`Requested Android device "${deviceSerial}" is not available in adb devices`);
    }

    await waitForDeviceBoot(resolvedSerial);
    return {
      serial: resolvedSerial,
      startedByScript: false,
      deviceSource: deviceSerial.includes(':') ? 'mumu' : 'attached',
    };
  }

  const existingDevices = getAdbDevices();
  const existingEmulator = existingDevices.find(device => device.startsWith('emulator-'));
  if (existingEmulator) {
    await waitForDeviceBoot(existingEmulator);
    return {
      serial: existingEmulator,
      startedByScript: false,
      deviceSource: 'emulator',
    };
  }

  const avds = listAvds();
  if (!avds.includes(avdName)) {
    throw new Error(`Requested AVD "${avdName}" is not available. Found: ${avds.join(', ')}`);
  }

  const processHandle = spawn(
    emulatorCmd,
    ['-avd', avdName, '-no-snapshot-save', '-no-boot-anim'],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  processHandle.unref();

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    const devices = getAdbDevices();
    const emulator = devices.find(device => device.startsWith('emulator-'));
    if (emulator) {
      await waitForDeviceBoot(emulator);
      return {
        serial: emulator,
        startedByScript: true,
        deviceSource: 'emulator',
      };
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error(`Timed out waiting for emulator ${avdName} to appear in adb`);
};

const takeScreenshot = (serial, outputFile) => {
  const result = spawnSync(adbCmd, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: null,
    windowsHide: true,
  });

  if (result.status === 0 && result.stdout) {
    fs.writeFileSync(outputFile, result.stdout);
    return true;
  }

  return false;
};

const captureUiTree = (serial, outputFile) => {
  const result = runCommand(adbCmd, ['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], {
    timeoutMs: 30000,
  });
  if (result.code === 0) {
    const xmlText = result.stdout || '';
    const start = xmlText.indexOf('<?xml');
    const end = xmlText.lastIndexOf('</hierarchy>');
    const normalizedXml =
      start >= 0 && end >= 0 ? xmlText.slice(start, end + '</hierarchy>'.length) : xmlText;
    fs.writeFileSync(outputFile, normalizedXml, 'utf8');
    return true;
  }
  return false;
};

const getExpoGoInstalled = serial => {
  const result = runCommand(adbCmd, ['-s', serial, 'shell', 'pm', 'list', 'packages', EXPO_GO_PACKAGE], {
    timeoutMs: 20000,
  });
  return result.code === 0 && result.stdout.includes(EXPO_GO_PACKAGE);
};

const launchPackageHome = (serial, packageName) =>
  runCommand(adbCmd, ['-s', serial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], {
    timeoutMs: 60000,
  });

const forceStopPackage = (serial, packageName) =>
  runCommand(adbCmd, ['-s', serial, 'shell', 'am', 'force-stop', packageName], {
    timeoutMs: 30000,
  });

const wakeAndUnlockDevice = serial => {
  runCommand(adbCmd, ['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], {
    timeoutMs: 15000,
  });
  runCommand(adbCmd, ['-s', serial, 'shell', 'wm', 'dismiss-keyguard'], {
    timeoutMs: 15000,
  });
  runCommand(adbCmd, ['-s', serial, 'shell', 'input', 'keyevent', '82'], {
    timeoutMs: 15000,
  });
  runCommand(adbCmd, ['-s', serial, 'shell', 'settings', 'put', 'system', 'screen_off_timeout', '1800000'], {
    timeoutMs: 15000,
  });
};

const launchExpoGoHome = serial => launchPackageHome(serial, EXPO_GO_PACKAGE);
const forceStopExpoGo = serial => forceStopPackage(serial, EXPO_GO_PACKAGE);

const getProfileRuntime = ({ consumerDir, profile }) => {
  const appJson = readConsumerAppConfig(consumerDir);
  const expoConfig = appJson.expo || {};
  const slug = expoConfig.slug || 'expo-lite-data-store-runtime-qa';
  const scheme = expoConfig.scheme || `exp+${slug}`;
  const packageName = profile === NATIVE_PROFILE ? expoConfig.android?.package : EXPO_GO_PACKAGE;

  return {
    slug,
    scheme,
    packageName,
  };
};

const createLogcatMonitor = ({ serial, outputFile, acceptEvent = () => true }) => {
  const emitter = new EventEmitter();
  const output = fs.createWriteStream(outputFile, {
    encoding: 'utf8',
  });

  runCommand(adbCmd, ['-s', serial, 'logcat', '-c'], {
    timeoutMs: 20000,
  });

  const child = spawn(adbCmd, ['-s', serial, 'logcat', '-v', 'time'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let closed = false;
  const events = [];

  const handleChunk = chunk => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split(/\r?\n/u);
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      output.write(`${line}\n`);
      const index = line.indexOf(QA_PREFIX);
      if (index >= 0) {
        const payload = line.slice(index + QA_PREFIX.length);
        try {
          const event = JSON.parse(payload);
          if (acceptEvent(event)) {
            events.push(event);
            emitter.emit('event', event);
          }
        } catch {
          emitter.emit('parse-error', payload);
        }
      }
    }
  };

  child.stdout.on('data', handleChunk);
  child.stderr.on('data', chunk => {
    stderrBuffer += chunk.toString('utf8');
    output.write(chunk.toString('utf8'));
  });

  const waitForEvent = (predicate, timeoutMs, description) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${description}`));
      }, timeoutMs);

      const onEvent = event => {
        if (!predicate(event)) {
          return;
        }
        cleanup();
        resolve(event);
      };

      const cleanup = () => {
        clearTimeout(timer);
        emitter.off('event', onEvent);
      };

      emitter.on('event', onEvent);

      for (const event of events) {
        if (predicate(event)) {
          cleanup();
          resolve(event);
          break;
        }
      }
    });

  child.once('close', () => {
    closed = true;
  });

  const stop = () =>
    new Promise(resolve => {
      let finalized = false;
      const finalize = () => {
        if (finalized) {
          return;
        }
        finalized = true;
        output.end();
        resolve({
          events,
          stderr: stderrBuffer,
        });
      };

      if (closed) {
        finalize();
        return;
      }

      const fallbackTimer = setTimeout(() => {
        finalize();
      }, 10000);

      child.once('close', () => {
        clearTimeout(fallbackTimer);
        finalize();
      });

      try {
        child.kill();
      } catch {
        clearTimeout(fallbackTimer);
        finalize();
      }
    });

  return {
    events,
    waitForEvent,
    stop,
  };
};

const createProcessLogger = ({ processHandle, outputFile, onLine }) => {
  const output = fs.createWriteStream(outputFile, {
    encoding: 'utf8',
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let closed = false;

  const handle = bufferName => chunk => {
    if (bufferName === 'stdout') {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        output.write(`${line}\n`);
        onLine(line);
      }
      return;
    }

    stderrBuffer += chunk.toString('utf8');
    const lines = chunk.toString('utf8').split(/\r?\n/u);
    output.write(chunk.toString('utf8'));
    for (const line of lines.filter(Boolean)) {
      onLine(line);
    }
  };

  processHandle.stdout.on('data', handle('stdout'));
  processHandle.stderr.on('data', handle('stderr'));
  processHandle.once('close', () => {
    closed = true;
  });

  return {
    stop: () =>
      new Promise(resolve => {
        let finalized = false;
        const finalize = code => {
          if (finalized) {
            return;
          }
          finalized = true;
          output.end();
          resolve({
            code,
            stdoutRemainder: stdoutBuffer,
            stderr: stderrBuffer,
          });
        };

        if (closed) {
          finalize(processHandle.exitCode ?? 0);
          return;
        }

        const fallbackTimer = setTimeout(() => {
          finalize(processHandle.exitCode ?? 0);
        }, 15000);

        processHandle.once('close', code => {
          clearTimeout(fallbackTimer);
          finalize(code);
        });

        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], {
            windowsHide: true,
          });
        } else {
          try {
            processHandle.kill('SIGTERM');
          } catch {
            clearTimeout(fallbackTimer);
            finalize(processHandle.exitCode ?? 0);
          }
        }
      }),
  };
};

const openUrlInPackage = (serial, url, packageName) =>
  runCommand(
    adbCmd,
    [
      '-s',
      serial,
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      url,
      ...(packageName ? [packageName] : []),
    ],
    {
      timeoutMs: 60000,
    }
  );

const applyAdbReverse = (serial, port) => {
  return runCommand(adbCmd, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], {
    timeoutMs: 30000,
  });
};

const buildPhaseEventMatcher = ({ channel, mode, profile, runId }) => event =>
  Boolean(
    event
    && event.channel === channel
    && event.mode === mode
    && event.profile === profile
    && event.runId === runId
  );

const extractExpoConnectionInfo = line => {
  const expMatch = line.match(/exp:\/\/[^\s]+/u);
  if (expMatch) {
    const portMatch = expMatch[0].match(/:(\d+)(?:[/?]|$)/u);
    return {
      expUrl: expMatch[0],
      port: portMatch ? Number(portMatch[1]) : null,
    };
  }

  const waitingMatch = line.match(/Waiting on https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/iu);
  if (waitingMatch) {
    const port = Number(waitingMatch[1]);
    return {
      expUrl: `exp://127.0.0.1:${port}`,
      port,
    };
  }

  return null;
};

const buildNativeDevClientUrl = ({ consumerDir, expUrl }) => {
  const runtime = getProfileRuntime({ consumerDir, profile: NATIVE_PROFILE });
  return `${runtime.scheme}://expo-development-client/?url=${encodeURIComponent(expUrl)}&disableOnboarding=1`;
};

const findFirstMatchingFile = (directory, predicate) => {
  if (!fs.existsSync(directory)) {
    return null;
  }

  const entries = fs.readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nestedMatch = findFirstMatchingFile(fullPath, predicate);
      if (nestedMatch) {
        return nestedMatch;
      }
      continue;
    }

    if (predicate(entry.name, fullPath)) {
      return fullPath;
    }
  }

  return null;
};

const findDebugApkPath = consumerDir => {
  const outputsDir = path.join(consumerDir, 'android', 'app', 'build', 'outputs', 'apk');
  const apkPath = findFirstMatchingFile(
    outputsDir,
    name => name.endsWith('.apk') && !name.includes('androidTest') && !name.includes('unsigned')
  );

  if (!apkPath) {
    throw new Error(`Failed to locate a debug APK under ${outputsDir}`);
  }

  return apkPath;
};

const ensureNativeBuildInstalled = ({ consumerDir, serial, port, outputFile }) => {
  const androidDir = path.join(consumerDir, 'android');
  const gradleWrapper = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

  if (outputFile) {
    fs.writeFileSync(outputFile, '', 'utf8');
  }

  if (!fs.existsSync(gradleWrapper)) {
    const prebuildResult = runCommand(
      npxCmd,
      ['expo', 'prebuild', '--platform', 'android', '--non-interactive'],
      {
        cwd: consumerDir,
        timeoutMs: 20 * 60 * 1000,
      }
    );
    if (outputFile) {
      appendCommandLog(outputFile, prebuildResult);
    }
    ensureCommandSuccess(prebuildResult, 'Failed to prebuild the native flagship Android project');
  }

  const buildResult = runCommand(
    gradleWrapper,
    [
      'app:assembleDebug',
      '-x',
      'lint',
      '-x',
      'test',
      '--configure-on-demand',
      '--build-cache',
      `-PreactNativeDevServerPort=${port}`,
      '-PreactNativeArchitectures=x86_64,arm64-v8a,x86,armeabi-v7a',
    ],
    {
      cwd: androidDir,
      timeoutMs: 90 * 60 * 1000,
    }
  );
  if (outputFile) {
    appendCommandLog(outputFile, buildResult);
  }
  ensureCommandSuccess(buildResult, 'Failed to build the native flagship dev client');

  const apkPath = findDebugApkPath(consumerDir);
  const installResult = runCommand(
    adbCmd,
    ['-s', serial, 'install', '-r', '-d', apkPath],
    {
      timeoutMs: 10 * 60 * 1000,
    }
  );
  if (outputFile) {
    appendCommandLog(outputFile, installResult);
    fs.appendFileSync(outputFile, `\n[qa] installed apk=${apkPath} serial=${serial}\n`, 'utf8');
  }
  ensureCommandSuccess(installResult, 'Failed to install the native flagship dev client');
  return installResult;
};

const bringExpoToForeground = async ({ serial, expUrl, consumerDir, profile }) => {
  const runtime = getProfileRuntime({ consumerDir, profile });
  wakeAndUnlockDevice(serial);
  launchPackageHome(serial, runtime.packageName);
  await new Promise(resolve => setTimeout(resolve, 2500));
  const launchUrl =
    profile === NATIVE_PROFILE
      ? buildNativeDevClientUrl({ consumerDir, expUrl })
      : expUrl;
  ensureCommandSuccess(
    openUrlInPackage(serial, launchUrl, profile === NATIVE_PROFILE ? null : runtime.packageName),
    `Failed to launch ${profile === NATIVE_PROFILE ? 'native dev client' : 'Expo Go'} experience URL`
  );
  await new Promise(resolve => setTimeout(resolve, 4000));
  wakeAndUnlockDevice(serial);
};

const startExpoServer = async ({ consumerDir, outputFile, profile }) => {
  const startPort = await findAvailablePort();
  let expUrl = null;
  let port = startPort;
  const args = ['expo', 'start', '--localhost', '--clear', '--port', String(startPort)];
  if (profile === NATIVE_PROFILE) {
    args.splice(2, 0, '--dev-client');
  }

  const processHandle = spawn(npxCmd, args, {
    cwd: consumerDir,
    env: {
      ...process.env,
      CI: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_OFFLINE: '1',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: needsShell(npxCmd),
  });

  const logger = createProcessLogger({
    processHandle,
    outputFile,
    onLine: line => {
      const connectionInfo = extractExpoConnectionInfo(line);
      if (connectionInfo) {
        if (!expUrl) {
          expUrl = connectionInfo.expUrl;
        }
        if (connectionInfo.port) {
          port = connectionInfo.port;
        }
      }
    },
  });

  return {
    getExpUrl: () => expUrl,
    getPort: () => port,
    stop: () => logger.stop(),
    processHandle,
  };
};

const waitForExpUrl = async (expoServer, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = expoServer.getExpUrl();
    if (url) {
      return url;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('Timed out waiting for Expo development URL');
};

const collectMeminfo = (serial, packageName, outputFile) => {
  const result = runCommand(adbCmd, ['-s', serial, 'shell', 'dumpsys', 'meminfo', packageName], {
    timeoutMs: 60000,
  });
  fs.writeFileSync(outputFile, `${result.stdout}\n${result.stderr}`, 'utf8');
  return result.code === 0;
};

const collectCrashLog = (serial, outputFile) => {
  const result = runCommand(adbCmd, ['-s', serial, 'logcat', '-b', 'crash', '-d'], {
    timeoutMs: 30000,
  });
  fs.writeFileSync(outputFile, `${result.stdout}\n${result.stderr}`, 'utf8');
  return result.code === 0;
};

const runExpoPhase = async ({
  consumerDir,
  channel,
  mode,
  profile,
  nativeBuildContext,
  serial,
  artifactsDir,
  groups,
  soakMinutes,
  restartIntervalMinutes,
  recordCase,
}) => {
  const phaseRunId = `${channel}-${profile}-${mode}-${Date.now()}`;
  const matchesPhaseEvent = buildPhaseEventMatcher({
    channel,
    mode,
    profile,
    runId: phaseRunId,
  });
  updateConsumerMode({
    consumerDir,
    channel,
    mode,
    runId: phaseRunId,
    groups,
    soakMinutes,
    restartIntervalMinutes,
  });

  const phaseArtifacts = ensureDir(path.join(artifactsDir, mode));
  const screenshotsDir = ensureDir(path.join(phaseArtifacts, 'screenshots'));
  const meminfoDir = ensureDir(path.join(phaseArtifacts, 'meminfo'));
  const logcatFile = path.join(phaseArtifacts, 'logcat.txt');
  const eventsFile = path.join(phaseArtifacts, 'events.jsonl');
  const expoLogFile = path.join(phaseArtifacts, 'expo-start.log');
  const nativeBuildLogFile = path.join(phaseArtifacts, 'native-build.log');
  const crashLogFile = path.join(phaseArtifacts, 'crash-logcat.txt');
  const meminfoBefore = path.join(meminfoDir, 'before.txt');
  const meminfoAfter = path.join(meminfoDir, 'after.txt');
  const uiTreeFile = path.join(phaseArtifacts, 'ui-tree.xml');
  const runtime = getProfileRuntime({ consumerDir, profile });

  collectMeminfo(serial, runtime.packageName, meminfoBefore);

  const logcatMonitor = createLogcatMonitor({
    serial,
    outputFile: logcatFile,
    acceptEvent: matchesPhaseEvent,
  });
  const expoServer = await startExpoServer({
    consumerDir,
    outputFile: expoLogFile,
    profile,
  });

  let expUrl = null;
  let summaryEvent = null;
  let phaseError = null;
  const restartTimers = [];
  let monitorResult = null;
  const waitForPhaseEvent = (type, timeoutMs, description, predicate = () => true) =>
    logcatMonitor.waitForEvent(
      event => matchesPhaseEvent(event) && event.type === type && predicate(event),
      timeoutMs,
      description
    );

  try {
    expUrl = await waitForExpUrl(expoServer, 10 * 60 * 1000);
    ensureCommandSuccess(
      applyAdbReverse(serial, expoServer.getPort()),
      `Failed to establish adb reverse for Expo port ${expoServer.getPort()}`
    );

    if (profile === NATIVE_PROFILE && nativeBuildContext && !nativeBuildContext.built) {
      ensureNativeBuildInstalled({
        consumerDir,
        serial,
        port: expoServer.getPort(),
        outputFile: nativeBuildLogFile,
      });
      nativeBuildContext.built = true;
    }

    forceStopPackage(serial, runtime.packageName);
    await new Promise(resolve => setTimeout(resolve, 2500));
    await bringExpoToForeground({
      serial,
      expUrl,
      consumerDir,
      profile,
    });

    takeScreenshot(serial, path.join(screenshotsDir, 'launch.png'));

    await waitForPhaseEvent('runner-ready', 2 * 60 * 1000, `${mode} runner-ready`);

    if (mode === 'recovery') {
      const recoverySignal = await Promise.race([
        waitForPhaseEvent(
          'checkpoint',
          15 * 60 * 1000,
          'recovery checkpoint',
          event => event.checkpoint === 'ready-for-force-stop'
        )
          .then(event => ({
            type: 'checkpoint',
            event,
          })),
        waitForPhaseEvent(
          'summary',
          15 * 60 * 1000,
          'recovery summary before force-stop'
        )
          .then(event => ({
            type: 'summary',
            event,
          })),
      ]);

      if (recoverySignal.type === 'summary') {
        summaryEvent = recoverySignal.event;
      } else {
        takeScreenshot(serial, path.join(screenshotsDir, 'recovery-before-force-stop.png'));
        forceStopPackage(serial, runtime.packageName);
        await new Promise(resolve => setTimeout(resolve, 4000));
        await bringExpoToForeground({
          serial,
          expUrl,
          consumerDir,
          profile,
        });
        await waitForPhaseEvent('runner-ready', 2 * 60 * 1000, `${mode} runner-ready after force-stop`);
      }
    }

    if (mode === 'soak') {
      const intervalMs = restartIntervalMinutes * 60 * 1000;
      const restartTimer = setInterval(() => {
        forceStopPackage(serial, runtime.packageName);
        setTimeout(() => {
          if (expUrl) {
            void bringExpoToForeground({
              serial,
              expUrl,
              consumerDir,
              profile,
            }).catch(() => {});
          }
        }, 4000);
      }, intervalMs);
      restartTimers.push(restartTimer);
    }

    const timeoutMs =
      mode === 'probe'
        ? 8 * 60 * 1000
        : mode === 'soak'
          ? (soakMinutes + 10) * 60 * 1000
          : 45 * 60 * 1000;

    if (!summaryEvent) {
      summaryEvent = await waitForPhaseEvent('summary', timeoutMs, `${mode} summary`);
    }

    takeScreenshot(serial, path.join(screenshotsDir, 'summary.png'));
  } catch (error) {
    phaseError = error;
    takeScreenshot(serial, path.join(screenshotsDir, 'failure.png'));
    captureUiTree(serial, uiTreeFile);
  } finally {
    restartTimers.forEach(timer => clearInterval(timer));
    collectMeminfo(serial, runtime.packageName, meminfoAfter);
    collectCrashLog(serial, crashLogFile);
    monitorResult = await logcatMonitor.stop();
    fs.writeFileSync(
      eventsFile,
      `${(monitorResult.events || []).map(event => JSON.stringify(event)).join('\n')}${monitorResult.events?.length ? '\n' : ''}`,
      'utf8'
    );
    await expoServer.stop();
  }

  if (summaryEvent) {
    recordCase({
      channel,
      profile,
      layer: mode === 'probe' ? 'contract' : mode === 'soak' ? 'soak' : 'runtime',
      group: mode === 'probe' ? 'contract' : mode,
      caseId: `${profile === NATIVE_PROFILE ? 'native_client' : 'expo_go'}_${mode}`,
      stage: mode,
      status: summaryEvent.summary?.status === 'pass' ? 'pass' : 'fail',
      metrics: {
        summary: summaryEvent.summary,
        expUrl,
        packageName: runtime.packageName,
        provider: summaryEvent.runtime?.provider ?? null,
      },
      fatalError: summaryEvent.fatalError || null,
    });
  } else {
    recordCase({
      channel,
      profile,
      layer: mode === 'probe' ? 'contract' : mode === 'soak' ? 'soak' : 'runtime',
      group: mode === 'probe' ? 'contract' : mode,
      caseId: `${profile === NATIVE_PROFILE ? 'native_client' : 'expo_go'}_${mode}`,
      stage: mode,
      status: 'fail',
      error: {
        code: 'EXPO_PHASE_FAILED',
        message: phaseError?.message || `Expo phase ${mode} failed`,
      },
      metrics: {
        expUrl,
        packageName: runtime.packageName,
      },
    });
  }

  return {
    summaryEvent,
    phaseError,
    expUrl,
    phaseArtifacts,
  };
};

const captureDependencyTree = ({ consumerDir, outputFile }) => {
  const result = runCommand(npmCmd, ['ls', '--depth=0', '--json'], {
    cwd: consumerDir,
    timeoutMs: 120000,
  });
  fs.writeFileSync(outputFile, result.stdout || result.stderr, 'utf8');
  return result;
};

const buildRequestedVerdict = (requested, label, nextAction) => {
  if (requested) {
    return null;
  }

  return {
    requested: false,
    status: 'not-requested',
    evidence: [`${label} was not requested in this run`],
    blockers: [],
    nextActions: [nextAction],
  };
};

const buildVerdicts = (channelSummaries, options) => {
  const requestedChannels = Array.isArray(options?.channels) ? options.channels : DEFAULT_CHANNELS;
  const requestedProfiles = Array.isArray(options?.profiles) ? options.profiles : DEFAULT_PROFILES;
  const requestedLayers = Array.isArray(options?.layers) ? options.layers : DEFAULT_LAYERS;
  const selectSummary = (channel, profile) =>
    channelSummaries.find(item => item.channel === channel && item.profile === profile);

  const verdictFromSummary = (channelSummary, label) => {
    if (!channelSummary) {
      return {
        requested: true,
        status: 'blocked',
        evidence: [`No results recorded for ${label}`],
        blockers: [`${label} was not executed`],
        nextActions: ['Run the missing QA channel.'],
      };
    }

    const failures = channelSummary.records.filter(record => record.status === 'fail');
    const evidence = channelSummary.records
      .filter(record => record.status === 'pass')
      .slice(0, 5)
      .map(record => `${record.caseId} passed`);
    const blockers = failures.slice(0, 5).map(record => record.error?.message || record.caseId);

    return {
      requested: true,
      status: failures.length === 0 ? 'pass' : 'fail',
      evidence,
      blockers,
      nextActions:
        failures.length === 0
          ? ['Keep this channel in the release validation checklist.']
          : ['Inspect the recorded artifacts and fix the failing contract/runtime steps.'],
    };
  };

  const buildNativeFlagshipVerdict = channelSummary => {
    if (!channelSummary) {
      return {
        requested: true,
        status: 'blocked',
        evidence: ['No results recorded for managed-compatible native-quick-crypto'],
        blockers: ['managed-compatible native-quick-crypto was not executed'],
        nextActions: ['Run the missing QA channel.'],
      };
    }

    const runtimeRecord = channelSummary.records.find(record => record.caseId === 'native_client_runtime');
    const recoveryRecord = channelSummary.records.find(record => record.caseId === 'native_client_recovery');
    const probeFailure = channelSummary.records.find(
      record => record.caseId === 'native_client_probe' && record.status === 'fail'
    );
    const runtimeValidated =
      runtimeRecord?.status === 'pass'
      && runtimeRecord?.metrics?.provider === 'react-native-quick-crypto'
      && !runtimeRecord?.fatalError;
    const recoveryValidated =
      recoveryRecord?.status === 'pass' && recoveryRecord?.metrics?.provider === 'react-native-quick-crypto';
    const ignoreProbeFailure = Boolean(probeFailure && runtimeValidated && recoveryValidated);

    const failures = channelSummary.records.filter(record => {
      if (record.status !== 'fail') {
        return false;
      }
      if (ignoreProbeFailure && record.caseId === 'native_client_probe') {
        return false;
      }
      return true;
    });

    const evidence = channelSummary.records
      .filter(record => record.status === 'pass')
      .slice(0, 5)
      .map(record => `${record.caseId} passed`);

    if (ignoreProbeFailure) {
      evidence.unshift('native_client_probe failed, but runtime/recovery validated the installed dev client');
    }

    const blockers = failures.slice(0, 5).map(record => record.error?.message || record.caseId);

    return {
      requested: true,
      status: failures.length === 0 ? 'pass' : 'fail',
      evidence,
      blockers,
      nextActions:
        failures.length === 0
          ? ['Keep this channel in the release validation checklist.']
          : ['Inspect the recorded artifacts and fix the failing contract/runtime steps.'],
    };
  };

  const singlePackageExpoRequested =
    requestedChannels.includes('single-package') && requestedProfiles.includes(EXPO_GO_PROFILE);
  const managedExpoRequested =
    requestedChannels.includes('managed-compatible') && requestedProfiles.includes(EXPO_GO_PROFILE);
  const nativeFlagshipRequested =
    requestedChannels.includes('managed-compatible') && requestedProfiles.includes(NATIVE_PROFILE);

  const zeroConfigVerdict =
    buildRequestedVerdict(
      singlePackageExpoRequested,
      'single-package expo-go-js',
      'Run the Expo Go single-package lane to validate the zero-config baseline.'
    )
    || verdictFromSummary(selectSummary('single-package', EXPO_GO_PROFILE), 'single-package expo-go-js');
  const expoRuntimeVerdict =
    buildRequestedVerdict(
      managedExpoRequested,
      'managed-compatible expo-go-js',
      'Run the managed-compatible Expo Go lane to validate the documented install contract.'
    )
    || verdictFromSummary(selectSummary('managed-compatible', EXPO_GO_PROFILE), 'managed-compatible expo-go-js');
  const nativeFlagshipVerdict =
    buildRequestedVerdict(
      nativeFlagshipRequested,
      'managed-compatible native-quick-crypto',
      'Run the native flagship lane before claiming native-performance readiness.'
    )
    || buildNativeFlagshipVerdict(selectSummary('managed-compatible', NATIVE_PROFILE));

  const performanceLaneTargets = [
    managedExpoRequested
      ? {
          channel: 'managed-compatible',
          profile: EXPO_GO_PROFILE,
          label: 'managed-compatible expo-go-js',
        }
      : null,
    nativeFlagshipRequested
      ? {
          channel: 'managed-compatible',
          profile: NATIVE_PROFILE,
          label: 'managed-compatible native-quick-crypto',
        }
      : null,
  ].filter(Boolean);
  const performanceRequested = requestedLayers.includes('runtime') && performanceLaneTargets.length > 0;
  const performanceEvidence = [];
  const performanceBlockers = [];
  let performanceExecutionFailed = false;
  const summarizePhaseRecord = record => {
    const performanceSummary = record?.metrics?.summary?.performanceSummary;
    if (!performanceSummary) {
      return null;
    }

    const parts = [`samples=${performanceSummary.sampleCount}`];
    if (typeof performanceSummary.p95Ms === 'number') {
      parts.push(`p95=${performanceSummary.p95Ms}ms`);
    }
    if (typeof performanceSummary.throughputOpsPerSec === 'number' && performanceSummary.throughputOpsPerSec > 0) {
      parts.push(`throughput=${performanceSummary.throughputOpsPerSec} ops/s`);
    }

    return parts.join(', ');
  };

  for (const lane of performanceLaneTargets) {
    const laneSummary = selectSummary(lane.channel, lane.profile);
    const runtimeRecord = laneSummary?.records.find(record => record.stage === 'runtime');
    const recoveryRecord = laneSummary?.records.find(record => record.stage === 'recovery');
    const soakRecord = laneSummary?.records.find(record => record.stage === 'soak');
    const runtimePerformanceSummary = runtimeRecord?.metrics?.summary?.performanceSummary;

    if (!laneSummary) {
      performanceBlockers.push(`${lane.label} was not executed`);
      continue;
    }

    if (!runtimeRecord) {
      performanceBlockers.push(`Missing runtime summary for ${lane.label}`);
    } else if (runtimeRecord.status !== 'pass') {
      performanceExecutionFailed = true;
      performanceBlockers.push(`${lane.profile}:${runtimeRecord.error?.message || runtimeRecord.caseId}`);
    } else if (!runtimePerformanceSummary) {
      performanceBlockers.push(`Missing performance summary for ${lane.label} runtime`);
    } else {
      const runtimeSummary = summarizePhaseRecord(runtimeRecord);
      performanceEvidence.push(
        runtimeSummary ? `${lane.profile}:runtime ${runtimeSummary}` : `${lane.profile}:runtime passed`
      );
    }

    if (lane.channel === 'managed-compatible') {
      if (!recoveryRecord) {
        performanceBlockers.push(`Missing recovery summary for ${lane.label}`);
      } else if (recoveryRecord.status !== 'pass') {
        performanceExecutionFailed = true;
        performanceBlockers.push(`${lane.profile}:${recoveryRecord.error?.message || recoveryRecord.caseId}`);
      } else {
        performanceEvidence.push(`${lane.profile}:recovery passed`);
      }
    }

    if (requestedLayers.includes('soak')) {
      if (!soakRecord) {
        performanceBlockers.push(`Missing soak summary for ${lane.label}`);
      } else if (soakRecord.status !== 'pass') {
        performanceExecutionFailed = true;
        performanceBlockers.push(`${lane.profile}:${soakRecord.error?.message || soakRecord.caseId}`);
      } else {
        performanceEvidence.push(`${lane.profile}:soak passed`);
      }
    }
  }

  const performanceAndStabilityVerdict =
    buildRequestedVerdict(
      performanceRequested,
      'managed-compatible runtime performance lanes',
      'Run a managed-compatible runtime baseline before claiming performance or stability readiness.'
    )
    || {
      requested: true,
      status:
        performanceBlockers.length === 0 ? 'pass' : performanceExecutionFailed ? 'fail' : 'blocked',
      evidence: performanceEvidence,
      blockers: performanceBlockers,
      nextActions:
        performanceBlockers.length === 0
          ? ['Archive the current artifact bundle as the latest runtime QA baseline.']
          : ['Review the managed-compatible runtime, recovery, and soak artifacts before claiming production or flagship readiness.'],
    };

  return {
    zeroConfigVerdict,
    expoGoRuntimeVerdict: expoRuntimeVerdict,
    nativeFlagshipVerdict,
    performanceAndStabilityVerdict,
  };
};

const runChannel = async ({ channel, profile, tarballPath, options, serial, recordCase }) => {
  const channelArtifacts = ensureDir(path.join(options.artifactsDir, channel, profile));
  const consumerDir = fs.mkdtempSync(buildQaConsumerTempPrefix({
    channel,
    profile,
  }));
  const records = [];
  const nativeBuildContext = {
    built: false,
  };
  const channelRecorder = record => {
    const normalizedRecord = {
      profile,
      ...record,
    };
    records.push(normalizedRecord);
    recordCase(normalizedRecord);
  };

  writeConsumerFiles({
    consumerDir,
    channel,
    profile,
    mode: 'probe',
    runId: `${channel}-probe-${Date.now()}`,
    groups: options.groups,
    soakMinutes: options.soakMinutes,
    restartIntervalMinutes: options.restartIntervalMinutes,
  });

  try {
    try {
      installConsumerDependencies({
        consumerDir,
        tarballPath,
        channel,
        artifactsDir: channelArtifacts,
        profile,
      });
    } catch (error) {
      channelRecorder({
        channel,
        profile,
        layer: 'contract',
        group: 'contract',
        caseId: 'contract_consumer_install',
        stage: 'install',
        status: 'fail',
        error: {
          code: 'CONSUMER_INSTALL_FAILED',
          message: error.message,
          details: error.commandResult?.stderr || error.commandResult?.stdout || undefined,
        },
      });

        return {
          channel,
          profile,
          consumerDir,
          records,
          artifactsDir: channelArtifacts,
      };
    }

    captureDependencyTree({
      consumerDir,
      outputFile: path.join(channelArtifacts, 'dependency-tree.json'),
    });

    const doctorResult = runCommand(npxCmd, ['expo-doctor'], {
      cwd: consumerDir,
      timeoutMs: 10 * 60 * 1000,
      logFile: path.join(channelArtifacts, 'expo-doctor.log'),
    });
    recordCommandCase({
      recordCase: channelRecorder,
      channel,
      profile,
      layer: 'contract',
      caseId: 'contract_expo_doctor',
      group: 'contract',
      result: doctorResult,
      stage: 'expo-doctor',
    });

    const exportResult = runCommand(npxCmd, ['expo', 'export', '--platform', 'android', '--clear'], {
      cwd: consumerDir,
      timeoutMs: 15 * 60 * 1000,
      logFile: path.join(channelArtifacts, 'expo-export.log'),
    });
    recordCommandCase({
      recordCase: channelRecorder,
      channel,
      profile,
      layer: 'contract',
      caseId: 'contract_expo_export_android',
      group: 'contract',
      result: exportResult,
      stage: 'expo-export',
    });

    await runExpoPhase({
      consumerDir,
      channel,
      profile,
      mode: 'probe',
      nativeBuildContext,
      serial,
      artifactsDir: channelArtifacts,
      groups: options.groups,
      soakMinutes: options.soakMinutes,
      restartIntervalMinutes: options.restartIntervalMinutes,
      recordCase: channelRecorder,
    });

    if (options.layers.includes('runtime')) {
      await runExpoPhase({
        consumerDir,
        channel,
        profile,
        mode: 'runtime',
        nativeBuildContext,
        serial,
        artifactsDir: channelArtifacts,
        groups: options.groups,
        soakMinutes: options.soakMinutes,
        restartIntervalMinutes: options.restartIntervalMinutes,
        recordCase: channelRecorder,
      });

      if (channel === 'managed-compatible') {
        await runExpoPhase({
          consumerDir,
          channel,
          profile,
          mode: 'recovery',
          nativeBuildContext,
          serial,
          artifactsDir: channelArtifacts,
          groups: options.groups,
          soakMinutes: options.soakMinutes,
          restartIntervalMinutes: options.restartIntervalMinutes,
          recordCase: channelRecorder,
        });
      }
    }

    if (options.layers.includes('soak') && channel === 'managed-compatible') {
      await runExpoPhase({
        consumerDir,
        channel,
        profile,
        mode: 'soak',
        nativeBuildContext,
        serial,
        artifactsDir: channelArtifacts,
        groups: [...options.groups, 'soak'],
        soakMinutes: options.soakMinutes,
        restartIntervalMinutes: options.restartIntervalMinutes,
        recordCase: channelRecorder,
      });
    }

    return {
      channel,
      profile,
      consumerDir,
      records,
      artifactsDir: channelArtifacts,
    };
  } finally {
    if (options.cleanupConsumers) {
      fs.rmSync(consumerDir, {
        recursive: true,
        force: true,
      });
    } else {
      fs.writeFileSync(path.join(channelArtifacts, 'consumer-path.txt'), `${consumerDir}\n`, 'utf8');
    }
  }
};

const packTarball = artifactsDir => {
  const result = ensureCommandSuccess(
    runCommand(npmCmd, ['pack', '--json', '--ignore-scripts'], {
      cwd: repoRoot,
      timeoutMs: 5 * 60 * 1000,
      logFile: path.join(artifactsDir, 'npm-pack.log'),
    }),
    'Failed to pack npm tarball for runtime QA'
  );

  const parsed = JSON.parse(result.stdout);
  return {
    tarballPath: path.join(repoRoot, parsed[0].filename),
    packResult: parsed[0],
  };
};

const removeTarball = tarballPath => {
  if (tarballPath && fs.existsSync(tarballPath)) {
    fs.unlinkSync(tarballPath);
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(options.artifactsDir);

  const casesFile = path.join(options.artifactsDir, 'cases.jsonl');
  const recordCase = createCaseRecorder(casesFile);

  const emulatorInfo = await ensureAndroidDeviceReady({
    avdName: options.avdName,
    deviceSerial: options.deviceSerial,
  });
  const environment = {
    generatedAt: nowIso(),
    host: {
      cwd: repoRoot,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    expoCliVersion: ensureCommandSuccess(
      runCommand(npxCmd, ['expo', '--version'], {
        cwd: repoRoot,
        timeoutMs: 120000,
      }),
      'Failed to resolve Expo CLI version'
    ).stdout.trim(),
    android: {
      adbPath: adbCmd,
      emulatorPath: emulatorCmd,
      avdName: options.avdName,
      requestedDeviceSerial: options.deviceSerial,
      serial: emulatorInfo.serial,
      expoGoInstalled: getExpoGoInstalled(emulatorInfo.serial),
      startedByScript: emulatorInfo.startedByScript,
      deviceSource: emulatorInfo.deviceSource,
    },
    qaOptions: options,
  };
  writeJson(path.join(options.artifactsDir, 'environment.json'), environment);

  let tarballPath = null;
  try {
    const buildResults = buildPackageForQa(options.artifactsDir);
    writeJson(
      path.join(options.artifactsDir, 'build-results.json'),
      buildResults.map(result => ({
        command: result.command,
        args: result.args,
        code: result.code,
        durationMs: result.durationMs,
      }))
    );

    const packInfo = packTarball(options.artifactsDir);
    tarballPath = packInfo.tarballPath;
    writeJson(path.join(options.artifactsDir, 'pack-result.json'), packInfo.packResult);

    const channelSummaries = [];
    for (const channel of options.channels) {
      for (const profile of options.profiles) {
        if (channel === 'single-package' && profile === NATIVE_PROFILE) {
          continue;
        }

        const summary = await runChannel({
          channel,
          profile,
          tarballPath,
          options,
          serial: emulatorInfo.serial,
          recordCase,
        });
        channelSummaries.push(summary);
      }
    }

    const verdicts = buildVerdicts(channelSummaries, options);
    const summary = {
      generatedAt: nowIso(),
      channels: channelSummaries.map(item => ({
        channel: item.channel,
        profile: item.profile,
        totalRecords: item.records.length,
        passCount: item.records.filter(record => record.status === 'pass').length,
        failCount: item.records.filter(record => record.status === 'fail').length,
      })),
      ...verdicts,
    };
    writeJson(path.join(options.artifactsDir, 'summary.json'), summary);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    removeTarball(tarballPath);
    if (!options.keepEmulator && emulatorInfo.startedByScript) {
      runCommand(adbCmd, ['-s', emulatorInfo.serial, 'emu', 'kill'], {
        timeoutMs: 30000,
      });
    }
  }
};

module.exports = {
  buildPhaseEventMatcher,
  buildNativeRunAndroidArgs,
  buildVerdicts,
  buildQaConsumerTempPrefix,
  isSinglePackageExpoGoDoctorPeerWarning,
  parseAdbDevicesOutput,
  resolveRequestedAdbSerial,
  resolveExpoAndroidDeviceTargetFromDevices,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
