import { hashBytesSync, hmacBytesSync, pbkdf2BytesSync, hkdfBytesSync } from '../../utils/cryptoPrimitives';
import { gcm } from '@noble/ciphers/aes';

/**
 * Stage-level breakdown benchmark for the pure-JS crypto path
 * (the exact implementation executed in Expo Go / Hermes where
 * no native crypto module is available).
 *
 * Mirrors the device-side `performance_crypto_stage_breakdown` QA case so
 * host Node/V8 numbers can be compared against Hermes numbers directly.
 *
 * Run with: npm run test:performance
 */

const MB = 1024 * 1024;
const SAMPLE_BYTES = 5 * MB;
const SAMPLE_RUNS = 3;

type StageSample = {
  label: string;
  samplesMs: number[];
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
  throughputMiBPerSec: number;
};

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const measureStage = (label: string, fn: () => Uint8Array | string, runs: number): StageSample => {
  const samplesMs: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const startedAt = Date.now();
    fn();
    samplesMs.push(Date.now() - startedAt);
  }
  const meanMs = samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length;
  const sample = {
    label,
    samplesMs,
    meanMs: Number(meanMs.toFixed(2)),
    medianMs: Number(median(samplesMs).toFixed(2)),
    p95Ms: Number(quantile(samplesMs, 0.95).toFixed(2)),
    maxMs: Math.max(...samplesMs),
    minMs: Math.min(...samplesMs),
    throughputMiBPerSec: Number((SAMPLE_BYTES / MB / (meanMs / 1000 || 1)).toFixed(2)),
  };
  console.log(
    `[stage] ${label}: mean=${sample.meanMs}ms median=${sample.medianMs}ms p95=${sample.p95Ms}ms ` +
      `min=${sample.minMs}ms max=${sample.maxMs}ms (${sample.throughputMiBPerSec} MiB/s)`
  );
  return sample;
};

const KEY = new Uint8Array(32).fill(0x7b);
const SALT = new Uint8Array(16).fill(0x3c);
const PLAIN_TEXT = {
  id: 'stage-breakdown',
  payload: 'x'.repeat(SAMPLE_BYTES),
};
const PLAIN_JSON = JSON.stringify(PLAIN_TEXT);
const PLAIN_BYTES = new TextEncoder().encode(PLAIN_JSON);
const NONCE = new Uint8Array(12).fill(0x5a);

describe('crypto stage breakdown (pure-JS fallback, mirrors Expo Go)', () => {
  it('derives AES keys with PBKDF2 at the Expo Go work factor (20k)', () => {
    const sample = measureStage('pbkdf2-sha256-20k', () => pbkdf2BytesSync('master-key', SALT, 20000, 32, 'sha256'), 3);
    expect(sample.samplesMs.length).toBe(3);
  });

  it('derives per-record keys with HKDF', () => {
    const ikm = new Uint8Array(32).fill(0x11);
    const salt = new Uint8Array(16).fill(0x22);
    const sample = measureStage('hkdf-sha256-dk32', () => hkdfBytesSync(ikm, salt, 32), SAMPLE_RUNS);
    expect(sample.samplesMs.length).toBe(SAMPLE_RUNS);
  });

  it('encrypts 5MB with AES-256-GCM (pure-JS noble)', () => {
    const sample = measureStage(
      'gcm-encrypt-5mb',
      () => {
        const cipher = gcm(KEY, NONCE);
        return cipher.encrypt(PLAIN_BYTES);
      },
      SAMPLE_RUNS
    );
    expect(sample.samplesMs.length).toBe(SAMPLE_RUNS);
  });

  it('decrypts 5MB with AES-256-GCM', () => {
    const cipher = gcm(KEY, NONCE);
    const ciphertext = cipher.encrypt(PLAIN_BYTES);
    const sample = measureStage(
      'gcm-decrypt-5mb',
      () => {
        const decipher = gcm(KEY, NONCE);
        return decipher.decrypt(ciphertext);
      },
      SAMPLE_RUNS
    );
    expect(sample.samplesMs.length).toBe(SAMPLE_RUNS);
  });

  it('hashes 5MB with SHA-256 (chunk integrity + record hash)', () => {
    const sample = measureStage('sha256-5mb', () => hashBytesSync(PLAIN_BYTES, 'SHA-256'), SAMPLE_RUNS);
    expect(sample.samplesMs.length).toBe(SAMPLE_RUNS);
  });

  it('computes HMAC-SHA256 over 5MB', () => {
    const sample = measureStage('hmac-sha256-5mb', () => hmacBytesSync(PLAIN_BYTES, KEY, 'SHA-256'), SAMPLE_RUNS);
    expect(sample.samplesMs.length).toBe(SAMPLE_RUNS);
  });

  it('serializes + encodes 5MB JSON payload', () => {
    const sample = measureStage(
      'json-stringify-5mb',
      () => {
        const json = JSON.stringify(PLAIN_TEXT);
        return new TextEncoder().encode(json);
      },
      SAMPLE_RUNS
    );
    expect(sample.samplesMs.length).toBe(SAMPLE_RUNS);
  });

  it('digests the full chunk write path (hash + encode + serialize)', () => {
    let lastHash: Uint8Array = new Uint8Array(0);
    const sample = measureStage(
      'chunk-write-digest-5mb',
      () => {
        const json = JSON.stringify(PLAIN_TEXT);
        const bytes = new TextEncoder().encode(json);
        lastHash = hashBytesSync(bytes, 'SHA-256');
        return lastHash;
      },
      SAMPLE_RUNS
    );
    expect(lastHash.length).toBe(32);
    expect(sample.samplesMs.length).toBe(SAMPLE_RUNS);
  });
});
