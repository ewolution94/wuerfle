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

/** A solo game where the seat is to move after `roll` rolls showing `dice`, with `filled` written. */
function after(dice, roll = 1, filled = {}, variant = 'meister') {
  const s = createGame({ players: 1, games: 1, rules: { variant } });
  Object.assign(s.boxes[0][0], filled);
  s.dice = [...dice];
  s.roll = roll;
  return s;
}

test('the master\'s tables: every multiset of up to five dice, odds that add up', () => {
  const { SETS, FIVES, SUBS, START, P } = _tables;
  assert.equal(SETS.length, 462);
  assert.equal(FIVES.length, 252);
  for (let K = 0; K < SETS.length; K++) {
    let sum = 0;
    for (let j = START[K]; j < START[K + 1]; j++) sum += P[j];
    assert.ok(Math.abs(sum - 1) < 1e-12, `odds from ${SETS[K]}`);
  }
  const five = (/** @type {number[]} */ c) => FIVES.find((i) => SETS[i].every((k, f) => k === c[f]));
  assert.equal(SUBS[/** @type {number} */ (five([1, 1, 1, 1, 1, 0]))].length, 32);
  assert.equal(SUBS[/** @type {number} */ (five([0, 0, 0, 0, 0, 5]))].length, 6);
  assert.equal(SUBS[/** @type {number} */ (five([2, 0, 3, 0, 0, 0]))].length, 12);
});

test('made hands: every rank writes five alike and a large straight at once', () => {
  for (const level of LEVELS) {
    assert.deepEqual(botMove(after([4, 4, 4, 4, 4]), 0, { level }), { type: 'score', box: 'wuerfle', game: 0 }, level);
    assert.deepEqual(botMove(after([3, 1, 2, 5, 4]), 0, { level }), { type: 'score', box: 'large', game: 0 }, level);
    // The joker leaves one box: the matching upper one.
    assert.deepEqual(botMove(after([2, 2, 2, 2, 2], 1, { wuerfle: 50 }, 'joker'), 0, { level }), { type: 'score', box: 'twos', game: 0 }, level);
  }
});

test('the apprentice keeps the most common face, and four in a row; writes the most points now', () => {
  const level = 'apprentice';
  assert.deepEqual(botMove(after([2, 5, 5, 3, 1]), 0, { level }), { type: 'roll', keep: [false, true, true, false, false] });
  // A tie goes to the higher face.
  assert.deepEqual(botMove(after([2, 2, 6, 6, 1]), 0, { level }), { type: 'roll', keep: [false, false, true, true, false] });
  assert.deepEqual(botMove(after([6, 2, 3, 4, 1], 1, { small: 30 }), 0, { level }), { type: 'roll', keep: [false, true, true, true, true] });
  assert.deepEqual(botMove(after([6, 6, 6, 5, 1], 3), 0, { level }), { type: 'score', box: 'three', game: 0 });
  // Nothing scores: it crosses out the cheapest box (Threes, at most 15, before Fours and the rest).
  const filled = { ones: 1, twos: 4, fives: 5, sixes: 6, chance: 20, small: 30, wuerfle: 0 };
  assert.deepEqual(botMove(after([1, 2, 2, 5, 6], 3, filled), 0, { level }), { type: 'score', box: 'threes', game: 0 });
});

test('the journeyman builds on three alike, a run of four, two pairs', () => {
  const level = 'journeyman';
  assert.deepEqual(botMove(after([6, 6, 2, 6, 3]), 0, { level }), { type: 'roll', keep: [true, true, false, true, false] });
  assert.deepEqual(botMove(after([1, 2, 3, 4, 6]), 0, { level }), { type: 'roll', keep: [true, true, true, true, false] });
  assert.deepEqual(botMove(after([2, 2, 5, 5, 1]), 0, { level }), { type: 'roll', keep: [true, true, true, true, false] });
  // A full house it needs is written at once.
  assert.deepEqual(botMove(after([3, 5, 3, 5, 3]), 0, { level }), { type: 'score', box: 'full', game: 0 });
});

test('every rank minds the basic rule: no crossing out while the roll fits', () => {
  // Chance open: every roll fits it, so nothing may be crossed out.
  const filled = { ones: 2, twos: 4, threes: 6, fours: 8, fives: 10, sixes: 12, three: 20, four: 0, full: 25, small: 30, wuerfle: 0 };
  for (const level of LEVELS) {
    const box = /** @type {{ box: string }} */ (botMove(after([1, 1, 3, 3, 6], 3, filled, 'basis'), 0, { level })).box;
    assert.equal(box, 'chance', level);
  }
});
