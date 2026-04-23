---
name: Bug report
about: Report a library defect, install-contract failure, or runtime regression
title: '[bug] '
labels: bug
assignees: ''
---

## Summary

Describe the defect clearly and concisely.

## Reproduction Steps

Provide a minimal, deterministic reproduction:

1. Install command used
2. Application type, for example Expo Go, managed app, native dev client, or standalone build
3. Exact steps to trigger the problem
4. Result

## Expected Behavior

Describe what should have happened.

## Actual Behavior

Describe what actually happened, including errors, red screens, crashes, or data corruption symptoms.

## Environment

- `expo-lite-data-store` version:
- Expo SDK version:
- React Native version:
- Platform and device or emulator:
- Runtime surface: `Expo Go` / `managed app` / `native dev client` / `standalone build`
- Crypto provider: `expo-go-js-fallback` / `react-native-quick-crypto` / other

## Installation Contract

- Exact install command used:
- Were required Expo peer dependencies installed with `npx expo install`?
- Was `react-native-quick-crypto` installed?

## Logs and Artifacts

Paste or attach any relevant evidence:

- Metro error output
- logcat output
- stack traces
- `summary.json`
- `events.jsonl`
- screenshots only when text logs are insufficient

## Minimal Reproduction

If possible, provide a minimal repository or code snippet that reproduces the issue.

## Additional Context

Add any other context that helps triage the defect.

## Verification Checklist

- [ ] I searched existing issues before filing this report
- [ ] I included reproduction steps
- [ ] I included version and runtime information
- [ ] I attached logs or QA artifacts when available
