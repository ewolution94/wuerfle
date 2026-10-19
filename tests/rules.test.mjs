// Würfle's rules (server/rules.mjs): every box's score, what each variant lets a seat write, a turn's
// rolls and every refusal, rounds and games with the first player turning, the bonus at 62 and 63,
// and the block's sums and standings.

import { test } from 'node:test';
import {
  BOXES, LOWER, MAX, RULES, UPPER, VARIANTS,
  act, cleanRules, createGame, entry, options, score, sheet, standings, suggest, totals, view,
} from '../server/rules.mjs';
import { assert, seeded, throws } from './helpers.mjs';

/** A randomInt that rolls these faces (1 to 6), in the order the dice are drawn. @param {number[]} list */
function faces(...list) {
  let i = 0;
  return () => {
    if (i >= list.length) throw new Error('out of faces');
    return list[i++] - 1;
  };
}

/**
 * A game where seat 0 is to write after one roll of `dice`, with `filled` already in its column.
 * @param {number[]} dice  @param {Record<string, number>} [filled]  @param {{ variant?: string, players?: number }} [o]
 */
function at(dice, filled = {}, { variant = 'meister', players = 1 } = {}) {
  const s = createGame({ players, games: 1, rules: { variant } });
  Object.assign(s.boxes[0][0], filled);
  s.dice = [...dice];
  s.roll = 1;
  return s;
}

/** Every open box of a column at the same points. @param {Record<string, number>} filled @param {number} points */
const allOpen = (filled, points) => Object.fromEntries(BOXES.filter((b) => !(b in filled)).map((b) => [b, points]));

// ---- the boxes ---------------------------------------------------------------------------------

test('the boxes, in the block\'s order, and their highest scores', () => {
  assert.deepEqual([...BOXES], ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'three', 'four', 'full', 'small', 'large', 'wuerfle', 'chance']);
  assert.deepEqual([...UPPER, ...LOWER], [...BOXES]);
  assert.deepEqual(BOXES.map((b) => MAX[b]), [5, 10, 15, 20, 25, 30, 30, 30, 25, 30, 40, 50, 30]);
});

test('score: every box over hand-picked dice', () => {
  // ones twos threes fours fives sixes | three four full small large wuerfle chance
  const cases = [
    [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 0, 0, 0, 0, 30, 40, 0, 15]], // a small straight inside a large one
    [[2, 3, 4, 5, 6], [0, 2, 3, 4, 5, 6, 0, 0, 0, 30, 40, 0, 20]],
    [[1, 2, 3, 4, 6], [1, 2, 3, 4, 0, 6, 0, 0, 0, 30, 0, 0, 16]],
    [[1, 2, 3, 5, 6], [1, 2, 3, 0, 5, 6, 0, 0, 0, 0, 0, 0, 17]], // a gap: no straight
    [[3, 4, 4, 5, 6], [0, 0, 3, 8, 5, 6, 0, 0, 0, 30, 0, 0, 22]], // a double inside the straight
    [[4, 1, 3, 2, 1], [2, 2, 3, 4, 0, 0, 0, 0, 0, 30, 0, 0, 11]], // in any order
    [[3, 4, 5, 6, 6], [0, 0, 3, 4, 5, 12, 0, 0, 0, 30, 0, 0, 24]],
    [[2, 3, 4, 6, 6], [0, 2, 3, 4, 0, 12, 0, 0, 0, 0, 0, 0, 21]],
    [[3, 3, 3, 5, 5], [0, 0, 9, 0, 10, 0, 19, 0, 25, 0, 0, 0, 19]], // Full House: 3 + 2
    [[5, 2, 5, 2, 5], [0, 4, 0, 0, 15, 0, 19, 0, 25, 0, 0, 0, 19]],
    [[6, 5, 6, 1, 6], [1, 0, 0, 0, 5, 18, 24, 0, 0, 0, 0, 0, 24]], // three alike: the sum of all five
    [[4, 4, 4, 4, 2], [0, 2, 0, 16, 0, 0, 18, 18, 0, 0, 0, 0, 18]], // four alike: three and four
    [[6, 6, 6, 6, 6], [0, 0, 0, 0, 0, 30, 30, 30, 0, 0, 0, 50, 30]], // five alike is no Full House
    [[1, 1, 1, 1, 1], [5, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 50, 5]],
    [[2, 2, 3, 3, 4], [0, 4, 6, 4, 0, 0, 0, 0, 0, 0, 0, 0, 14]], // two pairs: nothing below but Chance
  ];
  for (const [dice, want] of cases) assert.deepEqual(BOXES.map((b) => score(b, dice)), want, dice.join(' '));
  throws(() => score('kniffel', [1, 1, 1, 1, 1]), 'box');
  assert.throws(() => score('chance', [1, 2, 3]), TypeError);
  assert.throws(() => score('chance', [1, 2, 3, 4, 7]), TypeError);
});

