// The solo game's dice (server/fair.mjs): exactly uniform integers from 32-bit words. The server's
// dice come from node:crypto's randomInt; the statistics on both real sources are in dice.sim.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoWord, fairInt } from '../server/fair.mjs';

/** Seeded 32-bit words (xorshift32), so the statistics are the same on every run. */
function words(seed = 2463534242) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  };
}

test('every number owns the same count of words; the few past the limit are drawn again', () => {
  for (const n of [1, 2, 3, 5, 6, 7, 10, 52]) {
    const limit = Math.floor(2 ** 32 / n) * n;
    assert.equal(limit % n, 0);
    assert.ok(2 ** 32 - limit < n, 'fewer than n words are ever redrawn');
    const seq = (...ws) => () => ws.shift();
    assert.equal(fairInt(n, seq(limit - 1)), (limit - 1) % n, 'the last word kept');
    if (limit < 2 ** 32) assert.equal(fairInt(n, seq(limit, 2 ** 32 - 1, 4)), 4 % n, 'a word past the limit is drawn again');
  }
  assert.throws(() => fairInt(0, () => 0), RangeError);
  assert.throws(() => fairInt(2.5, () => 0), RangeError);
});

test('a die lands evenly on its six faces (chi-square on seeded words)', () => {
  const word = words(6);
  const count = new Array(6).fill(0);
  const rolls = 600_000;
  for (let i = 0; i < rolls; i++) count[fairInt(6, word)]++;
  const e = rolls / 6;
  const chi = count.reduce((s, c) => s + (c - e) ** 2 / e, 0);
  assert.ok(chi < 30, `chi-square ${chi.toFixed(1)} with 5 degrees of freedom`);
});

test('the crypto word is a 32-bit unsigned integer', () => {
  for (let i = 0; i < 100; i++) {
    const w = cryptoWord();
    assert.ok(Number.isInteger(w) && w >= 0 && w < 2 ** 32);
  }
});
