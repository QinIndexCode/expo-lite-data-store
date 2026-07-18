import fs from 'fs';
import os from 'os';
import path from 'path';

const qa = require('../../../scripts/expo-runtime-qa.cjs') as {
  completeArtifactRun: (options: {
    artifactRun: unknown;
    status: 'completed' | 'failed';
    error?: Error | null;
  }) => string[];
  createBoundedTailFileWriter: (options: {
    filePath: string;
    maxBytes: number;
    flushBytes: number;
  }) => { write: (value: string) => void; close: () => void };
  parseArgs: (args: string[]) => { artifactsDir: string; usesDefaultArtifacts: boolean };
  pruneCompletedArtifactRuns: (options: { artifactsRoot: string; keep: number }) => string[];
  startArtifactRun: (options: { artifactsDir: string; usesDefaultArtifacts: boolean }) => unknown;
  trimTextToTail: (value: string, maxBytes: number) => string;
};

describe('expo runtime QA artifact hygiene', () => {
  const tempRoots: string[] = [];

  const createTempRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-lite-data-store-qa-artifacts-'));
    tempRoots.push(root);
    return root;
  };

  const createCompletedRun = (root: string, name: string) => {
    const runDir = path.join(root, name);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, '.complete'), '{"status":"completed"}\n', 'utf8');
    return runDir;
  };

  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('marks explicit artifact directories without enabling default retention', () => {
    const root = createTempRoot();
    const existingRuns = [
      createCompletedRun(root, '2026-07-01T00-00-00-000Z'),
      createCompletedRun(root, '2026-07-02T00-00-00-000Z'),
      createCompletedRun(root, '2026-07-03T00-00-00-000Z'),
      createCompletedRun(root, '2026-07-04T00-00-00-000Z'),
    ];
    const runDir = path.join(root, 'manual-run');
    const artifactRun = qa.startArtifactRun({
      artifactsDir: runDir,
      usesDefaultArtifacts: false,
    });

    expect(fs.existsSync(path.join(runDir, '.in-progress'))).toBe(true);
    expect(qa.completeArtifactRun({ artifactRun, status: 'completed' })).toEqual([]);
    expect(fs.existsSync(path.join(runDir, '.in-progress'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, '.complete'))).toBe(true);
    existingRuns.forEach(existingRun => expect(fs.existsSync(existingRun)).toBe(true));
  });

  it('keeps only the three newest safe completed timestamp runs', () => {
    const root = createTempRoot();
    const oldest = createCompletedRun(root, '2026-07-10T00-00-00-000Z');
    const retained = [
      createCompletedRun(root, '2026-07-11T00-00-00-000Z'),
      createCompletedRun(root, '2026-07-12T00-00-00-000Z'),
      createCompletedRun(root, '2026-07-13T00-00-00-000Z'),
    ];
    const incomplete = createCompletedRun(root, '2026-07-01T00-00-00-000Z');
    fs.writeFileSync(path.join(incomplete, '.in-progress'), 'running\n', 'utf8');
    const nonTimestamp = createCompletedRun(root, 'manual-run');

    const removed = qa.pruneCompletedArtifactRuns({ artifactsRoot: root, keep: 3 });

    expect(removed).toEqual([oldest]);
    expect(fs.existsSync(oldest)).toBe(false);
    retained.forEach(runDir => expect(fs.existsSync(runDir)).toBe(true));
    expect(fs.existsSync(incomplete)).toBe(true);
    expect(fs.existsSync(nonTimestamp)).toBe(true);
  });

  it('does not traverse a symlinked artifacts root during retention', () => {
    const targetRoot = createTempRoot();
    const linkParent = createTempRoot();
    const preservedRun = createCompletedRun(targetRoot, '2026-07-01T00-00-00-000Z');
    const linkedRoot = path.join(linkParent, 'linked-artifacts');

    try {
      fs.symlinkSync(targetRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    expect(qa.pruneCompletedArtifactRuns({ artifactsRoot: linkedRoot, keep: 0 })).toEqual([]);
    expect(fs.existsSync(preservedRun)).toBe(true);
  });

  it('treats an explicit artifacts directory as opt-out from automatic retention', () => {
    const root = createTempRoot();
    expect(qa.parseArgs([]).usesDefaultArtifacts).toBe(true);
    const options = qa.parseArgs([`--artifacts-dir=${root}`]);

    expect(options.artifactsDir).toBe(path.resolve(root));
    expect(options.usesDefaultArtifacts).toBe(false);
  });

  it('retains only the tail of stream output within the configured byte limit', () => {
    const root = createTempRoot();
    const outputFile = path.join(root, 'stream.log');
    const writer = qa.createBoundedTailFileWriter({
      filePath: outputFile,
      maxBytes: 16,
      flushBytes: 1,
    });

    writer.write('prefix-123456');
    writer.write('tail-abcdef');
    writer.close();

    const output = fs.readFileSync(outputFile, 'utf8');
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(16);
    expect(output).toBe('23456tail-abcdef');
    expect(qa.trimTextToTail('abcdef', 3)).toBe('def');
  });
});