// ---- rules and the match -----------------------------------------------------------------------

test('rules: the championship rule by default, known keys replaced, wrong values refused', () => {
  assert.deepEqual({ ...RULES }, { variant: 'meister' });
  assert.deepEqual(cleanRules(), RULES);
  assert.deepEqual(cleanRules(null), RULES);
  assert.deepEqual([...VARIANTS], ['meister', 'basis', 'joker']);
  for (const variant of VARIANTS) assert.equal(cleanRules({ variant }).variant, variant);
  assert.equal('other' in cleanRules({ other: 1 }), false);
  assert.ok(Object.isFrozen(cleanRules({ variant: 'joker' })));
  throws(() => cleanRules({ variant: 'kniffel' }), 'rules');
  throws(() => cleanRules({ variant: 2 }), 'rules');
  throws(() => cleanRules('joker'), 'rules');
});

test('createGame: 1 to 8 players, 1 to 6 games, the first player in range', () => {
  const s = createGame({ players: 3, games: 2, first: 2 });
  assert.equal(s.rules.variant, 'meister');
  assert.deepEqual(
    { game: s.game, round: s.round, turn: s.turn, first: s.first, roll: s.roll, phase: s.phase, last: s.last },
    { game: 0, round: 1, turn: 2, first: 2, roll: 0, phase: 'turn', last: null },
  );
  assert.deepEqual(s.dice, [0, 0, 0, 0, 0]);
  assert.deepEqual(s.held, [false, false, false, false, false]);
  assert.deepEqual(s.boxes, [[{}, {}], [{}, {}], [{}, {}]]);
  assert.deepEqual(s.extra, [[0, 0], [0, 0], [0, 0]]);
  assert.equal(createGame({ players: 1, games: 1 }).turn, 0);
  assert.equal(createGame({ players: 8, games: 6, rules: { variant: 'joker' } }).rules.variant, 'joker');
  for (const players of [0, 9, 2.5, '2', undefined]) throws(() => createGame({ players, games: 1 }), 'players');
  for (const games of [0, 7, 1.5, undefined]) throws(() => createGame({ players: 2, games }), 'games');
  for (const first of [-1, 3, 0.5]) throws(() => createGame({ players: 3, games: 1, first }), 'players');
  throws(() => createGame({ players: 2, games: 1, rules: { variant: 'yahtzee' } }), 'rules');
});

// ---- what may be written: the variants ---------------------------------------------------------

test('meister: any open box at any time, at what the dice show', () => {
  const opts = options(at([1, 2, 2, 4, 6]), 0);
  assert.equal(Object.keys(opts).length, 13);
  assert.deepEqual(opts, { ones: 1, twos: 4, threes: 0, fours: 4, fives: 0, sixes: 6, three: 0, four: 0, full: 0, small: 0, large: 0, wuerfle: 0, chance: 15 });
  // Five alike with Würfle open: just a roll (Würfle 50, Full House 0), no extra.
  const first = at([3, 3, 3, 3, 3]);
  assert.equal(options(first, 0).wuerfle, 50);
  assert.equal(options(first, 0).full, 0);
  assert.equal(entry(first.rules, first.boxes[0][0], first.dice).extra, 0);
});

