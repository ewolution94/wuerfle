// Simulated games for bots: matches played out by bots, random or scripted players, and the master's timing.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
// Würfle's bots (server/bots.mjs): whole matches at every rank, under every variant, stay legal and
// add up after every move; the same state always gives the same move; each rank's habits show on
// hand-picked dice; the master decides within its budget; and on the same dice the ranks order
// themselves: master, journeyman, apprentice, a random player.

import { test } from 'node:test';
import { BOXES, UPPER, VARIANTS, act, createGame, entry, options, sheet, totals, view } from '../server/rules.mjs';
import { LEVELS, MASTER_MS, _tables, botMove, randomMove } from '../server/bots.mjs';
import { assert, seeded } from './helpers.mjs';

const now = () => performance.now();

/**
 * Checks what must hold after every move: each column's boxes are legal values, the sheets add up
 * (upper, bonus, lower, extra) and the totals are their sums.
 * @param {import('../server/rules.mjs').State} s
 */
function checkSums(s) {
  const all = totals(s);
  for (let seat = 0; seat < s.players; seat++) {
    let match = 0;
    for (let game = 0; game < s.games; game++) {
      const sh = sheet(s, seat, game);
      const column = s.boxes[seat][game];
      for (const b of Object.keys(column)) assert.ok(BOXES.includes(b) && Number.isInteger(column[b]) && column[b] >= 0, `${b} ${column[b]}`);
      const up = UPPER.reduce((n, b) => n + (column[b] ?? 0), 0);
      const sum = Object.values(column).reduce((a, b) => a + b, 0);
      assert.equal(sh.up, up);
      assert.equal(sh.bonus, up >= 63 ? 35 : UPPER.every((b) => b in column) ? 0 : null);
      assert.equal(sh.total, sum + (sh.bonus ?? 0) + s.extra[seat][game]);
      assert.equal(all[seat].games[game], sh.total);
      match += sh.total;
    }
    assert.equal(all[seat].total, match);
  }
}

/**
 * Plays a match to the end with `levelOf(seat)` at each seat ('random' too), checking every move:
 * a roll only while rolls are left, a box only from options(), its points and extra as the rules
 * give them, and the sums after each move. Returns how many moves it took.
 * @param {import('../server/rules.mjs').State} s
 * @param {(seat: number) => string} levelOf  @param {(n: number) => number} randomInt
 */
function playChecked(s, levelOf, randomInt) {
  let moves = 0;
  while (s.phase !== 'done') {
    assert.ok(moves++ < 200 * s.players * s.games, 'the match ends');
    const seat = s.turn;
    const level = levelOf(seat);
    const move = level === 'random' ? randomMove(s, seat, randomInt) : botMove(s, seat, { level });
    assert.ok(move, 'a move for the seat in turn');
    if (move.type === 'roll') {
      assert.ok(s.roll < 3, 'no fourth roll');
      assert.ok(Array.isArray(move.keep) && move.keep.length === 5);
      act(s, seat, move, { randomInt });
    } else {
      assert.equal(move.type, 'score');
      const opts = options(s, seat);
      assert.ok(move.box in opts, `${level} wrote ${move.box}, not in ${JSON.stringify(opts)} (${s.rules.variant}, ${s.dice})`);
      const { extra } = entry(s.rules, s.boxes[seat][s.game], s.dice);
      const game = s.game;
      const [ev] = act(s, seat, move, { randomInt });
      assert.deepEqual(ev, { type: 'score', seat, game, box: move.box, points: opts[move.box], extra });
    }
    checkSums(s);
  }
  for (let seat = 0; seat < s.players; seat++) for (let game = 0; game < s.games; game++) assert.equal(Object.keys(s.boxes[seat][game]).length, 13);
  return moves;
}

test('whole matches at every rank, under every variant: legal moves, 13 boxes a column, sums that add up', () => {
  const tables = [...LEVELS.map((level) => () => level), (/** @type {number} */ seat) => [...LEVELS, 'random'][seat % 4]];
  let matches = 0;
  for (const variant of VARIANTS) {
    for (let seed = 1; seed <= 4; seed++) {
      for (const players of [1, 2, 4]) {
        for (const games of [1, 3]) {
          for (const levelOf of tables) {
            const randomInt = seeded(seed * 1000 + players * 10 + games);
            const s = createGame({ players, games, rules: { variant }, first: seed % players });
            playChecked(s, levelOf, randomInt);
            matches += 1;
          }
        }
      }
    }
  }
  assert.equal(matches, 3 * 4 * 3 * 2 * 4);
});

