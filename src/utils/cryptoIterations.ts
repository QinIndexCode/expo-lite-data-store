/**
 * Bounds PBKDF2 work factors supplied through runtime configuration.
 * Keeping this policy shared prevents configuration mistakes from turning
 * encryption and decryption into unbounded CPU work.
 *
 * Threat model note: decryption intentionally honors the iteration count stored
 * inside each payload (clamped to [minimum, MAX_PBKDF2_ITERATIONS]) because the
 * encryption key can only be re-derived with the exact encrypt-time work
 * factor. As a consequence, a crafted payload with `iterations` near the
 * 1M cap forces up to ~1M PBKDF2 rounds on the decrypting device. Callers must
 * therefore only decrypt payloads the app itself wrote (or otherwise trusts)
 * and must apply their own rate limiting before decrypting externally supplied
 * data. Lowering the bound here is not a safe mitigation: it would break
 * decryption of legitimately encrypted payloads instead of failing closed.
 */
export const MAX_PBKDF2_ITERATIONS = 1_000_000;

export const normalizePbkdf2Iterations = (value: unknown, minimum: number): number => {
  const safeMinimum = Math.max(1, Math.trunc(minimum));
  const requested = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : safeMinimum;

  return Math.max(safeMinimum, Math.min(requested, MAX_PBKDF2_ITERATIONS));
};
