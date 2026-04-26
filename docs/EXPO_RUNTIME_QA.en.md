# Expo Runtime QA Guide

This guide documents the maintained runtime QA baselines for `expo-lite-data-store`. It is intended for contributors and release maintainers who need artifact-backed evidence that the packed npm artifact behaves correctly in Expo Go and in the native flagship profile.

[README Entry](../README.md) | [简体中文](./EXPO_RUNTIME_QA.zh-CN.md) | [API Reference](./API.en.md) | [Changelog](./CHANGELOG.en.md)

## Scope

The QA harness validates the packed npm tarball inside temporary Expo consumer applications on Android. It is designed to answer three release questions:

1. Does the published package install correctly in the documented consumer contract?
2. Does the managed Expo Go runtime behave correctly after first launch, reload, and force-stop recovery?
3. Does the native flagship profile validate `react-native-quick-crypto` in a real native client?

The supported consumer contract is the documented `expo install` command from [README.en.md](../README.en.md). A package-manager-only install of `expo-lite-data-store` is not treated as release-ready evidence because Expo peer dependencies may be missing or version-misaligned.

## QA Lanes

### Channels

- `single-package`
  Validates the zero-config floor by installing only `expo-lite-data-store`.
- `managed-compatible`
  Validates the documented install contract by installing `expo-lite-data-store` together with the required Expo peer dependencies.

### Profiles

- `expo-go-js`
  Uses Expo Go with the JavaScript fallback crypto provider.
- `native-quick-crypto`
  Uses a native dev client with `react-native-quick-crypto`.

### Modes

- `probe`
  Confirms that the app launches, the runtime contract is readable, and the QA runner is wired correctly.
- `runtime`
  Runs the functional, edge, security, large-file, concurrency, and business groups.
- `recovery`
  Validates force-stop and relaunch recovery for the managed-compatible app.
- `soak`
  Optional long-running stability loop with periodic relaunches.

## Standard Commands

Recommended release-order commands:

```bash
npm run qa:baseline:expo-go
npm run qa:baseline:native-flagship
```

To run both baselines in sequence:

```bash
npm run qa:baseline:release
```

Additional entry points:

```bash
npm run qa:expo-go:contract
npm run qa:expo-go:mumu
npm run qa:expo-go:mumu:full
npm run qa:flagship:native
```

Direct harness usage for focused reruns:

```bash
node ./scripts/expo-runtime-qa.cjs --layers=contract,runtime --channels=managed-compatible --profiles=expo-go-js --groups=functional,security
```

## Event and Summary Contract

Every QA event emitted from the device includes stable lane identity fields:

- `channel`
- `mode`
- `profile`
- `runId`
- `laneId`

The harness accepts only events that match the current phase identity. This prevents stale logcat entries, previous runs, and unrelated manual reruns from polluting the active phase summary.

`summary.json` is request-aware:

- Unrequested lanes are reported as `not-requested`.
- Requested but missing evidence is reported as `blocked`.
- Native flagship verdicts may still pass when `native_client_probe` fails but `runtime` and `recovery` both validate `react-native-quick-crypto`.

## Artifact Layout

Every run writes a timestamped bundle under:

```text
artifacts/expo-runtime-qa/<timestamp>/
```

Important files:

- `summary.json`
  Top-level verdicts for the requested run scope.
- `cases.jsonl`
  Flat case records across every lane.
- `environment.json`
  Host, Android device, Expo CLI, and QA option metadata.
- `<channel>/<profile>/dependency-tree.json`
  Consumer dependency snapshot after install.
- `<channel>/<profile>/expo-doctor.log`
  Contract validation output.
- `<channel>/<profile>/expo-export.log`
  Android export validation output.
- `<channel>/<profile>/<mode>/events.jsonl`
  Accepted phase events for that exact lane and run ID.
- `<channel>/<profile>/<mode>/logcat.txt`
  Full captured logcat stream for the phase.
- `<channel>/<profile>/<mode>/screenshots/`
  Launch, summary, and failure screenshots when capture succeeds.

The release source of truth is `summary.json`, with `cases.jsonl` and per-phase artifacts used for drill-down.

## Verdict Interpretation

- `zeroConfigVerdict`
  Release confidence for the `single-package` Expo Go lane.
- `expoGoRuntimeVerdict`
  Release confidence for the documented managed-compatible Expo Go install contract.
- `nativeFlagshipVerdict`
  Release confidence for the managed-compatible native dev client lane.
- `performanceAndStabilityVerdict`
  Performance and recovery evidence for the requested managed-compatible runtime lanes only.

`performanceAndStabilityVerdict` does not require data from unrequested profiles. For example, an Expo Go-only run must not be blocked merely because the native flagship lane was not part of the request.

## Environment Prerequisites

### Android target

- Windows is the maintained host environment for the current harness.
- MuMu is the primary Android baseline, but any adb-visible Android target can be used.
- When using MuMu, confirm that `adb devices -l` shows the emulator before starting the run. A common serial is `127.0.0.1:7555`, but the harness relies on the actual adb-visible serial.

### Expo Go

- Use Expo Go that matches Expo SDK 54.
- The harness expects the Android device to be unlocked and available for foreground app launches.

### Native flagship

- The native flagship lane builds or reuses an Android dev client.
- `react-native-quick-crypto` must be installable in the temporary consumer app.
- The release verdict is based on the runtime provider reported by the app, not on package installation alone.

## Known Limits and Expected Outcomes

- `requireAuthOnAccess: true` must throw `AUTH_ON_ACCESS_UNSUPPORTED` in Expo Go. This is an expected pass condition, not a failure.
- `single-package` validates the zero-config floor only. It is not the supported install contract and it is not the performance baseline.
- In the `single-package` lane, `expo-doctor` peer warnings for `expo-constants`, `expo-crypto`, `expo-file-system`, and `expo-secure-store` are recorded as a warning rather than a blocking failure when export and runtime still pass in Expo Go.
- Manual UI actions inside the QA consumer are useful for triage, but release evidence should still come from the artifact bundle written by the harness.
- Native probe failures can be tolerated only when the same run also proves the installed native client through successful `runtime` and `recovery` phases.

## Recommended Release Checklist

1. Run `npm run qa:baseline:expo-go`.
2. Inspect `summary.json` and confirm both `zeroConfigVerdict` and `expoGoRuntimeVerdict` are `pass`.
3. Run `npm run qa:baseline:native-flagship`.
4. Inspect `summary.json` and confirm `nativeFlagshipVerdict` and `performanceAndStabilityVerdict` are `pass`.
5. Archive the artifact directories alongside the release notes or publish checklist.
