const INDENT = '  ';

const buildSharedQaHelpers = () => `
const QA_PREFIX = 'LITESTORE_QA::';
const DEFAULT_GROUPS = ['functional', 'edge', 'security', 'large-file', 'concurrency', 'business', 'soak'];
const SOAK_STATE_FILE_NAME = 'litestore-qa-soak-state.json';
const RECOVERY_STATE_FILE_NAME = 'litestore-qa-recovery-state.json';
const PROFILE_THRESHOLDS = {
  'expo-go-js': {
    largeFileMs: {
      '25MB': 1500,
      '50MB': 2500,
    },
    bulkOpsPerSec: {
      'plain-5000': 50000,
      'field-encrypted-5000': 600,
      'full-encrypted-5000': 1200,
    },
    initMs: {
      coldP95: 4000,
      warmP95: 1500,
    },
  },
  'native-quick-crypto': {
    largeFileMs: {
      '25MB': 1500,
      '50MB': 1800,
    },
      bulkOpsPerSec: {
        'plain-5000': 50000,
        'field-encrypted-5000': 1200,
        'full-encrypted-5000': 2200,
      },
    initMs: {
      coldP95: 1200,
      warmP95: 250,
    },
  },
};

const getOptionalExpoConstants = () => {
  try {
    let Constants = require('expo-constants');
    if (
      typeof Constants === 'object'
      && Constants
      && 'default' in Constants
      && typeof Constants.default === 'object'
    ) {
      Constants = Constants.default;
    }
    return Constants;
  } catch {
    return null;
  }
};

const getExpoConfig = () => {
  const constants = getOptionalExpoConstants();
  if (constants) {
    try {
      if (typeof constants.getConfig === 'function') {
        const config = constants.getConfig();
        if (config) {
          return config;
        }
      }
    } catch {}

    if (constants.expoConfig) {
      return constants.expoConfig;
    }

    if (constants.manifest) {
      return constants.manifest;
    }

    if (constants.extra) {
      return {
        extra: constants.extra,
      };
    }
  }

  if (typeof globalThis !== 'undefined' && globalThis.__expoConfig) {
    return globalThis.__expoConfig;
  }
  if (typeof global !== 'undefined' && global.__expoConfig) {
    return global.__expoConfig;
  }
  return {};
};

const getQaConfig = () => {
  const extra = getExpoConfig()?.extra ?? {};
  const qa = extra.qa ?? {};
  return {
    channel: qa.channel ?? 'unknown',
    mode: qa.mode ?? 'runtime',
    profile: qa.profile ?? 'expo-go-js',
    runId: qa.runId ?? 'default-run',
    groups: Array.isArray(qa.groups) && qa.groups.length > 0 ? qa.groups : DEFAULT_GROUPS,
    soakMinutes: typeof qa.soakMinutes === 'number' ? qa.soakMinutes : 30,
    restartIntervalMinutes: typeof qa.restartIntervalMinutes === 'number' ? qa.restartIntervalMinutes : 5,
  };
};

const qaConfig = getQaConfig();
const qaLaneId = [qaConfig.channel, qaConfig.mode, qaConfig.profile, qaConfig.runId].join(':');

const nativeLog = message => {
  const logger =
    (typeof globalThis !== 'undefined' && typeof globalThis.nativeLoggingHook === 'function'
      ? globalThis.nativeLoggingHook
      : undefined)
    ?? (typeof global !== 'undefined' && typeof global.nativeLoggingHook === 'function'
      ? global.nativeLoggingHook
      : undefined);

  if (!logger) {
    return;
  }

  try {
    logger(String(message), 0);
  } catch {}
};

const logEvent = payload => {
  const event = {
    ...payload,
    channel: qaConfig.channel,
    mode: qaConfig.mode,
    profile: qaConfig.profile,
    runId: qaConfig.runId,
    laneId: qaLaneId,
    emittedAt: new Date().toISOString(),
  };
  try {
    const serialized = QA_PREFIX + JSON.stringify(event);
    console.log(serialized);
    nativeLog(serialized);
  } catch (error) {
    const fallback = QA_PREFIX + JSON.stringify({
      type: 'logging-error',
      message: 'Failed to serialize QA event',
      fallback: String(error),
      channel: qaConfig.channel,
      mode: qaConfig.mode,
      profile: qaConfig.profile,
      runId: qaConfig.runId,
      laneId: qaLaneId,
    });
    console.log(fallback);
    nativeLog(fallback);
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const quantile = (values, ratio) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
};

const median = values => quantile(values, 0.5);

const normalizeError = error => {
  if (!error) {
    return {
      code: 'UNKNOWN',
      message: 'Unknown error',
    };
  }

  if (typeof error === 'string') {
    return {
      code: 'UNKNOWN',
      message: error,
    };
  }

  const details = error?.details ?? error?.cause?.message ?? undefined;
  return {
    code: error?.code ?? 'UNKNOWN',
    message: error?.message ?? String(error),
    details,
    suggestion: error?.suggestion ?? undefined,
  };
};

const assertQa = (condition, message, extra = {}) => {
  if (!condition) {
    const error = new Error(message);
    Object.assign(error, extra);
    throw error;
  }
};

const assertAtMost = (actual, maximum, message, extra = {}) => {
  assertQa(actual <= maximum, message + ' Expected <= ' + maximum + ', got ' + actual, extra);
};

const assertAtLeast = (actual, minimum, message, extra = {}) => {
  assertQa(actual >= minimum, message + ' Expected >= ' + minimum + ', got ' + actual, extra);
};

const buildLatencyStats = (durations, totalOperations, totalDurationMs) => {
  return {
    totalOperations,
    totalDurationMs,
    throughputOpsPerSec:
      totalDurationMs > 0 ? Number((totalOperations / (totalDurationMs / 1000)).toFixed(2)) : 0,
    p50Ms: quantile(durations, 0.5),
    p95Ms: quantile(durations, 0.95),
    p99Ms: quantile(durations, 0.99),
    maxMs: durations.length ? Math.max(...durations) : 0,
  };
};

const getProfileThresholds = () => PROFILE_THRESHOLDS[qaConfig.profile] ?? PROFILE_THRESHOLDS['expo-go-js'];

const isExpoRuntime = () => {
  const constants = getOptionalExpoConstants();
  return Boolean(constants?.appOwnership === 'expo');
};

const buildRuntimeInfo = overrides => ({
  profile: qaConfig.profile,
  provider: overrides?.provider ?? qaConfig.profile,
  useNative: overrides?.useNative ?? false,
  isExpoGo: overrides?.isExpoGo ?? isExpoRuntime(),
  thresholds: getProfileThresholds(),
});

const measureScenario = async ({ label, warmupRuns = 1, measuredRuns = 3, run }) => {
  for (let warmupIndex = 0; warmupIndex < warmupRuns; warmupIndex += 1) {
    await run({
      label,
      warmup: true,
      iteration: warmupIndex + 1,
    });
  }

  const runs = [];
  for (let index = 0; index < measuredRuns; index += 1) {
    const startedAt = Date.now();
    const result = (await run({
      label,
      warmup: false,
      iteration: index + 1,
    })) ?? {};
    const durationMs = typeof result.durationMs === 'number' ? result.durationMs : Date.now() - startedAt;
    const throughputOpsPerSec =
      typeof result.throughputOpsPerSec === 'number'
        ? result.throughputOpsPerSec
        : typeof result.totalOperations === 'number' && durationMs > 0
          ? Number((result.totalOperations / (durationMs / 1000)).toFixed(2))
          : 0;

    runs.push({
      durationMs,
      throughputOpsPerSec,
      totalOperations: typeof result.totalOperations === 'number' ? result.totalOperations : 1,
      notes: result.notes ?? undefined,
      result: result.metrics ?? undefined,
    });
  }

  const durations = runs.map(item => item.durationMs);
  const throughputs = runs.map(item => item.throughputOpsPerSec).filter(value => value > 0);

  return {
    label,
    warmupRuns,
    measuredRuns,
    runs,
    durationMs: median(durations),
    p50Ms: quantile(durations, 0.5),
    p95Ms: quantile(durations, 0.95),
    p99Ms: quantile(durations, 0.99),
    throughputOpsPerSec: throughputs.length ? median(throughputs) : 0,
  };
};

const assertLargeFileThreshold = sample => {
  const maximum = getProfileThresholds().largeFileMs?.[sample.label];
  if (typeof maximum !== 'number') {
    return;
  }
  assertAtMost(sample.durationMs, maximum, 'Large-file benchmark threshold failed for ' + sample.label, {
    code: 'LARGE_FILE_THRESHOLD_FAILED',
    details: JSON.stringify({
      label: sample.label,
      durationMs: sample.durationMs,
      maximum,
      profile: qaConfig.profile,
    }),
  });
};

const assertBulkThreshold = sample => {
  const key = sample.mode + '-' + sample.batchSize;
  const minimum = getProfileThresholds().bulkOpsPerSec?.[key];
  if (typeof minimum !== 'number') {
    return;
  }
  assertAtLeast(sample.throughputOpsPerSec, minimum, 'Bulk throughput threshold failed for ' + key, {
    code: 'BULK_THROUGHPUT_THRESHOLD_FAILED',
    details: JSON.stringify({
      key,
      throughputOpsPerSec: sample.throughputOpsPerSec,
      minimum,
      profile: qaConfig.profile,
    }),
  });
};

const createCaseRunner = (results, setStatus) => {
  return async (caseId, group, fn, options = {}) => {
    if (!qaConfig.groups.includes(group)) {
      const skipped = {
        type: 'case-skip',
        caseId,
        group,
        reason: 'group-filtered',
      };
      results.push({
        caseId,
        group,
        status: 'skipped',
        reason: 'group-filtered',
      });
      logEvent(skipped);
      return skipped;
    }

    const startTime = Date.now();
    setStatus('Running ' + caseId);
    logEvent({
      type: 'case-start',
      caseId,
      group,
    });

    try {
      const value = await fn();
      const durationMs = Date.now() - startTime;
      const record = {
        caseId,
        group,
        status: 'pass',
        durationMs,
        metrics: value?.metrics ?? undefined,
        notes: value?.notes ?? undefined,
      };
      results.push(record);
      logEvent({
        type: 'case-pass',
        ...record,
      });
      return record;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const normalized = normalizeError(error);
      const record = {
        caseId,
        group,
        status: 'fail',
        durationMs,
        blocking: Boolean(options.blocking),
        error: normalized,
      };
      results.push(record);
      logEvent({
        type: 'case-fail',
        ...record,
      });
      if (options.blocking) {
        throw error;
      }
      return record;
    }
  };
};

const buildSummary = results => {
  const passed = results.filter(result => result.status === 'pass').length;
  const failed = results.filter(result => result.status === 'fail').length;
  const skipped = results.filter(result => result.status === 'skipped').length;
  const blockers = results.filter(result => result.status === 'fail' && result.blocking).length;
  const performanceSamples = results
    .map(result => result.metrics)
    .filter(Boolean)
    .flatMap(metrics => {
      if (Array.isArray(metrics?.samples)) {
        return metrics.samples;
      }
      return [];
    });

  const performanceSummary = performanceSamples.length
    ? {
        sampleCount: performanceSamples.length,
        p50Ms: quantile(
          performanceSamples.map(sample => sample.p50Ms ?? sample.durationMs ?? 0),
          0.5
        ),
        p95Ms: quantile(
          performanceSamples.map(sample => sample.p95Ms ?? sample.durationMs ?? 0),
          0.95
        ),
        p99Ms: quantile(
          performanceSamples.map(sample => sample.p99Ms ?? sample.durationMs ?? 0),
          0.99
        ),
        throughputOpsPerSec: quantile(
          performanceSamples.map(sample => sample.throughputOpsPerSec ?? 0).filter(value => value > 0),
          0.5
        ),
      }
    : null;

  return {
    status: failed === 0 ? 'pass' : blockers > 0 ? 'blocked' : 'fail',
    totals: {
      total: results.length,
      passed,
      failed,
      skipped,
      blockers,
    },
    performanceSummary,
  };
};

const buildQaReport = (results, runtime, fatalError, modeOverride) => ({
  generatedAt: new Date().toISOString(),
  qa: {
    channel: qaConfig.channel,
    mode: modeOverride ?? qaConfig.mode,
    profile: qaConfig.profile,
    runId: qaConfig.runId,
    laneId: qaLaneId,
    groups: [...qaConfig.groups],
  },
  runtime: runtime ?? null,
  summary: buildSummary(results),
  fatalError: fatalError ?? null,
  results: results.map(result => ({
    caseId: result.caseId,
    group: result.group,
    status: result.status,
    durationMs: result.durationMs ?? null,
    blocking: result.blocking ?? false,
    reason: result.reason ?? null,
    error: result.error ?? null,
    notes: result.notes ?? null,
    metrics: result.metrics ?? null,
  })),
});

const buildClipboardReport = report => {
  const results = Array.isArray(report?.results) ? report.results : [];
  return {
    generatedAt: report?.generatedAt ?? new Date().toISOString(),
    qa: report?.qa ?? {
      channel: qaConfig.channel,
      mode: qaConfig.mode,
      profile: qaConfig.profile,
      runId: qaConfig.runId,
      groups: [...qaConfig.groups],
    },
    runtime: report?.runtime ?? null,
    summary: report?.summary ?? null,
    fatalError: report?.fatalError ?? null,
    failedCases: results.filter(result => result.status === 'fail'),
    skippedCases: results.filter(result => result.status === 'skipped'),
    passedCases: results
      .filter(result => result.status === 'pass')
      .map(result => ({
        caseId: result.caseId,
        group: result.group,
        durationMs: result.durationMs,
        notes: result.notes,
      })),
  };
};

const formatClipboardReport = report => JSON.stringify(buildClipboardReport(report), null, 2);

const emitSummary = (results, runtime, fatalError, modeOverride) => {
  const report = buildQaReport(results, runtime, fatalError, modeOverride);
  const payload = {
    type: 'summary',
    summary: report.summary,
  };
  if (report.runtime) {
    payload.runtime = report.runtime;
  }
  if (report.fatalError) {
    payload.fatalError = report.fatalError;
  }
  logEvent(payload);
  return report;
};
`;

