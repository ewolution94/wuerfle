// The dice on their real sources, a million each: the server's node:crypto randomInt, the solo game's
// fairInt on crypto words, and both through the rules' roll so every one of the five positions is
// checked. Stochastic, so local only (npm run test:sim, the workspace's CLAUDE.md): a fair source
// fails these 1-in-a-million bounds once in a million runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { cryptoWord, fairInt } from '../server/fair.mjs';
import { act, createGame } from '../server/rules.mjs';

/** The chi-square value df degrees of freedom stay under with probability 1 - 1e-6 (Wilson–Hilferty). */
function bound(df) {
  const z = 4.753;
  return df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3;
}
const chi = (count) => {
  const total = count.reduce((a, b) => a + b, 0);
  const e = total / count.length;
  return count.reduce((s, c) => s + (c - e) ** 2 / e, 0);
};

for (const [name, die] of [
  ['the server (node:crypto randomInt)', (n) => randomInt(n)],
  ['the solo game (fairInt on crypto words)', (n) => fairInt(n, cryptoWord)],
]) {
  test(`${name}: a million dice land evenly, on every position of a roll`, () => {
    const faces = new Array(6).fill(0);
    for (let i = 0; i < 1_000_000; i++) faces[die(6)]++;
    const c = chi(faces);
    console.log(`  ${name}: chi-square ${c.toFixed(1)} (bound ${bound(5).toFixed(1)}), faces ${faces.join(' ')}`);
    assert.ok(c < bound(5));

    // Through the rules: first rolls of fresh turns, each of the five dice counted by position.
    const byPos = Array.from({ length: 5 }, () => new Array(6).fill(0));
    for (let i = 0; i < 100_000; i++) {
      const state = createGame({ players: 1, games: 1 });
      const [event] = act(state, 0, { type: 'roll' }, { randomInt: die });
      event.dice.forEach((d, k) => byPos[k][d - 1]++);
    }
    byPos.forEach((count, k) => assert.ok(chi(count) < bound(5), `position ${k + 1}: chi-square ${chi(count).toFixed(1)}`));
  });
}
