// Fair dice from 32-bit random words, for the page's solo games; the server rolls with node:crypto's
// randomInt, which works the same way. Scaling a word or taking it modulo n favours the low numbers by
// up to n in 2^32; instead a word at or past the last full multiple of n is drawn again, so each of
// the n numbers owns exactly the same number of words (for a die, 4 words in 2^32 are redrawn). No
// I/O: the page passes words from its crypto, the tests pass seeded ones. learnings/randomness.md in
// the workspace has the why.

/**
 * A random integer in 0..n-1, exactly uniform.
 * @param {number} n  @param {() => number} word  32-bit unsigned random words
 */
export function fairInt(n, word) {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError('fairInt needs an integer 1 ≤ n ≤ 2^32');
  const limit = Math.floor(0x100000000 / n) * n;
  let w = word() >>> 0;
  while (w >= limit) w = word() >>> 0;
  return w % n;
}

/** One 32-bit word from the platform's crypto (the browser's, or Node's global webcrypto). */
export function cryptoWord() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}