test('meister: a further five-alike brings +50 and goes only where it fits', () => {
  const s = at([4, 4, 4, 4, 4], { wuerfle: 50 });
  assert.deepEqual(options(s, 0), { fours: 20, three: 20, four: 20, chance: 20 });
  throws(() => act(s, 0, { type: 'score', box: 'full' }), 'box');
  throws(() => act(s, 0, { type: 'score', box: 'large' }), 'box');
  const events = act(s, 0, { type: 'score', box: 'four' });
  assert.deepEqual(events[0], { type: 'score', seat: 0, game: 0, box: 'four', points: 20, extra: 50 });
  assert.equal(sheet(s, 0, 0).extra, 50);
  assert.deepEqual(s.last, { seat: 0, game: 0, box: 'four', points: 20, extra: 50 });
  // None of those open: any open box, crossed out.
  const full = { wuerfle: 50, fours: 12, three: 20, four: 20, chance: 20 };
  assert.deepEqual(options(at([4, 4, 4, 4, 4], full), 0), allOpen(full, 0));
  // Würfle crossed out: five alike is an ordinary roll, with no extra.
  const crossed = at([5, 5, 5, 5, 5], { wuerfle: 0 });
  assert.equal(Object.keys(options(crossed, 0)).length, 12);
  assert.equal(options(crossed, 0).full, 0);
  assert.equal(entry(crossed.rules, crossed.boxes[0][0], crossed.dice).extra, 0);
});

test('basis: no crossing out while the roll fits a box; crossing out once it fits none', () => {
  const b = { variant: 'basis' };
  assert.deepEqual(options(at([1, 2, 2, 4, 6], {}, b), 0), { ones: 1, twos: 4, fours: 4, sixes: 6, chance: 15 });
  throws(() => act(at([1, 2, 2, 4, 6], {}, b), 0, { type: 'score', box: 'large' }), 'box');
  // Fits only below.
  assert.deepEqual(options(at([2, 2, 2, 5, 5], { twos: 6, fives: 10, chance: 20 }, b), 0), { three: 16, full: 25 });
  // Fits nothing open (Chance taken): any open box, crossed out.
  const none = { ones: 3, twos: 6, fours: 12, sixes: 18, chance: 22 };
  assert.deepEqual(options(at([1, 2, 2, 4, 6], none, b), 0), allOpen(none, 0));
  // Würfle crossed out: five alike is an ordinary roll, so only what it fits.
  assert.deepEqual(options(at([3, 3, 3, 3, 3], { wuerfle: 0 }, b), 0), { threes: 15, three: 15, four: 15, chance: 15 });
});

test('basis: a further five-alike brings +50 and any open box at its highest value', () => {
  const filled = { wuerfle: 50, sixes: 18 };
  const s = at([2, 2, 2, 2, 2], filled, { variant: 'basis' });
  assert.deepEqual(options(s, 0), {
    ones: 5, twos: 10, threes: 15, fours: 20, fives: 25, three: 30, four: 30, full: 25, small: 30, large: 40, chance: 30,
  });
  assert.deepEqual(act(s, 0, { type: 'score', box: 'large' })[0], { type: 'score', seat: 0, game: 0, box: 'large', points: 40, extra: 50 });
});