const buildSinglePackageRuntimeSource = () => `
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { countTable, db, findOne, insert } from 'expo-lite-data-store';

${buildSharedQaHelpers()}

const runProbeMode = async setStatus => {
  setStatus('Probe mode ready');
  return emitSummary([], buildRuntimeInfo({
    provider: qaConfig.profile,
    useNative: false,
    isExpoGo: true,
  }), undefined, 'probe');
};

const runRuntimeMode = async setStatus => {
  const results = [];
  const runCase = createCaseRunner(results, setStatus);

  await runCase('single_package_basic_crud_probe', 'functional', async () => {
    const tableName = 'qa_single_package_probe';
    await db.init();
    await db.createTable(tableName);
    const writeResult = await db.insert(tableName, {
      id: 'single-package-1',
      label: 'expo-go-bundled-peers',
    });
    const record = await findOne(tableName, {
      where: {
        id: 'single-package-1',
      },
    });
    const totalRecords = await countTable(tableName);
    assertQa(writeResult.written === 1, 'Expected single-package write to report one written record');
    assertQa(record?.label === 'expo-go-bundled-peers', 'Single-package CRUD did not roundtrip in Expo Go');
    assertQa(totalRecords >= 1, \`Expected single-package table count to be at least 1, got \${totalRecords}\`);

    return {
      metrics: {
        writeResult,
        totalRecords,
      },
      notes: [
        record?.label === 'expo-go-bundled-peers'
          ? 'Expo Go bundled modules were sufficient for basic zero-config CRUD in this runtime.'
          : 'Basic CRUD did not roundtrip as expected.',
      ],
    };
  });

  return emitSummary(results, buildRuntimeInfo({
    provider: qaConfig.profile,
    useNative: false,
    isExpoGo: true,
  }), undefined, 'runtime');
};

const runQa = async setStatus => {
  if (qaConfig.mode === 'probe') {
    await runProbeMode(setStatus);
    return;
  }

  await runRuntimeMode(setStatus);
};

export default function App() {
  const [status, setStatus] = useState('Preparing QA runner');
  const [report, setReport] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    let mounted = true;
    let autoStarted = false;

    const updateStatus = value => {
      if (mounted) {
        setStatus(value);
      }
    };

    const updateReport = value => {
      if (mounted) {
        setReport(value);
      }
    };

    const updateRunning = value => {
      if (mounted) {
        setIsRunning(value);
      }
    };

    const updateHasRun = value => {
      if (mounted) {
        setHasRun(value);
      }
    };

    logEvent({
      type: 'runner-ready',
    });

    const run = async () => {
      if (autoStarted) {
        return;
      }
      autoStarted = true;
      updateRunning(true);
      updateHasRun(true);
      updateReport(null);
      try {
        const nextReport = await runQa(updateStatus);
        updateReport(nextReport);
      } catch (error) {
        const normalized = normalizeError(error);
        const failedReport = emitSummary([], buildRuntimeInfo({
          provider: qaConfig.profile,
          useNative: false,
          isExpoGo: true,
        }), normalized, qaConfig.mode);
        updateReport(failedReport);
        updateStatus(\`Fatal: \${normalized.message}\`);
      } finally {
        updateRunning(false);
      }
    };

    void run();

    return () => {
      mounted = false;
    };
  }, []);

  const runFromButton = async () => {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setHasRun(true);
    setReport(null);
    setStatus('Preparing QA runner');

    try {
      const nextReport = await runQa(setStatus);
      setReport(nextReport);
    } catch (error) {
      const normalized = normalizeError(error);
      const failedReport = emitSummary([], buildRuntimeInfo({
        provider: qaConfig.profile,
        useNative: false,
        isExpoGo: true,
      }), normalized, qaConfig.mode);
      setReport(failedReport);
      setStatus(\`Fatal: \${normalized.message}\`);
    } finally {
      setIsRunning(false);
    }
  };

  const reportText = report ? formatClipboardReport(report) : 'No results yet.';

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flex: 1, padding: 24 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>expo-lite-data-store QA</Text>
        <Text style={{ fontSize: 16, marginBottom: 8 }}>Channel: {qaConfig.channel}</Text>
        <Text style={{ fontSize: 16, marginBottom: 8 }}>Mode: {qaConfig.mode}</Text>
        <Text style={{ fontSize: 16, marginBottom: 8 }}>Profile: {qaConfig.profile}</Text>
        <Text style={{ fontSize: 16, marginBottom: 16 }}>{status}</Text>
        <Pressable
          onPress={runFromButton}
          disabled={isRunning}
          style={{
            backgroundColor: isRunning ? '#94a3b8' : '#1d4ed8',
            paddingVertical: 14,
            paddingHorizontal: 18,
            borderRadius: 12,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
            {isRunning ? '测试进行中…' : hasRun ? '重新开始测试' : '开始测试'}
          </Text>
        </Pressable>
        <View
          style={{
            borderWidth: 1,
            borderColor: '#cbd5e1',
            borderRadius: 12,
            padding: 12,
            backgroundColor: '#f8fafc',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 8 }}>测试结果预览</Text>
          <Text selectable style={{ fontSize: 12, lineHeight: 18, color: '#0f172a' }}>
            {reportText}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
`;

