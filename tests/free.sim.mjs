// Simulated games for free: matches played out by bots, random or scripted players, and the master's timing.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
// The house rule `free`: with two games or more, a box may be written in any column, and the match
// runs 13 rounds per column in one go.

import { test } from 'node:test';
import { BOXES, act, choices, createGame, isFree, judgeAll, options, roundsOf, suggest, writable } from '../server/rules.mjs';
import { LEVELS, botMove } from '../server/bots.mjs';
import { mergeSettings } from '../server/rooms.mjs';
import { assert, seeded, throws } from './helpers.mjs';

/** A randomInt that returns these faces in order (as 0..5). @param {...number} list */
function faces(...list) {
  let i = 0;
  return () => list[i++ % list.length] - 1;
}

/** Every box of a column but `open`, filled with 1. @param {...string} open */
const allBut = (...open) => Object.fromEntries(BOXES.filter((b) => !open.includes(b)).map((b) => [b, 1]));

test('free: 13 rounds per column in one run, no new game between, every column full at the end', () => {
  const s = createGame({ players: 2, games: 2, rules: { free: true } });
  const random = seeded(7);
  let games = 0;
  let turns = 0;
  while (s.phase === 'turn') {
    const seat = s.turn;
    act(s, seat, { type: 'roll' }, { randomInt: random });
    const pick = choices(s, seat)[0];
    const events = act(s, seat, { type: 'score', box: pick.box, game: pick.game });
    games += events.filter((e) => e.type === 'game').length;
    turns++;
  }
  assert.equal(turns, 2 * 26);
  assert.equal(games, 0);
  assert.equal(s.round, 26);
  for (const seat of [0, 1]) for (const column of s.boxes[seat]) assert.equal(Object.keys(column).length, 13);
});

test('free: every rank plays a whole three-game match to full columns, writing in more than one', () => {
  for (const level of LEVELS) {
    const s = createGame({ players: 2, games: 3, rules: { free: true } });
    const random = seeded(11);
    const used = new Set();
    let turns = 0;
    while (s.phase === 'turn') {
      const seat = s.turn;
      const move = /** @type {import('../server/bots.mjs').Move} */ (botMove(s, seat, { level }));
      if (move.type === 'score') used.add(move.game);
      act(s, seat, move, { randomInt: random });
      assert.ok(++turns < 2 * 39 * 4, level);
    }
    for (const seat of [0, 1]) for (const column of s.boxes[seat]) assert.equal(Object.keys(column).length, 13, level);
    assert.ok(used.size > 1, `${level} wrote in one column only`);
  }
});