test('joker: the upper box first, then any lower box at full value, then 0 above; +100 only after a 50', () => {
  const j = { variant: 'joker' };
  // Any box, any time.
  assert.equal(Object.keys(options(at([1, 2, 2, 4, 6], {}, j), 0)).length, 13);
  // Würfle open: an ordinary roll.
  assert.equal(options(at([5, 5, 5, 5, 5], {}, j), 0).wuerfle, 50);
  assert.equal(options(at([5, 5, 5, 5, 5], {}, j), 0).full, 0);
  // The matching upper box, when open, is the only one.
  const forced = at([5, 5, 5, 5, 5], { wuerfle: 50 }, j);
  assert.deepEqual(options(forced, 0), { fives: 25 });
  throws(() => act(forced, 0, { type: 'score', box: 'chance' }), 'box');
  assert.deepEqual(act(forced, 0, { type: 'score', box: 'fives' })[0], { type: 'score', seat: 0, game: 0, box: 'fives', points: 25, extra: 100 });
  // Upper box taken: any open lower box, Full House and the straights at full value.
  assert.deepEqual(options(at([5, 5, 5, 5, 5], { wuerfle: 50, fives: 15, small: 0 }, j), 0), { three: 25, four: 25, full: 25, large: 40, chance: 25 });
  // Every lower box taken too: 0 in an upper box.
  const below = { wuerfle: 50, fives: 15, three: 20, four: 0, full: 25, small: 30, large: 40, chance: 21 };
  assert.deepEqual(options(at([5, 5, 5, 5, 5], below, j), 0), { ones: 0, twos: 0, threes: 0, fours: 0, sixes: 0 });
  // Würfle crossed out: the joker still places it, but brings nothing extra.
  const crossed = at([5, 5, 5, 5, 5], { wuerfle: 0 }, j);
  assert.deepEqual(options(crossed, 0), { fives: 25 });
  assert.equal(act(crossed, 0, { type: 'score', box: 'fives' })[0].extra, 0);
  const lower = at([5, 5, 5, 5, 5], { wuerfle: 0, fives: 20 }, j);
  assert.equal(options(lower, 0).large, 40);
  assert.equal(entry(lower.rules, lower.boxes[0][0], lower.dice).extra, 0);
});

test('options: nothing before a roll, for another seat, or after the match', () => {
  const s = createGame({ players: 2, games: 1 });
  assert.deepEqual(options(s, 0), {});
  act(s, 0, { type: 'roll' }, { randomInt: faces(1, 2, 3, 4, 5) });
  assert.equal(Object.keys(options(s, 0)).length, 13);
  assert.deepEqual(options(s, 1), {});
  assert.equal(suggest(s, 1), null);
  assert.ok(suggest(s, 0) in options(s, 0));
  assert.equal(suggest(s, 0), 'large');
});

// ---- a turn -----------------------------------------------------------------------------------

test('rolls: the first rolls all five, kept dice stay, the others drawn left to right', () => {
  const s = createGame({ players: 1, games: 1 });
  const keepAll = [true, true, true, true, true];
  // The first roll ignores keep.
  assert.deepEqual(act(s, 0, { type: 'roll', keep: keepAll }, { randomInt: faces(6, 2, 2, 5, 1) }), [
    { type: 'roll', seat: 0, roll: 1, dice: [6, 2, 2, 5, 1], held: [false, false, false, false, false] },
  ]);
  // Kept dice keep their faces; the free ones take the draws in order, left to right.
  const keep = [false, true, true, false, false];
  assert.deepEqual(act(s, 0, { type: 'roll', keep }, { randomInt: faces(3, 4, 6) }), [
    { type: 'roll', seat: 0, roll: 2, dice: [3, 2, 2, 4, 6], held: keep },
  ]);
  assert.deepEqual(s.held, keep);
  // A kept die may go back in: keeps are chosen anew before each roll. No keep: all five roll.
  assert.deepEqual(act(s, 0, { type: 'roll', keep: [true, false, false, false, true] }, { randomInt: faces(2, 2, 1) }), [
    { type: 'roll', seat: 0, roll: 3, dice: [3, 2, 2, 1, 6], held: [true, false, false, false, true] },
  ]);
  throws(() => act(s, 0, { type: 'roll' }, { randomInt: faces(1, 1, 1, 1, 1) }), 'rolls');
  act(s, 0, { type: 'score', box: 'chance' });
  assert.deepEqual({ roll: s.roll, dice: s.dice, held: s.held }, { roll: 0, dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false] });
  act(s, 0, { type: 'roll' }, { randomInt: faces(1, 2, 3, 4, 5) });
  act(s, 0, { type: 'roll', keep: null }, { randomInt: faces(6, 6, 6, 6, 6) });
  assert.deepEqual(s.dice, [6, 6, 6, 6, 6]);
  assert.throws(() => act(createGame({ players: 1, games: 1 }), 0, { type: 'roll' }), TypeError);
});

