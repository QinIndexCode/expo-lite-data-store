# CI/CD Operations

[README Entry](../README.md) | [简体中文](./CI_CD.zh-CN.md) | [Runtime QA](./EXPO_RUNTIME_QA.en.md) | [Changelog](./CHANGELOG.en.md)

This runbook is for maintainers who need to validate a change, diagnose GitHub Actions, or publish the npm package. Workflow YAML and `package.json` scripts remain the executable source of truth; this guide explains how to operate them safely.

## Workflow Map

| Workflow                                            | Trigger                                                 | Purpose                                                                                  | Secrets                            |
| --------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `CI` (`.github/workflows/ci.yml`)                   | Push to `main`, pull request to `main`, manual dispatch | Install, type-check, test, build, validate an Expo consumer, and inspect the npm package | None                               |
| `Release package` (`.github/workflows/release.yml`) | Push of a `vX.Y.Z` or prerelease tag                    | Re-run the release gate and publish the matching npm version with provenance             | `NPM_TOKEN`                        |
| CodeQL / OpenSSF Scorecard                          | Push and scheduled runs                                 | Security analysis and repository posture checks                                          | Managed by GitHub where applicable |

Pull requests never receive the npm publishing credential and cannot trigger package publication.

## Local Gate Before Push

For normal changes, run:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test -- --runInBand --coverage=false
npm run build:all
```

For packaging, storage-runtime, Expo compatibility, dependency, or release changes, run the complete release gate:

```bash
npm run prepublishOnly
npm pack --dry-run --ignore-scripts
```

`prepublishOnly` includes dependency audits, all maintained test groups, builds, type-checking, lint, and the temporary Expo consumer smoke test. Runtime-device evidence beyond the consumer smoke is documented in [EXPO_RUNTIME_QA.en.md](./EXPO_RUNTIME_QA.en.md).

## One-Time Repository Setup

The release workflow requires a GitHub Actions repository secret named `NPM_TOKEN`. Use a publish-capable npm token scoped as narrowly as the npm account and package support. Never put the token in workflow YAML, repository files, command output, or issue comments.

Set it interactively with the authenticated GitHub CLI:

```bash
gh secret set NPM_TOKEN
gh secret list --app actions
```

The second command should list `NPM_TOKEN`; it cannot reveal the stored value. Rotate the secret when the npm credential changes or is revoked.

## Main-Branch CI Procedure

1. Push the reviewed commit to `main` or merge a pull request.
2. Locate the run:

   ```bash
   gh run list --workflow CI --limit 5
   ```

3. Watch it to a terminal result:

   ```bash
   gh run watch RUN_ID --exit-status
   ```

4. If it fails, inspect only the failed logs first:

   ```bash
   gh run view RUN_ID --log-failed
   ```

Do not create a release tag until the corresponding `main` CI run is green.

## npm Release Procedure

1. Update `package.json` to the intended version and update the English and Simplified Chinese changelogs.
2. Run the complete local release gate and inspect the dry-run package contents.
3. Commit and push the release preparation to `main`.
4. Wait for the `CI` run for that exact commit to pass.
5. Read the version:

   ```bash
   node -p "require('./package.json').version"
   ```

6. Create and push an annotated tag with exactly the same version. Replace the example with the version printed above:

   ```bash
   git tag -a v2.0.2 -m "Release v2.0.2"
   git push origin v2.0.2
   ```

7. Watch `Release package` and verify the registry after it succeeds:

   ```bash
   gh run list --workflow "Release package" --limit 5
   npm view expo-lite-data-store version
   ```

The release workflow refuses to publish when:

- the tag is not exactly `v` plus the `package.json` version;
- the tagged commit is not contained in `origin/main`;
- `NPM_TOKEN` is missing;
- the release gate, package inspection, or npm publication fails.

The workflow does not change package versions, create commits, create tags, or create GitHub Releases.

## Failure Triage

| Symptom                                | Check                                                                                                | Safe response                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| No `CI` run after a push               | Confirm the commit reached `main` and `.github/workflows/ci.yml` exists on the remote default branch | Push the intended commit or inspect repository Actions policy                      |
| Release does not start                 | Confirm the tag was pushed and matches `vX.Y.Z` or `vX.Y.Z-prerelease`                               | Push the correct tag only after main CI passes                                     |
| Tag/version check fails                | Compare `GITHUB_REF_NAME` with `package.json`                                                        | Prepare a new correct version/tag; do not publish mismatched source                |
| Main-ancestry check fails              | Confirm the tagged commit is contained in `origin/main`                                              | Merge or push the release commit to `main`, then prepare the correct immutable tag |
| Authentication check fails             | Run `gh secret list --app actions` and confirm `NPM_TOKEN` exists                                    | Set or rotate the secret; never print it                                           |
| npm reports the version already exists | Run `npm view expo-lite-data-store versions --json`                                                  | Increment the version and create a new tag; npm versions are immutable             |
| Expo consumer smoke fails              | Read the failing install, `expo-doctor`, or Metro phase in the run log                               | Reproduce with `npm run smoke:expo-consumer` before changing the workflow          |

After correcting an external credential or transient runner failure, rerun only the failed jobs:

```bash
gh run rerun RUN_ID --failed
```

Published npm versions and release tags are immutable release records. Do not move or reuse a published tag; roll forward with a new version.

## Security and Maintenance Rules

- Keep third-party Actions pinned to reviewed commit SHAs.
- Keep default permissions read-only and grant `id-token: write` only to the publishing job.
- Do not add `pull_request_target` to a workflow that executes repository code.
- Do not bypass `prepublishOnly` to make a failing release green.
- Keep this guide, both workflow files, `package.json` scripts, and both changelogs aligned when release behavior changes.