test('a random player keeps to the rules too, under every variant', () => {
  for (const variant of VARIANTS) {
    for (let seed = 1; seed <= 20; seed++) playChecked(createGame({ players: 1, games: 1, rules: { variant } }), () => 'random', seeded(seed));
  }
});

test('the same state always gives the same move, from a copy too', () => {
  for (const level of LEVELS) {
    for (const variant of VARIANTS) {
      const randomInt = seeded(5);
      const s = createGame({ players: 2, games: 1, rules: { variant } });
      for (let k = 0; k < 120 && s.phase !== 'done'; k++) {
        const move = botMove(s, s.turn, { level });
        assert.deepEqual(botMove(s, s.turn, { level }), move);
        assert.deepEqual(botMove(view(s), s.turn, { level }), move);
        assert.deepEqual(botMove(structuredClone(s), s.turn, { level }), move);
        act(s, s.turn, /** @type {Record<string, any>} */ (move), { randomInt });
      }
    }
  }
  const s = createGame({ players: 2, games: 1 });
  assert.equal(botMove(s, 1), null);
  assert.deepEqual(botMove(s, 0), { type: 'roll', keep: [false, false, false, false, false] });
});


test(`the master decides within ${MASTER_MS} ms (the slowest of a few hundred decisions)`, () => {
  /** @type {number[]} */
  const times = [];
  for (let g = 0; g < 16; g++) {
    const randomInt = seeded(900 + g);
    const s = createGame({ players: 1, games: 1, rules: { variant: VARIANTS[g % 3] } });
    while (s.phase !== 'done') {
      const searching = s.roll === 1 || s.roll === 2;
      const t0 = now();
      const move = /** @type {Record<string, any>} */ (botMove(s, 0, { level: 'master' }));
      if (searching) times.push(now() - t0);
      act(s, 0, move, { randomInt });
    }
  }
  assert.ok(times.length >= 300, `${times.length} decisions`);
  const slowest = Math.max(...times);
  assert.ok(slowest < MASTER_MS, `slowest ${slowest.toFixed(1)} ms`);
});

/**
 * Average solo scores per rank over `n` games, every rank on the same dice: roll k of round r in
 * game g draws the same five faces for each, the dice not kept taking them in order.
 * @param {string} variant  @param {number} n
 */
function ladder(variant, n) {
  /** @type {Record<string, number>} */
  const sum = { random: 0, apprentice: 0, journeyman: 0, master: 0 };
  for (let g = 0; g < n; g++) {
    const r = seeded(4242 + g);
    const dice = Array.from({ length: 13 }, () => Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => r(6))));
    for (const rank of Object.keys(sum)) {
      const s = createGame({ players: 1, games: 1, rules: { variant } });
      /** @type {number[]} */
      let pool = [];
      let at = 0;
      const randomInt = () => pool[at++];
      const choose = seeded(g + 1);
      while (s.phase !== 'done') {
        const move = /** @type {Record<string, any>} */ (rank === 'random' ? randomMove(s, 0, choose) : botMove(s, 0, { level: rank }));
        if (move.type === 'roll') {
          pool = dice[s.round - 1][s.roll];
          at = 0;
        }
        act(s, 0, move, { randomInt });
      }
      sum[rank] += sheet(s, 0, 0).total;
    }
  }
  return Object.fromEntries(Object.entries(sum).map(([rank, total]) => [rank, total / n]));
}

for (const variant of VARIANTS) {
  test(`the ranks order themselves on the same dice (${variant}): master > journeyman > apprentice > random`, () => {
    const avg = ladder(variant, 250);
    const line = Object.entries(avg).map(([r, v]) => `${r} ${v.toFixed(1)}`).join(', ');
    assert.ok(avg.master > avg.journeyman + 5, line);
    assert.ok(avg.journeyman > avg.apprentice + 5, line);
    assert.ok(avg.apprentice > avg.random + 50, line);
  });
}