test('every refusal has its code', () => {
  const s = createGame({ players: 2, games: 1 });
  const randomInt = seeded(3);
  throws(() => act(s, 0, { type: 'score', box: 'chance' }), 'unrolled');
  throws(() => act(s, 1, { type: 'roll' }, { randomInt }), 'turn');
  throws(() => act(s, 0, null, { randomInt }), 'move');
  throws(() => act(s, 0, { type: 'hold' }, { randomInt }), 'move');
  act(s, 0, { type: 'roll' }, { randomInt });
  for (const keep of [[true], [1, 0, 0, 0, 0], 'all', [true, true, true, true, true, true]]) {
    throws(() => act(s, 0, { type: 'roll', keep }, { randomInt }), 'move');
  }
  throws(() => act(s, 0, { type: 'score', box: 'kniffel' }), 'box');
  throws(() => act(s, 0, { type: 'score' }), 'box');
  act(s, 0, { type: 'score', box: 'chance' });
  throws(() => act(s, 0, { type: 'roll' }, { randomInt }), 'turn');
  act(s, 1, { type: 'roll' }, { randomInt });
  act(s, 1, { type: 'score', box: 'chance' });
  act(s, 0, { type: 'roll' }, { randomInt });
  throws(() => act(s, 0, { type: 'score', box: 'chance' }), 'taken');
  // The rest of the match, then nothing more.
  while (s.phase !== 'done') {
    if (s.roll === 0) act(s, s.turn, { type: 'roll' }, { randomInt });
    act(s, s.turn, { type: 'score', box: Object.keys(options(s, s.turn))[0] });
  }
  assert.deepEqual(options(s, s.turn), {});
  throws(() => act(s, s.turn, { type: 'roll' }, { randomInt }), 'done');
  throws(() => act(s, 0, { type: 'score', box: 'ones' }), 'done');
});

test('turns go round in seat order; rounds, then games, each game one seat further on', () => {
  const s = createGame({ players: 3, games: 2, first: 1 });
  const randomInt = seeded(7);
  /** @type {number[]} */
  const order = [];
  /** @type {Record<string, unknown>[]} */
  const news = [];
  while (s.phase !== 'done') {
    const seat = s.turn;
    order.push(seat);
    act(s, seat, { type: 'roll' }, { randomInt });
    const box = Object.keys(options(s, seat))[0];
    const events = act(s, seat, { type: 'score', box });
    news.push(...events.slice(1));
  }
  assert.equal(order.length, 3 * 13 * 2);
  assert.deepEqual(order.slice(0, 6), [1, 2, 0, 1, 2, 0]);
  assert.deepEqual(order.slice(39, 45), [2, 0, 1, 2, 0, 1]);
  const rounds = news.filter((e) => e.type === 'round');
  assert.equal(rounds.length, 2 * 12);
  assert.deepEqual(rounds.slice(0, 2), [{ type: 'round', game: 0, round: 2 }, { type: 'round', game: 0, round: 3 }]);
  assert.deepEqual(rounds[12], { type: 'round', game: 1, round: 2 });
  assert.deepEqual(news.filter((e) => e.type === 'game'), [{ type: 'game', game: 1 }]);
  assert.deepEqual(news[news.length - 1], { type: 'done' });
  assert.equal(news.findIndex((e) => e.type === 'game'), 12);
  assert.equal(s.first, 2);
  assert.equal(s.game, 1);
  assert.equal(s.round, 13);
  for (const seat of [0, 1, 2]) for (const game of [0, 1]) assert.equal(Object.keys(s.boxes[seat][game]).length, 13);
});