const buildManagedRuntimeSource = () => `
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import {
  beginTransaction,
  bulkWrite,
  clearTable,
  commit,
  configManager,
  countTable,
  createTable,
  db,
  deleteTable,
  decrypt,
  encrypt,
  findMany,
  findOne,
  hasTable,
  insert,
  migrateToChunked,
  performanceMonitor,
  plainStorage,
  read,
  remove,
  rollback,
  update,
  verifyCountTable,
} from 'expo-lite-data-store';
import {
  registerNativeCryptoModule,
  useNative as detectNativeCrypto,
} from 'expo-lite-data-store/utils/cryptoProvider';

${buildSharedQaHelpers()}

const primeNativeCryptoModule = () => {
  if (qaConfig.profile !== 'native-quick-crypto') {
    return;
  }

  try {
    const nativeCryptoModule = require('react-native-quick-crypto');
    if (!registerNativeCryptoModule(nativeCryptoModule)) {
      nativeLog('react-native-quick-crypto loaded but did not expose the expected primitives');
    }
  } catch (error) {
    nativeLog('Failed to preload react-native-quick-crypto: ' + String(error?.message ?? error));
  }
};

const createStringPayload = byteCount => 'x'.repeat(byteCount);

const createPayloadRecords = (label, totalBytes, recordCount = 1) => {
  const safeRecordCount = Math.max(1, recordCount);
  const baseSize = Math.floor(totalBytes / safeRecordCount);
  let remaining = totalBytes;

  return Array.from({ length: safeRecordCount }).map((_, index) => {
    const payloadBytes = index === safeRecordCount - 1 ? remaining : baseSize;
    remaining -= payloadBytes;
    return {
      id: \`payload-\${label}-\${index}\`,
      payload: createStringPayload(payloadBytes),
    };
  });
};

const getActiveRootPath = () => {
  const documentDirectory = FileSystem.documentDirectory ?? '';
  return \`\${documentDirectory}\${configManager.getConfig().storageFolder}/\`;
};

const getStateFilePath = fileName => \`\${FileSystem.documentDirectory}\${fileName}\`;

const readJsonFile = async fileName => {
  const filePath = getStateFilePath(fileName);
  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists) {
    return null;
  }
  const text = await FileSystem.readAsStringAsync(filePath);
  return JSON.parse(text);
};

const writeJsonFile = async (fileName, value) => {
  const filePath = getStateFilePath(fileName);
  await FileSystem.writeAsStringAsync(filePath, JSON.stringify(value, null, 2));
  return filePath;
};

const deleteJsonFile = async fileName => {
  const filePath = getStateFilePath(fileName);
  try {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
  } catch {}
};

const resetPlainStorageRuntime = async () => {
  configManager.resetConfig();
  await plainStorage.cleanup();
};

const ensureDeleted = async (uri, options = {}) => {
  try {
    await FileSystem.deleteAsync(uri, {
      idempotent: true,
      ...options,
    });
  } catch {}
};

const cleanupTable = async (tableName, options = {}) => {
  try {
    if (await hasTable(tableName, options)) {
      await deleteTable(tableName, options);
    }
  } catch {}
};

const buildTableOptions = options => options ?? {};

const configureRuntimePerformanceMonitor = () => {
  performanceMonitor.clear();
  performanceMonitor.configure({
    enabled: true,
    sampleRate: 1,
    maxRecords: 50000,
    metricsRetention: 24 * 60 * 60 * 1000,
    thresholds: {
      minSuccessRate: 100,
      maxAverageDuration: qaConfig.profile === 'native-quick-crypto' ? 2000 : 4000,
      maxP95Duration: qaConfig.profile === 'native-quick-crypto' ? 4000 : 8000,
    },
  });
};

const getManagedRuntimeInfo = () => {
  primeNativeCryptoModule();
  const useNative = detectNativeCrypto();
  const provider = useNative ? 'react-native-quick-crypto' : 'expo-go-js-fallback';
  return buildRuntimeInfo({
    provider,
    useNative,
    isExpoGo: isExpoRuntime(),
  });
};

const assertRuntimeProfileContract = runtimeInfo => {
  if (qaConfig.profile === 'native-quick-crypto') {
    assertQa(runtimeInfo.useNative === true, 'Native flagship profile did not enable react-native-quick-crypto', {
      code: 'NATIVE_CRYPTO_NOT_ENABLED',
      details: JSON.stringify(runtimeInfo),
    });
    assertQa(runtimeInfo.provider === 'react-native-quick-crypto', 'Native flagship profile reported an unexpected crypto provider', {
      code: 'NATIVE_CRYPTO_PROVIDER_MISMATCH',
      details: JSON.stringify(runtimeInfo),
    });
    return;
  }

  assertQa(runtimeInfo.useNative === false, 'Expo Go JS profile unexpectedly enabled native crypto', {
    code: 'EXPO_GO_NATIVE_CRYPTO_UNEXPECTED',
    details: JSON.stringify(runtimeInfo),
  });
};

const runInitBenchmark = async label => {
  const sample = await measureScenario({
    label,
    run: async ({ warmup }) => {
      await plainStorage.cleanup();
      configManager.resetConfig();
      const startedAt = Date.now();
      await db.init();
      const durationMs = Date.now() - startedAt;

      if (!warmup) {
        const rootInfo = await FileSystem.getInfoAsync(getActiveRootPath());
        assertQa(rootInfo.exists, 'db.init() did not materialize the storage root');
      }

      return {
        durationMs,
      };
    },
  });

  const thresholds = getProfileThresholds().initMs;
  if (label === 'cold-init') {
    assertAtMost(sample.p95Ms, thresholds.coldP95, 'Cold init threshold failed', {
      code: 'INIT_THRESHOLD_FAILED',
      details: JSON.stringify({
        label,
        p95Ms: sample.p95Ms,
        threshold: thresholds.coldP95,
        profile: qaConfig.profile,
      }),
    });
  } else if (label === 'warm-init') {
    assertAtMost(sample.p95Ms, thresholds.warmP95, 'Warm init threshold failed', {
      code: 'INIT_THRESHOLD_FAILED',
      details: JSON.stringify({
        label,
        p95Ms: sample.p95Ms,
        threshold: thresholds.warmP95,
        profile: qaConfig.profile,
      }),
    });
  }

  return sample;
};

const runProbeMode = async setStatus => {
  setStatus('Probe mode ready');
  return emitSummary([], getManagedRuntimeInfo(), undefined, 'probe');
};

const runFunctionalCases = async (runCase, setStatus) => {
  await runCase('functional_filesystem_scope_probe', 'functional', async () => {
    let modernDocumentUri = null;

    try {
      const modernFileSystem = require('expo-file-system');
      modernDocumentUri = modernFileSystem?.Paths?.document?.uri ?? null;
    } catch {}

    const legacyDocumentDirectory = FileSystem.documentDirectory ?? null;
    const probeDirectory = \`\${legacyDocumentDirectory ?? ''}litestore-direct-probe/\`;
    const probeFile = \`\${probeDirectory}scope.txt\`;

    await ensureDeleted(probeDirectory, { idempotent: true });
    await FileSystem.makeDirectoryAsync(probeDirectory, { intermediates: true });
    await FileSystem.writeAsStringAsync(probeFile, 'scope-ok');
    const written = await FileSystem.readAsStringAsync(probeFile);
    const info = await FileSystem.getInfoAsync(probeFile);
    await ensureDeleted(probeDirectory, { idempotent: true });

    assertQa(written === 'scope-ok', 'Direct expo-file-system write probe did not roundtrip');
    assertQa(info.exists, 'Direct expo-file-system write probe file does not exist');

    return {
      metrics: {
        legacyDocumentDirectory,
        modernDocumentUri,
        probeDirectory,
      },
    };
  });

  await runCase(
    'functional_runtime_profile_contract',
    'functional',
    async () => {
      const runtimeInfo = getManagedRuntimeInfo();
      assertRuntimeProfileContract(runtimeInfo);
      return {
        metrics: runtimeInfo,
      };
    },
    {
      blocking: qaConfig.profile === 'native-quick-crypto',
    }
  );

  await runCase('functional_init_latency_profile', 'functional', async () => {
    const coldInit = await runInitBenchmark('cold-init');

    const warmInit = await measureScenario({
      label: 'warm-init',
      run: async () => {
        const startedAt = Date.now();
        await db.init();
        return {
          durationMs: Date.now() - startedAt,
        };
      },
    });

    const thresholds = getProfileThresholds().initMs;
    assertAtMost(warmInit.p95Ms, thresholds.warmP95, 'Warm init threshold failed', {
      code: 'INIT_THRESHOLD_FAILED',
      details: JSON.stringify({
        label: 'warm-init',
        p95Ms: warmInit.p95Ms,
        threshold: thresholds.warmP95,
        profile: qaConfig.profile,
      }),
    });

    return {
      metrics: {
        samples: [coldInit, warmInit],
      },
    };
  });

  await runCase('functional_auto_init_crud', 'functional', async () => {
    const tableName = 'qa_functional_auto_init';
    await cleanupTable(tableName);
    await resetPlainStorageRuntime();

    await createTable(tableName, {
      columns: {
        id: 'string',
        name: 'string',
        age: 'number',
      },
    });
    const writeResult = await insert(tableName, {
      id: '1',
      name: 'Alice',
      age: 31,
    });
    const record = await findOne(tableName, {
      where: {
        id: '1',
      },
    });

    assertQa(writeResult.written === 1, 'Expected one record to be written');
    assertQa(record?.name === 'Alice', 'Expected record to roundtrip without explicit init');
    await cleanupTable(tableName);

    return {
      metrics: {
        writeResult,
      },
    };
  });

  await runCase('functional_db_init_idempotent', 'functional', async () => {
    await db.init();
    await db.init();
    await db.init();

    const rootPath = getActiveRootPath();
    assertQa(rootPath.includes('lite-data-store'), 'Expected default root path after repeated init');

    return {
      metrics: {
        rootPath,
      },
    };
  });

  await runCase('functional_transactions_commit_and_rollback', 'functional', async () => {
    const tableName = 'qa_functional_transactions';
    await cleanupTable(tableName);
    await createTable(tableName);

    await beginTransaction();
    await insert(tableName, {
      id: 'commit-1',
      status: 'draft',
    });
    await update(
      tableName,
      {
        status: 'committed',
      },
      {
        where: {
          id: 'commit-1',
        },
      }
    );
    await commit();

    const committed = await findOne(tableName, {
      where: {
        id: 'commit-1',
      },
    });

    await beginTransaction();
    await insert(tableName, {
      id: 'rollback-1',
      status: 'temp',
    });
    await rollback();

    const rolledBack = await findOne(tableName, {
      where: {
        id: 'rollback-1',
      },
    });

    let nestedError = null;
    await beginTransaction();
    try {
      await beginTransaction();
    } catch (error) {
      nestedError = error;
    }
    await rollback();

    assertQa(committed?.status === 'committed', 'Transaction commit did not persist changes');
    assertQa(rolledBack === null, 'Transaction rollback did not discard changes');
    assertQa(
      nestedError?.message?.includes('Transaction already in progress'),
      'Nested transaction did not produce the expected error'
    );

    await cleanupTable(tableName);
    return {
      metrics: {
        nestedTransactionCode: nestedError?.code ?? 'UNKNOWN',
      },
    };
  });

  await runCase('functional_app_json_config_loaded', 'functional', async () => {
    const runtimeConfig = configManager.getConfig();
    assertQa(
      runtimeConfig.performance.maxConcurrentOperations === 7,
      \`Expected app.json maxConcurrentOperations=7, got \${runtimeConfig.performance.maxConcurrentOperations}\`
    );
    assertQa(runtimeConfig.timeout === 12345, \`Expected app.json timeout=12345, got \${runtimeConfig.timeout}\`);

    return {
      metrics: {
        maxConcurrentOperations: runtimeConfig.performance.maxConcurrentOperations,
        timeout: runtimeConfig.timeout,
      },
    };
  });

  await runCase('functional_runtime_storage_folder_override', 'functional', async () => {
    const tableName = 'qa_runtime_storage_override';
    const customFolder = 'qa-runtime-storage-folder';
    configManager.updateConfig({
      storageFolder: customFolder,
    });
    await plainStorage.cleanup();

    const customRoot = getActiveRootPath();
    await ensureDeleted(customRoot, { idempotent: true });
    await db.init();
    await createTable(tableName);
    await insert(tableName, {
      id: 'runtime-folder-1',
      label: 'custom-root',
    });
    const info = await FileSystem.getInfoAsync(customRoot);
    const record = await findOne(tableName, {
      where: {
        id: 'runtime-folder-1',
      },
    });

    assertQa(customRoot.includes(customFolder), 'Root path did not switch to runtime-configured storage folder');
    assertQa(info.exists, 'Custom storage folder was not created');
    assertQa(record?.label === 'custom-root', 'Custom-folder data did not roundtrip');

    await cleanupTable(tableName);
    await ensureDeleted(customRoot, { idempotent: true });
    configManager.resetConfig();
    await plainStorage.cleanup();
    await db.init();

    return {
      metrics: {
        customRoot,
      },
    };
  });

  await runCase('functional_legacy_folder_migration', 'functional', async () => {
    const tableName = 'qa_legacy_folder_migration';
    const defaultRoot = getActiveRootPath();
    const documentDirectory = FileSystem.documentDirectory ?? '';
    const legacyRoot = \`\${documentDirectory}expo-lite-data/\`;

    await cleanupTable(tableName);
    await ensureDeleted(defaultRoot, { idempotent: true });
    await ensureDeleted(legacyRoot, { idempotent: true });

    configManager.updateConfig({
      storageFolder: 'expo-lite-data',
    });
    await plainStorage.cleanup();
    await db.init();
    await createTable(tableName);
    await insert(tableName, {
      id: 'legacy-1',
      label: 'legacy-data',
    });
    const legacyInfo = await FileSystem.getInfoAsync(legacyRoot);
    assertQa(legacyInfo.exists, 'Legacy storage folder was not created during setup');

    configManager.resetConfig();
    await plainStorage.cleanup();
    await db.init();

      const migratedRecord = await findOne(tableName, {
        where: {
          id: 'legacy-1',
        },
      });
      const migratedRecords = await read(tableName);
      const newRoot = getActiveRootPath();
      const newRootInfo = await FileSystem.getInfoAsync(newRoot);
      const movedLegacyInfo = await FileSystem.getInfoAsync(legacyRoot);
      const migratedTableInfo = await FileSystem.getInfoAsync(newRoot + tableName + '.ldb');
      const migratedMetaInfo = await FileSystem.getInfoAsync(newRoot + 'meta.ldb');
      const newRootEntries = newRootInfo.exists ? await FileSystem.readDirectoryAsync(newRoot) : [];
      const metadataSnapshot = plainStorage.metadataManager.get(tableName);
      let migratedTableRawPreview = null;
      let migratedMetaRawPreview = null;
      try {
        migratedTableRawPreview = (await FileSystem.readAsStringAsync(newRoot + tableName + '.ldb')).slice(0, 400);
      } catch (error) {
        migratedTableRawPreview = String(error);
      }
      try {
        migratedMetaRawPreview = (await FileSystem.readAsStringAsync(newRoot + 'meta.ldb')).slice(0, 400);
      } catch (error) {
        migratedMetaRawPreview = String(error);
      }

      assertQa(migratedRecord?.label === 'legacy-data', 'Legacy data was not readable after migration', {
        code: 'LEGACY_MIGRATION_FAILED',
        details: JSON.stringify({
          newRoot,
          newRootExists: newRootInfo?.exists ?? false,
          newRootEntries,
          legacyRoot,
          legacyRootExistsAfterMigration: movedLegacyInfo?.exists ?? false,
          migratedMetaExists: migratedMetaInfo?.exists ?? false,
          migratedTableExists: migratedTableInfo?.exists ?? false,
          migratedRecords,
          migratedRecord: migratedRecord ?? null,
          metadataSnapshot: metadataSnapshot ?? null,
          migratedTableRawPreview,
          migratedMetaRawPreview,
        }),
      });
      assertQa(newRootInfo.exists, 'New storage root was not created after migration', {
        code: 'LEGACY_ROOT_MISSING_AFTER_MIGRATION',
        details: JSON.stringify({
          newRoot,
          newRootExists: newRootInfo?.exists ?? false,
          legacyRoot,
          legacyRootExistsAfterMigration: movedLegacyInfo?.exists ?? false,
        }),
      });
      assertQa(!movedLegacyInfo.exists, 'Legacy storage folder still exists after migration', {
        code: 'LEGACY_ROOT_STILL_PRESENT_AFTER_MIGRATION',
        details: JSON.stringify({
          newRoot,
          newRootExists: newRootInfo?.exists ?? false,
          legacyRoot,
          legacyRootExistsAfterMigration: movedLegacyInfo?.exists ?? false,
        }),
      });

    await cleanupTable(tableName);
    return {
      metrics: {
        newRoot,
      },
    };
  });

  await runCase('functional_verify_count_repair', 'functional', async () => {
    const tableName = 'qa_verify_count_repair';
    await cleanupTable(tableName);
    await createTable(tableName);
    await insert(tableName, [
      {
        id: 'verify-1',
        status: 'ok',
      },
      {
        id: 'verify-2',
        status: 'ok',
      },
    ]);

    plainStorage.metadataManager.update(tableName, {
      count: 99,
    });

    const result = await verifyCountTable(tableName);
    const repairedCount = plainStorage.metadataManager.count(tableName);

    assertQa(result.metadata === 99, \`Expected metadata count 99, got \${result.metadata}\`);
    assertQa(result.actual === 2, \`Expected actual count 2, got \${result.actual}\`);
    assertQa(result.match === false, 'Expected verifyCountTable to detect metadata drift');
    assertQa(repairedCount === 2, \`Expected metadata count to repair to 2, got \${repairedCount}\`);

    await cleanupTable(tableName);
    return {
      metrics: result,
    };
  });

  await runCase('functional_migrate_to_chunked_integrity', 'functional', async () => {
    const tableName = 'qa_migrate_to_chunked';
    await cleanupTable(tableName);
    await createTable(tableName, {
      mode: 'single',
    });
    const initialData = Array.from({
      length: 80,
    }).map((_, index) => ({
      id: \`chunk-\${index}\`,
      label: \`record-\${index}\`,
      value: index,
    }));
    await insert(tableName, initialData);

    await migrateToChunked(tableName);

    const records = await read(tableName);
    const meta = plainStorage.metadataManager.get(tableName);

    assertQa(records.length === initialData.length, 'Record count changed after chunk migration');
    assertQa(meta?.mode === 'chunked', \`Expected table mode chunked, got \${meta?.mode ?? 'unknown'}\`);

    await cleanupTable(tableName);
    return {
      metrics: {
        mode: meta?.mode ?? 'unknown',
        count: records.length,
      },
    };
  });
};

const runEdgeCases = async (runCase, setStatus) => {
  await runCase('edge_empty_table_semantics', 'edge', async () => {
    const tableName = 'qa_edge_empty_table';
    await cleanupTable(tableName);
    await createTable(tableName);

    const allRecords = await read(tableName);
    const oneRecord = await findOne(tableName, {
      where: {
        id: 'missing',
      },
    });
    const manyRecords = await findMany(tableName, {
      where: {
        status: 'missing',
      },
    });
    const updated = await update(
      tableName,
      {
        status: 'noop',
      },
      {
        where: {
          id: 'missing',
        },
      }
    );
    const removedCount = await remove(tableName, {
      where: {
        id: 'missing',
      },
    });
    const count = await countTable(tableName);

    assertQa(Array.isArray(allRecords) && allRecords.length === 0, 'Expected empty read result');
    assertQa(oneRecord === null, 'Expected findOne on empty table to return null');
    assertQa(Array.isArray(manyRecords) && manyRecords.length === 0, 'Expected findMany on empty table to return []');
    assertQa(updated === 0, 'Expected update on empty table to return 0');
    assertQa(removedCount === 0, 'Expected remove on empty table to return 0');
    assertQa(count === 0, 'Expected empty countTable to return 0');

    await cleanupTable(tableName);
    return {
      metrics: {
        count,
      },
    };
  });

  await runCase('edge_invalid_query_semantics', 'edge', async () => {
    const tableName = 'qa_edge_invalid_query';
    await cleanupTable(tableName);
    await createTable(tableName);
    await insert(tableName, {
      id: 'edge-invalid-1',
      value: 10,
      active: true,
    });

    const updated = await update(
      tableName,
      {
        value: 11,
      },
      {
        where: 'invalid_where',
      }
    );
    const removedCount = await remove(tableName, {
      where: 'invalid_where',
    });
    const oneRecord = await findOne(tableName, {
      where: 'invalid_where',
    });
    const largeSkip = await findMany(tableName, {
      where: {},
      skip: 1000,
      limit: 5,
    });
    const zeroLimit = await findMany(tableName, {
      where: {},
      skip: 0,
      limit: 0,
    });
    const invalidSort = await findMany(tableName, {
      where: {},
      sortBy: 'missing',
      order: 'invalid_order',
    });

    assertQa(updated === 0, 'Expected update with invalid where to return 0');
    assertQa(removedCount === 0, 'Expected remove with invalid where to return 0');
    assertQa(oneRecord === null, 'Expected findOne with invalid where to return null');
    assertQa(Array.isArray(largeSkip) && largeSkip.length === 0, 'Expected large skip to return []');
    assertQa(Array.isArray(zeroLimit) && zeroLimit.length === 0, 'Expected zero limit to return []');
    assertQa(Array.isArray(invalidSort) && invalidSort.length === 1, 'Expected invalid sort to keep valid data result');

    await cleanupTable(tableName);
    return {
      metrics: {
        updated,
        removedCount,
      },
    };
  });

  await runCase('edge_long_table_name_and_delete_idempotency', 'edge', async () => {
    const tableName = \`qa_\${'a'.repeat(96)}\`;
    await createTable(tableName);
    const exists = await hasTable(tableName);
    await deleteTable(tableName);
    await deleteTable(tableName);

    assertQa(exists === true, 'Expected long table name to be supported');

    return {
      metrics: {
        tableNameLength: tableName.length,
      },
    };
  });
};

const runSecurityCases = async runCase => {
  await runCase('security_encrypt_helper_roundtrip', 'security', async () => {
    const cipherText = await encrypt('qa-secret-payload', 'qa-master-key');
    const plainText = await decrypt(cipherText, 'qa-master-key');
    assertQa(plainText === 'qa-secret-payload', 'Top-level encrypt/decrypt helpers did not roundtrip');

    return {
      metrics: {
        cipherLength: cipherText.length,
      },
    };
  });

  await runCase('security_encrypted_storage_roundtrip', 'security', async () => {
    const tableName = 'qa_security_encrypted_table';
    const options = buildTableOptions({
      encrypted: true,
      encryptFullTable: true,
    });
    await cleanupTable(tableName, {
      encrypted: true,
    });
    await createTable(tableName, options);
    await insert(
      tableName,
      {
        id: 'encrypted-1',
        message: 'cipher-ok',
      },
      {
        encrypted: true,
      }
    );
    const record = await findOne(tableName, {
      where: {
        id: 'encrypted-1',
      },
      encrypted: true,
    });

    assertQa(record?.message === 'cipher-ok', 'Encrypted table data did not roundtrip');

    await cleanupTable(tableName, {
      encrypted: true,
    });
    return {
      metrics: {
        encryptedRecord: Boolean(record),
      },
    };
  });

  await runCase('security_require_auth_on_access_rejected_in_expo_go', 'security', async () => {
    let thrown = null;
    try {
      await db.init({
        encrypted: true,
        requireAuthOnAccess: true,
      });
    } catch (error) {
      thrown = error;
    }

    assertQa(thrown, 'Expected requireAuthOnAccess to fail in Expo Go');
    assertQa(
      thrown?.code === 'AUTH_ON_ACCESS_UNSUPPORTED',
      \`Expected AUTH_ON_ACCESS_UNSUPPORTED, received \${thrown?.code ?? 'UNKNOWN'}\`
    );

    return {
      metrics: {
        code: thrown?.code ?? 'UNKNOWN',
      },
    };
  });
};

const runLargeFileCases = async runCase => {
  await runCase('large_file_chunk_boundary_matrix', 'large-file', async () => {
    const samples = [];
    const mb = 1024 * 1024;
    const sizes = [
      {
        label: '4.5MB',
        bytes: Math.floor(4.5 * mb),
        recordCount: 3,
        expectChunked: false,
      },
      {
        label: '5MB',
        bytes: 5 * mb,
        recordCount: 1,
        migrateToChunked: true,
        expectChunked: true,
        minChunks: 1,
      },
      {
        label: '6MB',
        bytes: 6 * mb,
        recordCount: 2,
        migrateToChunked: true,
        expectChunked: true,
        minChunks: 2,
      },
      {
        label: '25MB',
        bytes: 25 * mb,
        recordCount: 5,
        migrateToChunked: true,
        expectChunked: true,
        minChunks: 5,
      },
      {
        label: '50MB',
        bytes: 50 * mb,
        recordCount: 10,
        migrateToChunked: true,
        expectChunked: true,
        minChunks: 10,
      },
    ];

    for (const sample of sizes) {
      const baseTableName = \`qa_large_\${sample.label.replace(/[^0-9a-z]/gi, '_').toLowerCase()}\`;
      const measured = await measureScenario({
        label: sample.label,
        run: async ({ warmup, iteration }) => {
          const tableName = \`\${baseTableName}_\${warmup ? 'warmup' : 'run'}_\${iteration}\`;
          await cleanupTable(tableName);
          await createTable(tableName);

          if (sample.migrateToChunked) {
            await insert(tableName, {
              id: \`seed-\${sample.label}\`,
              payload: 'seed',
            });
            await migrateToChunked(tableName);
          }

          const recordsToInsert = createPayloadRecords(sample.label, sample.bytes, sample.recordCount);
          const startTime = Date.now();
          const result = await insert(tableName, recordsToInsert);
          const durationMs = Date.now() - startTime;
          const firstRecord = await findOne(tableName, {
            where: {
              id: recordsToInsert[0].id,
            },
          });
          const lastRecord = await findOne(tableName, {
            where: {
              id: recordsToInsert[recordsToInsert.length - 1].id,
            },
          });
          const seedRecord = sample.migrateToChunked
            ? await findOne(tableName, {
                where: {
                  id: \`seed-\${sample.label}\`,
                },
              })
            : null;
          const totalCount = await countTable(tableName);
          const meta = plainStorage.metadataManager.get(tableName);

          assertQa(result.written === recordsToInsert.length, \`Expected \${recordsToInsert.length} records to be written for \${sample.label}\`);
          assertQa(
            firstRecord?.payload?.length === recordsToInsert[0].payload.length,
            \`First large payload \${sample.label} did not roundtrip\`
          );
          assertQa(
            lastRecord?.payload?.length === recordsToInsert[recordsToInsert.length - 1].payload.length,
            \`Last large payload \${sample.label} did not roundtrip\`
          );
          assertQa(
            totalCount === recordsToInsert.length + (sample.migrateToChunked ? 1 : 0),
            \`Expected \${recordsToInsert.length + (sample.migrateToChunked ? 1 : 0)} records after \${sample.label}, got \${totalCount}\`
          );

          if (sample.migrateToChunked) {
            assertQa(seedRecord?.payload === 'seed', \`Chunked migration did not preserve seed data for \${sample.label}\`);
          }

          if (typeof sample.expectChunked === 'boolean') {
            assertQa(
              result.chunked === sample.expectChunked,
              \`Expected chunked=\${sample.expectChunked} for \${sample.label}, got \${result.chunked}\`
            );
          }
          if (sample.expectChunked) {
            assertQa(meta?.mode === 'chunked', \`Expected metadata mode=chunked for \${sample.label}, got \${meta?.mode ?? 'unknown'}\`);
            if (typeof sample.minChunks === 'number') {
              assertQa(
                (meta?.chunks ?? 0) >= sample.minChunks,
                \`Expected at least \${sample.minChunks} chunks for \${sample.label}, got \${meta?.chunks ?? 0}\`
              );
            }
          } else {
            assertQa(meta?.mode === 'single', \`Expected metadata mode=single for \${sample.label}, got \${meta?.mode ?? 'unknown'}\`);
          }

          const metrics = {
            writtenBytes: result.written,
            totalAfterWrite: result.totalAfterWrite,
            recordCount: recordsToInsert.length,
            mode: meta?.mode ?? 'unknown',
            migrated: Boolean(sample.migrateToChunked),
            chunked: result.chunked,
            chunks: result.chunks ?? meta?.chunks ?? null,
            throughputMiBPerSec: Number((((sample.bytes / mb) / (durationMs / 1000 || 1))).toFixed(2)),
          };

          await cleanupTable(tableName);

          return {
            durationMs,
            metrics,
          };
        },
      });

      const representative = measured.runs[measured.runs.length - 1]?.result ?? {};
      const summarized = {
        ...representative,
        label: sample.label,
        durationMs: measured.durationMs,
        p50Ms: measured.p50Ms,
        p95Ms: measured.p95Ms,
        p99Ms: measured.p99Ms,
      };

      assertLargeFileThreshold(summarized);
      samples.push(summarized);
    }

    return {
      metrics: {
        samples,
      },
    };
  });
};

const measureParallelOperations = async (concurrency, operationFactory) => {
  const latencies = [];
  let successCount = 0;
  let failureCount = 0;
  const errors = [];
  const startTime = Date.now();

  await Promise.all(
    Array.from({
      length: concurrency,
    }).map(async (_, index) => {
      const opStart = Date.now();
      try {
        const operations = await operationFactory(index);
        successCount += operations ?? 1;
      } catch (error) {
        failureCount += 1;
        errors.push(normalizeError(error));
      } finally {
        latencies.push(Date.now() - opStart);
      }
    })
  );

  const totalDurationMs = Date.now() - startTime;
  const totalOperations = successCount + failureCount;
  return {
    ...buildLatencyStats(latencies, totalOperations, totalDurationMs),
    concurrency,
    successCount,
    failureCount,
    successRate: totalOperations > 0 ? Number((successCount / totalOperations).toFixed(4)) : 0,
    errors,
  };
};

const assertParallelSampleHealthy = (sample, label) => {
  assertQa(sample.failureCount === 0, label + ' produced failures', {
    code: 'CONCURRENCY_FAILURE_DETECTED',
    details: JSON.stringify({
      label,
      sample,
    }),
  });
  assertQa(sample.successRate === 1, label + ' did not reach 100% success rate', {
    code: 'CONCURRENCY_SUCCESS_RATE_FAILED',
    details: JSON.stringify({
      label,
      sample,
    }),
  });
};

const runConcurrencyCases = async runCase => {
  await runCase('concurrency_read_ladder', 'concurrency', async () => {
    const tableName = 'qa_concurrency_reads';
    await cleanupTable(tableName);
    await createTable(tableName);
    await insert(
      tableName,
      Array.from({
        length: 200,
      }).map((_, index) => ({
        id: \`read-\${index}\`,
        group: index % 5,
        value: index,
      }))
    );

    const samples = [];
    for (const concurrency of [1, 5, 10, 20, 50]) {
      const sample = await measureParallelOperations(concurrency, async index => {
        const records = await findMany(tableName, {
          where: {
            group: index % 5,
          },
          limit: 40,
        });
        assertQa(records.length > 0, 'Expected concurrent read to return records');
        return 1;
      });
      assertParallelSampleHealthy(sample, 'concurrency_read_ladder:' + concurrency);
      samples.push(sample);
    }

    await cleanupTable(tableName);
    return {
      metrics: {
        samples,
      },
    };
  });

  await runCase('concurrency_write_ladder', 'concurrency', async () => {
    const tableName = 'qa_concurrency_writes';
    await cleanupTable(tableName);
    await createTable(tableName);

    const samples = [];
    for (const concurrency of [1, 5, 10, 20, 50]) {
      const sample = await measureParallelOperations(concurrency, async index => {
        const writeResult = await insert(tableName, {
          id: \`write-\${concurrency}-\${index}-\${Date.now()}\`,
          label: \`write-\${index}\`,
        });
        assertQa(writeResult.written === 1, 'Expected concurrent write to report one written record');
        return 1;
      });
      assertParallelSampleHealthy(sample, 'concurrency_write_ladder:' + concurrency);
      samples.push(sample);
    }

    const totalRecords = await countTable(tableName);
    assertQa(totalRecords >= 86, 'Expected concurrent writes to persist the inserted records');

    await cleanupTable(tableName);
    return {
      metrics: {
        totalRecords,
        samples,
      },
    };
  });

  await runCase('concurrency_mixed_ladder', 'concurrency', async () => {
    const tableName = 'qa_concurrency_mixed';
    await cleanupTable(tableName);
    await createTable(tableName);
    await insert(
      tableName,
      Array.from({
        length: 120,
      }).map((_, index) => ({
        id: \`mixed-\${index}\`,
        phase: 'seed',
        value: index,
      }))
    );

    const samples = [];
    for (const concurrency of [1, 5, 10, 20, 50]) {
      const sample = await measureParallelOperations(concurrency, async index => {
        const mode = index % 4;
        if (mode === 0) {
          await insert(tableName, {
            id: \`mixed-new-\${concurrency}-\${index}-\${Date.now()}\`,
            phase: 'inserted',
          });
          return 1;
        }
        if (mode === 1) {
          await findMany(tableName, {
            where: {
              phase: 'seed',
            },
            limit: 20,
          });
          return 1;
        }
        if (mode === 2) {
          await update(
            tableName,
            {
              phase: 'updated',
            },
            {
              where: {
                id: \`mixed-\${index % 50}\`,
              },
            }
          );
          return 1;
        }

        await remove(tableName, {
          where: {
            id: \`mixed-\${(index + concurrency) % 50}\`,
          },
        });
        return 1;
      });
      assertParallelSampleHealthy(sample, 'concurrency_mixed_ladder:' + concurrency);
      samples.push(sample);
    }

    const finalCount = await countTable(tableName);
    assertQa(finalCount >= 0, 'Mixed concurrency produced an invalid record count');

    await cleanupTable(tableName);
    return {
      metrics: {
        finalCount,
        samples,
      },
    };
  });

  await runCase('concurrency_max_limit_boundary', 'concurrency', async () => {
    const tableName = 'qa_concurrency_boundary';
    const configuredLimit = configManager.getConfig().performance.maxConcurrentOperations;
    await cleanupTable(tableName);
    await createTable(tableName);

    const samples = [];
    for (const concurrency of [configuredLimit - 1, configuredLimit, configuredLimit + 1]) {
      const sample = await measureParallelOperations(concurrency, async index => {
        await insert(tableName, {
          id: \`boundary-\${concurrency}-\${index}-\${Date.now()}\`,
          value: index,
        });
        return 1;
      });
      assertParallelSampleHealthy(sample, 'concurrency_max_limit_boundary:' + concurrency);
      samples.push(sample);
    }

    await cleanupTable(tableName);
    return {
      metrics: {
        configuredLimit,
        samples,
      },
    };
  });

  await runCase('concurrency_bulk_throughput_matrix', 'concurrency', async () => {
    const batchSizes = [10, 100, 500, 1000, 5000];
    const modes = [
      {
        label: 'plain',
        createOptions: {},
        tableOptions: {},
      },
      {
        label: 'field-encrypted',
        createOptions: {
          encrypted: true,
          encryptedFields: ['secret'],
        },
        tableOptions: {
          encrypted: true,
        },
      },
      {
        label: 'full-encrypted',
        createOptions: {
          encrypted: true,
          encryptFullTable: true,
        },
        tableOptions: {
          encrypted: true,
        },
      },
    ];

    const samples = [];

    for (const mode of modes) {
      for (const batchSize of batchSizes) {
        const baseTableName = \`qa_bulk_\${mode.label.replace(/[^a-z]/gi, '_').toLowerCase()}_\${batchSize}\`;
        const measured = await measureScenario({
          label: \`\${mode.label}-\${batchSize}\`,
          run: async ({ warmup, iteration }) => {
            const tableName = \`\${baseTableName}_\${warmup ? 'warmup' : 'run'}_\${iteration}\`;
            await cleanupTable(tableName, mode.tableOptions);
            await createTable(tableName, mode.createOptions);
            const operations = Array.from({
              length: batchSize,
            }).map((_, index) => ({
              type: 'insert',
              data: {
                id: \`\${mode.label}-\${batchSize}-\${iteration}-\${index}\`,
                label: mode.label,
                secret: \`secret-\${index}\`,
              },
            }));

            const startTime = Date.now();
            const writeResult = await bulkWrite(tableName, operations, mode.tableOptions);
            const durationMs = Date.now() - startTime;
            const records = await findMany(tableName, {
              where: {},
              ...(mode.tableOptions.encrypted ? { encrypted: true } : {}),
            });

            assertQa(writeResult.written >= batchSize, \`Expected at least \${batchSize} operations to be applied\`);
            assertQa(records.length === batchSize, \`Expected \${batchSize} records after bulk write\`);

            await cleanupTable(tableName, mode.tableOptions);

            return {
              durationMs,
              throughputOpsPerSec: Number((batchSize / (durationMs / 1000 || 1)).toFixed(2)),
              totalOperations: batchSize,
              metrics: {
                mode: mode.label,
                batchSize,
                chunked: writeResult.chunked,
              },
            };
          },
        });

        const representative = measured.runs[measured.runs.length - 1]?.result ?? {};
        const summarized = {
          ...representative,
          label: \`\${mode.label}-\${batchSize}\`,
          mode: mode.label,
          batchSize,
          durationMs: measured.durationMs,
          p50Ms: measured.p50Ms,
          p95Ms: measured.p95Ms,
          p99Ms: measured.p99Ms,
          throughputOpsPerSec: measured.throughputOpsPerSec,
        };
        assertBulkThreshold(summarized);
        samples.push(summarized);
      }
    }

    return {
      metrics: {
        samples,
      },
    };
  });
};

const runBusinessCases = async runCase => {
  await runCase('business_encrypted_profile_flow', 'business', async () => {
    const tableName = 'qa_business_profile_flow';
    const measured = await measureScenario({
      label: 'encrypted-profile-flow',
      run: async ({ warmup, iteration }) => {
        await cleanupTable(tableName, {
          encrypted: true,
        });
        await createTable(tableName, {
          encrypted: true,
          encryptFullTable: true,
        });

        const profileId = \`profile-\${warmup ? 'warmup' : 'run'}-\${iteration}\`;
        const startedAt = Date.now();
        await insert(
          tableName,
          {
            id: profileId,
            name: 'Ada',
            locale: 'zh-CN',
            featureFlags: ['sync', 'offline'],
            theme: 'dark',
          },
          {
            encrypted: true,
          }
        );
        await update(
          tableName,
          {
            theme: 'light',
            updatedAt: iteration,
          },
          {
            where: {
              id: profileId,
            },
            encrypted: true,
          }
        );
        const record = await findOne(tableName, {
          where: {
            id: profileId,
          },
          encrypted: true,
        });
        const durationMs = Date.now() - startedAt;

        assertQa(record?.theme === 'light', 'Encrypted profile flow did not persist the update');

        await cleanupTable(tableName, {
          encrypted: true,
        });

        return {
          durationMs,
          metrics: {
            recordId: profileId,
            finalTheme: record?.theme ?? null,
          },
        };
      },
    });

    return {
      metrics: {
        samples: [
          {
            label: 'encrypted-profile-flow',
            durationMs: measured.durationMs,
            p50Ms: measured.p50Ms,
            p95Ms: measured.p95Ms,
            p99Ms: measured.p99Ms,
          },
        ],
      },
    };
  });

  await runCase('business_append_heavy_event_flow', 'business', async () => {
    const tableName = 'qa_business_event_flow';
    const batchSize = 1000;
    const measured = await measureScenario({
      label: 'append-heavy-event-flow',
      run: async ({ warmup, iteration }) => {
        await cleanupTable(tableName);
        await createTable(tableName);
        const operations = Array.from({
          length: batchSize,
        }).map((_, index) => ({
          type: 'insert',
          data: {
            id: \`event-\${warmup ? 'warmup' : 'run'}-\${iteration}-\${index}\`,
            channel: 'sync',
            payload: 'evt-' + index,
          },
        }));

        const startedAt = Date.now();
        const result = await bulkWrite(tableName, operations);
        const durationMs = Date.now() - startedAt;
        const count = await countTable(tableName);

        assertQa(result.written >= batchSize, 'Append-heavy event flow did not report all inserted records');
        assertQa(count === batchSize, 'Append-heavy event flow produced an unexpected row count');

        await cleanupTable(tableName);

        return {
          durationMs,
          totalOperations: batchSize,
          throughputOpsPerSec: Number((batchSize / (durationMs / 1000 || 1)).toFixed(2)),
          metrics: {
            count,
            chunked: result.chunked,
          },
        };
      },
    });

    return {
      metrics: {
        samples: [
          {
            label: 'append-heavy-event-flow',
            batchSize,
            durationMs: measured.durationMs,
            p50Ms: measured.p50Ms,
            p95Ms: measured.p95Ms,
            p99Ms: measured.p99Ms,
            throughputOpsPerSec: measured.throughputOpsPerSec,
          },
        ],
      },
    };
  });

  await runCase('business_chunked_document_cache_flow', 'business', async () => {
    const mb = 1024 * 1024;
    const tableName = 'qa_business_document_cache';
    const measured = await measureScenario({
      label: 'chunked-document-cache-50MB',
      run: async ({ warmup, iteration }) => {
        await cleanupTable(tableName);
        await createTable(tableName);
        await insert(tableName, {
          id: 'seed-doc',
          title: 'seed',
          payload: 'seed',
        });
        await migrateToChunked(tableName);

        const records = createPayloadRecords('document-cache-' + iteration, 50 * mb, 10);
        const startedAt = Date.now();
        const writeResult = await insert(tableName, records);
        const durationMs = Date.now() - startedAt;
        const cached = await findMany(tableName, {
          where: {},
          limit: 12,
        });
        const totalPayload = cached.reduce((sum, record) => sum + String(record.payload ?? '').length, 0);

        assertQa(writeResult.chunked === true, 'Chunked document cache flow did not stay in chunked mode');
        assertQa(totalPayload >= 50 * mb, 'Chunked document cache payload size was smaller than expected');

        await cleanupTable(tableName);

        return {
          durationMs,
          metrics: {
            chunked: writeResult.chunked,
            chunks: writeResult.chunks ?? null,
            totalPayload,
          },
        };
      },
    });

    const sample = {
      label: '50MB',
      durationMs: measured.durationMs,
    };
    assertLargeFileThreshold(sample);

    return {
      metrics: {
        samples: [
          {
            label: 'chunked-document-cache-50MB',
            durationMs: measured.durationMs,
            p50Ms: measured.p50Ms,
            p95Ms: measured.p95Ms,
            p99Ms: measured.p99Ms,
          },
        ],
      },
    };
  });
};

const runRuntimeMode = async setStatus => {
  const results = [];
  const runCase = createCaseRunner(results, setStatus);
  configureRuntimePerformanceMonitor();
  const runtimeInfo = getManagedRuntimeInfo();

  await runFunctionalCases(runCase, setStatus);
  await runEdgeCases(runCase, setStatus);
  await runSecurityCases(runCase);
  await runLargeFileCases(runCase);
  await runConcurrencyCases(runCase);
  await runBusinessCases(runCase);

  return emitSummary(results, runtimeInfo, undefined, 'runtime');
};

const runRecoveryMode = async setStatus => {
  const results = [];
  const runCase = createCaseRunner(results, setStatus);

  await runCase(
    'runtime_force_stop_recovery',
    'functional',
    async () => {
      const tableName = 'qa_recovery_table';
      const persistedState = await readJsonFile(RECOVERY_STATE_FILE_NAME);
      const state = persistedState && persistedState.runId === qaConfig.runId ? persistedState : null;

      if (persistedState && persistedState.runId !== qaConfig.runId) {
        await deleteJsonFile(RECOVERY_STATE_FILE_NAME);
      }

      if (!state) {
        await cleanupTable(tableName);
        await createTable(tableName);
        const payload = {
          id: 'recovery-1',
          payload: 'force-stop-persistence',
          updatedAt: Date.now(),
        };
        await insert(tableName, payload);
        await writeJsonFile(RECOVERY_STATE_FILE_NAME, {
          runId: qaConfig.runId,
          tableName,
          recordId: payload.id,
          expectedPayload: payload.payload,
        });
        logEvent({
          type: 'checkpoint',
          checkpoint: 'ready-for-force-stop',
          caseId: 'runtime_force_stop_recovery',
          group: 'functional',
        });
        setStatus('Waiting for orchestrator force-stop');
        await new Promise(() => {});
      }

      const record = await findOne(state.tableName, {
        where: {
          id: state.recordId,
        },
      });
      const tableRoot = getActiveRootPath();
      const tableFileInfo = await FileSystem.getInfoAsync(tableRoot + state.tableName + '.ldb');
      const metaFileInfo = await FileSystem.getInfoAsync(tableRoot + 'meta.ldb');
      let tableFilePreview = null;
      let metaFilePreview = null;
      try {
        tableFilePreview = (await FileSystem.readAsStringAsync(tableRoot + state.tableName + '.ldb')).slice(0, 400);
      } catch (error) {
        tableFilePreview = String(error);
      }
      try {
        metaFilePreview = (await FileSystem.readAsStringAsync(tableRoot + 'meta.ldb')).slice(0, 400);
      } catch (error) {
        metaFilePreview = String(error);
      }

      assertQa(record?.payload === state.expectedPayload, 'Recovery verification failed after Expo Go relaunch', {
        code: 'RECOVERY_VERIFICATION_FAILED',
        details: JSON.stringify({
          runId: qaConfig.runId,
          tableRoot,
          tableFileExists: tableFileInfo?.exists ?? false,
          metaFileExists: metaFileInfo?.exists ?? false,
          record: record ?? null,
          state,
          tableFilePreview,
          metaFilePreview,
        }),
      });
      await deleteJsonFile(RECOVERY_STATE_FILE_NAME);
      await cleanupTable(state.tableName);

      return {
        metrics: {
          recordId: state.recordId,
        },
      };
    },
    {
      blocking: true,
    }
  );

  return emitSummary(results, getManagedRuntimeInfo(), undefined, 'recovery');
};

const performSoakIteration = async state => {
  const tableName = 'qa_soak_table';
  if (!(await hasTable(tableName))) {
    await createTable(tableName);
  }

  const operations = Array.from({
    length: 25,
  }).map((_, index) => ({
    type: 'insert',
    data: {
      id: \`soak-\${state.iteration}-\${index}\`,
      iteration: state.iteration,
      value: index,
    },
  }));

  await bulkWrite(tableName, operations);
  const records = await findMany(tableName, {
    where: {
      iteration: state.iteration,
    },
  });
  assertQa(records.length === 25, 'Soak iteration bulk write produced inconsistent record count');

  const readResult = await findMany(tableName, {
    where: {},
    limit: 40,
  });
  assertQa(Array.isArray(readResult), 'Soak read result should be an array');

  await clearTable(tableName);
  const remaining = await countTable(tableName);
  assertQa(remaining === 0, 'Soak clearTable did not empty the table');
};

const runSoakMode = async setStatus => {
  const results = [];
  const runCase = createCaseRunner(results, setStatus);

  await runCase(
    'soak_thirty_minute_stability_loop',
    'soak',
    async () => {
      const durationMs = qaConfig.soakMinutes * 60 * 1000;
      const now = Date.now();
      const savedState = (await readJsonFile(SOAK_STATE_FILE_NAME)) ?? {
        startedAt: now,
        iteration: 0,
        successCount: 0,
        failureCount: 0,
        lastError: null,
      };

      while (Date.now() - savedState.startedAt < durationMs) {
        try {
          await performSoakIteration(savedState);
          savedState.successCount += 1;
        } catch (error) {
          savedState.failureCount += 1;
          savedState.lastError = normalizeError(error);
        }

        savedState.iteration += 1;
        await writeJsonFile(SOAK_STATE_FILE_NAME, savedState);
        setStatus(\`Soak iteration \${savedState.iteration}\`);
        await sleep(1000);
      }

      await deleteJsonFile(SOAK_STATE_FILE_NAME);
      await cleanupTable('qa_soak_table');

      const totalIterations = savedState.successCount + savedState.failureCount;
      const failureRate = totalIterations > 0 ? savedState.failureCount / totalIterations : 0;
      assertQa(failureRate < 0.001, \`Soak failure rate too high: \${failureRate}\`, {
        code: 'SOAK_FAILURE_RATE_EXCEEDED',
      });

      return {
        metrics: {
          successCount: savedState.successCount,
          failureCount: savedState.failureCount,
          failureRate,
          startedAt: savedState.startedAt,
          completedAt: Date.now(),
          samples: [
            {
              durationMs,
            },
          ],
        },
      };
    },
    {
      blocking: true,
    }
  );

  return emitSummary(results, getManagedRuntimeInfo(), undefined, 'soak');
};

const runQa = async setStatus => {
  if (qaConfig.mode === 'probe') {
    return runProbeMode(setStatus);
  }

  if (qaConfig.mode === 'recovery') {
    return runRecoveryMode(setStatus);
  }

  if (qaConfig.mode === 'soak') {
    return runSoakMode(setStatus);
  }

  return runRuntimeMode(setStatus);
};

const runInteractiveQa = async setStatus => {
  if (qaConfig.mode === 'probe') {
    return runRuntimeMode(setStatus);
  }

  return runQa(setStatus);
};

export default function App() {
  const [status, setStatus] = useState('Preparing QA runner');
  const [report, setReport] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    let mounted = true;
    let autoStarted = false;

    const updateStatus = value => {
      if (mounted) {
        setStatus(value);
      }
    };

    const updateReport = value => {
      if (mounted) {
        setReport(value);
      }
    };

    const updateRunning = value => {
      if (mounted) {
        setIsRunning(value);
      }
    };

    const updateHasRun = value => {
      if (mounted) {
        setHasRun(value);
      }
    };

    const updateCopyStatus = value => {
      if (mounted) {
        setCopyStatus(value);
      }
    };

    logEvent({
      type: 'runner-ready',
    });

    const run = async () => {
      if (autoStarted) {
        return;
      }
      autoStarted = true;
      updateRunning(true);
      updateHasRun(true);
      updateReport(null);
      updateCopyStatus('');
      try {
        const nextReport = await runQa(updateStatus);
        updateReport(nextReport);
      } catch (error) {
        const normalized = normalizeError(error);
        const failedReport = emitSummary([], getManagedRuntimeInfo(), normalized, qaConfig.mode);
        updateReport(failedReport);
        updateStatus(\`Fatal: \${normalized.message}\`);
      } finally {
        updateRunning(false);
      }
    };

    void run();

    return () => {
      mounted = false;
    };
  }, []);

  const runFromButton = async () => {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setHasRun(true);
    setReport(null);
    setCopyStatus('');
    setStatus('Preparing QA runner');

    try {
      const nextReport = await runInteractiveQa(setStatus);
      setReport(nextReport);
    } catch (error) {
      const normalized = normalizeError(error);
      const failedReport = emitSummary([], getManagedRuntimeInfo(), normalized, qaConfig.mode);
      setReport(failedReport);
      setStatus(\`Fatal: \${normalized.message}\`);
    } finally {
      setIsRunning(false);
    }
  };

  const copyResult = async () => {
    if (!report) {
      setCopyStatus('暂无可复制结果');
      return;
    }

    try {
      await Clipboard.setStringAsync(formatClipboardReport(report));
      setCopyStatus('测试结果已复制到剪贴板');
    } catch (error) {
      const normalized = normalizeError(error);
      setCopyStatus(\`复制失败: \${normalized.message}\`);
    }
  };

  const reportText = report ? formatClipboardReport(report) : 'No results yet.';

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flex: 1, padding: 24 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>expo-lite-data-store QA</Text>
        <Text style={{ fontSize: 16, marginBottom: 8 }}>Channel: {qaConfig.channel}</Text>
        <Text style={{ fontSize: 16, marginBottom: 8 }}>Mode: {qaConfig.mode}</Text>
        <Text style={{ fontSize: 16, marginBottom: 8 }}>Profile: {qaConfig.profile}</Text>
        <Text style={{ fontSize: 16, marginBottom: 8 }}>Groups: {qaConfig.groups.join(', ')}</Text>
        <Text style={{ fontSize: 16, marginBottom: 16 }}>{status}</Text>
        <Pressable
          onPress={runFromButton}
          disabled={isRunning}
          style={{
            backgroundColor: isRunning ? '#94a3b8' : '#1d4ed8',
            paddingVertical: 14,
            paddingHorizontal: 18,
            borderRadius: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
            {isRunning ? '测试进行中…' : hasRun ? '重新开始测试' : '开始测试'}
          </Text>
        </Pressable>
        <Pressable
          onPress={copyResult}
          disabled={!report}
          style={{
            backgroundColor: report ? '#0f766e' : '#cbd5e1',
            paddingVertical: 14,
            paddingHorizontal: 18,
            borderRadius: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: report ? '#fff' : '#475569', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
            一键复制结果
          </Text>
        </Pressable>
        <Text style={{ fontSize: 13, color: '#334155', marginBottom: 12 }}>{copyStatus || '复制结果后可直接粘贴到对话里。'}</Text>
        <View
          style={{
            borderWidth: 1,
            borderColor: '#cbd5e1',
            borderRadius: 12,
            padding: 12,
            backgroundColor: '#f8fafc',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 8 }}>测试结果预览</Text>
          <Text selectable style={{ fontSize: 12, lineHeight: 18, color: '#0f172a' }}>
            {reportText}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
`;

const buildRunnerAppSource = ({ channel }) => {
  if (channel === 'single-package') {
    return buildSinglePackageRuntimeSource();
  }

  return buildManagedRuntimeSource();
};

module.exports = {
  buildRunnerAppSource,
};
