import {
  hashBytesSync,
  hashHexSync,
  hmacBytesSync,
  pbkdf2BytesSync,
  hkdfBytesSync,
} from '../../utils/cryptoPrimitives';
import { hkdfSync } from 'node:crypto';

const nodeHkdf = (digest: string, ikm: Uint8Array, salt: Uint8Array, dkLen: number): Uint8Array =>
  Buffer.from(hkdfSync(digest, ikm, salt, Buffer.alloc(0), dkLen) as unknown as ArrayLike<number>);

/**
 * Benchmarks the pure-JS fallback layer (cryptoPrimitives) used when no native
 * crypto provider is available. This is the layer affected by the crypto-js ->
 * @noble/hashes migration, so results are comparable before and after.
 *
 * Run with: npm run test:performance (or jest --config jest.performance.config.cjs)
 * Heavy 600k-iteration cases only run under the performance config (120s timeout).
 */

const isPerformanceRun = process.argv.join(' ').includes('jest.performance.config.cjs');
const heavyIt = isPerformanceRun ? it : it.skip;

const benchMany = (name: string, fn: () => void, iterations: number): number => {
  fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const opsPerSec = iterations / (elapsedMs / 1000);
  console.log(
    `[bench] ${name}: ${elapsedMs.toFixed(1)}ms total / ${iterations} ops, ${opsPerSec.toFixed(0)} ops/s, ${(
      elapsedMs / iterations
    ).toFixed(4)} ms/op`
  );
  return elapsedMs;
};

const benchSingle = (name: string, fn: () => void): number => {
  fn();
  const start = process.hrtime.bigint();
  fn();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`[bench] ${name}: ${elapsedMs.toFixed(1)} ms/op`);
  return elapsedMs;
};

const KEY_64B = new Uint8Array(64).fill(0x5a);
const KEY_32B = KEY_64B.slice(0, 32);

const dataOf = (size: number): Uint8Array => {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    data[i] = i % 251;
  }
  return data;
};

const SMALL = dataOf(64);
const MEDIUM = dataOf(1024);
const LARGE = dataOf(100 * 1024);

describe('cryptoPrimitives fallback benchmark (migration baseline)', () => {
  it('hashes with SHA-256 and SHA-512 across input sizes', () => {
    expect(hashHexSync('abc', 'SHA-256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    benchMany('SHA-256 64B', () => hashBytesSync(SMALL, 'SHA-256'), 5000);
    benchMany('SHA-256 1KB', () => hashBytesSync(MEDIUM, 'SHA-256'), 1000);
    benchMany('SHA-256 100KB', () => hashBytesSync(LARGE, 'SHA-256'), 30);
    benchMany('SHA-512 64B', () => hashBytesSync(SMALL, 'SHA-512'), 5000);
    benchMany('SHA-512 1KB', () => hashBytesSync(MEDIUM, 'SHA-512'), 1000);
    benchMany('SHA-512 100KB', () => hashBytesSync(LARGE, 'SHA-512'), 30);
  });

  it('computes HMAC with SHA-256 and SHA-512', () => {
    expect(hmacBytesSync(SMALL, KEY_32B, 'SHA-256').length).toBe(32);
    expect(hmacBytesSync(SMALL, KEY_64B, 'SHA-512').length).toBe(64);
    benchMany('HMAC-SHA256 64B', () => hmacBytesSync(SMALL, KEY_32B, 'SHA-256'), 5000);
    benchMany('HMAC-SHA256 1KB', () => hmacBytesSync(MEDIUM, KEY_32B, 'SHA-256'), 1000);
    benchMany('HMAC-SHA512 64B', () => hmacBytesSync(SMALL, KEY_64B, 'SHA-512'), 5000);
    benchMany('HMAC-SHA512 1KB', () => hmacBytesSync(MEDIUM, KEY_64B, 'SHA-512'), 1000);
  });

  it('derives keys with HKDF matching node:crypto (RFC 5869-style, no info)', () => {
    const ikm = dataOf(80);
    const salt = dataOf(80);
    const expected = nodeHkdf('sha256', ikm, salt, 42);
    const okm = hkdfBytesSync(ikm, salt, 42);
    expect(Buffer.from(okm).equals(Buffer.from(expected))).toBe(true);
    benchMany('HKDF-SHA256 dkLen=32', () => hkdfBytesSync(KEY_32B, KEY_32B, 32), 1000);
    benchMany('HKDF-SHA256 dkLen=64', () => hkdfBytesSync(KEY_64B, KEY_32B, 64), 1000);
  });

  it('derives PBKDF2 keys at the configured work factors', () => {
    const salt = dataOf(16);
    expect(pbkdf2BytesSync('password', salt, 1, 64, 'sha256').length).toBe(64);

    benchSingle('PBKDF2-SHA256 10k iterations', () => pbkdf2BytesSync('password', salt, 10000, 64, 'sha256'));
    benchSingle('PBKDF2-SHA256 20k iterations', () => pbkdf2BytesSync('password', salt, 20000, 64, 'sha256'));
  });

  heavyIt('keeps the 600k PBKDF2 derivation within the benchmark window', () => {
    const salt = dataOf(16);
    const start = Date.now();
    const derived = pbkdf2BytesSync('password', salt, 600000, 64, 'sha256');
    const elapsedMs = Date.now() - start;
    console.log(`[bench] PBKDF2-SHA256 600k iterations: ${elapsedMs.toFixed(1)} ms/op`);
    expect(derived.length).toBe(64);
    expect(elapsedMs).toBeLessThan(60000);
  });
});