test('the first player turns every game, past the last seat', () => {
  const s = createGame({ players: 2, games: 3, first: 1 });
  const randomInt = seeded(11);
  /** @type {number[]} */
  const firsts = [];
  while (s.phase !== 'done') {
    if (s.round === 1 && s.turn === s.first && s.roll === 0 && !Object.keys(s.boxes[s.turn][s.game]).length) firsts.push(s.first);
    act(s, s.turn, { type: 'roll' }, { randomInt });
    act(s, s.turn, { type: 'score', box: Object.keys(options(s, s.turn))[0] });
  }
  assert.deepEqual(firsts, [1, 0, 1]);
});

// ---- the block --------------------------------------------------------------------------------

test('the upper bonus: 35 at 63, nothing at 62, open while it can still come', () => {
  const s = createGame({ players: 1, games: 1 });
  const column = s.boxes[0][0];
  Object.assign(column, { threes: 9, fours: 12, fives: 15, sixes: 18, twos: 6 });
  assert.equal(sheet(s, 0).bonus, null);
  column.ones = 2;
  assert.deepEqual(sheet(s, 0), { boxes: { ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 }, up: 62, bonus: 0, top: 62, low: 0, extra: 0, total: 62 });
  column.ones = 3;
  assert.deepEqual({ ...sheet(s, 0), boxes: null }, { boxes: null, up: 63, bonus: 35, top: 98, low: 0, extra: 0, total: 98 });
  // Known before the upper boxes are all filled.
  const early = createGame({ players: 1, games: 1 });
  Object.assign(early.boxes[0][0], { sixes: 30, fives: 25, fours: 8, chance: 22, wuerfle: 50 });
  early.extra[0][0] = 50;
  assert.deepEqual({ ...sheet(early, 0), boxes: null }, { boxes: null, up: 63, bonus: 35, top: 98, low: 72, extra: 50, total: 220 });
});

test('totals and standings: per game and in all, equal totals share a place', () => {
  const s = createGame({ players: 4, games: 2 });
  const set = (/** @type {number} */ seat, /** @type {number} */ game, /** @type {Record<string, number>} */ boxes) => Object.assign(s.boxes[seat][game], boxes);
  set(0, 0, { chance: 30, large: 40, sixes: 30 }); // 100
  set(0, 1, { full: 25, small: 30 }); // 55
  set(1, 0, { chance: 25, three: 30 }); // 55
  set(1, 1, { large: 40, wuerfle: 50, chance: 10 }); // 100
  set(2, 0, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 }); // 63 + 35
  set(3, 1, { chance: 20 });
  s.extra[3][1] = 50; // 70
  assert.deepEqual(totals(s), [
    { games: [100, 55], total: 155 },
    { games: [55, 100], total: 155 },
    { games: [98, 0], total: 98 },
    { games: [0, 70], total: 70 },
  ]);
  assert.deepEqual(standings(s), [
    { seat: 0, total: 155, place: 1 },
    { seat: 1, total: 155, place: 1 },
    { seat: 2, total: 98, place: 3 },
    { seat: 3, total: 70, place: 4 },
  ]);
  assert.deepEqual(standings(createGame({ players: 3, games: 1 })).map((r) => r.place), [1, 1, 1]);
});

test('view: a JSON-safe copy, apart from the state', () => {
  const s = createGame({ players: 2, games: 1, rules: { variant: 'basis' } });
  act(s, 0, { type: 'roll' }, { randomInt: faces(1, 2, 3, 4, 5) });
  const v = view(s);
  assert.deepEqual(v, JSON.parse(JSON.stringify(s)));
  v.dice[0] = 6;
  v.boxes[0][0].chance = 1;
  assert.equal(s.dice[0], 1);
  assert.deepEqual(s.boxes[0][0], {});
});
