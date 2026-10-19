// Shared by the tests: a seeded random and error matching.

import assert from 'node:assert/strict';
import { RuleError } from '../server/rules.mjs';

/** mulberry32: a repeatable random integer below n. */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/** Asserts that fn throws a RuleError with this code. */
export const throws = (fn, code) => assert.throws(fn, (e) => e instanceof RuleError && e.code === code, code);

export { assert };
