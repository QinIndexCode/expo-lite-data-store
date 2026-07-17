/**
 * Bounds PBKDF2 work factors supplied through runtime configuration.
 * Keeping this policy shared prevents configuration mistakes from turning
 * encryption and decryption into unbounded CPU work.
 */
export const MAX_PBKDF2_ITERATIONS = 1_000_000;

export const normalizePbkdf2Iterations = (value: unknown, minimum: number): number => {
  const safeMinimum = Math.max(1, Math.trunc(minimum));
  const requested = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : safeMinimum;

  return Math.max(safeMinimum, Math.min(requested, MAX_PBKDF2_ITERATIONS));
};
