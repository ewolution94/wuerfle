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

test('free: off by default, and off with one game whatever the setting', () => {
  assert.equal(isFree(createGame({ players: 2, games: 3 })), false);
  assert.equal(isFree(createGame({ players: 2, games: 1, rules: { free: true } })), false);
  assert.equal(isFree(createGame({ players: 2, games: 2, rules: { free: true } })), true);
  assert.equal(roundsOf(createGame({ players: 1, games: 3 })), 13);
  assert.equal(roundsOf(createGame({ players: 1, games: 3, rules: { free: true } })), 39);
});

test('free: every column may be written after a roll, the one named', () => {
  const s = createGame({ players: 2, games: 3, rules: { free: true } });
  assert.deepEqual(writable(s, 0), []);
  act(s, 0, { type: 'roll' }, { randomInt: faces(6, 6, 6, 2, 2) });
  assert.deepEqual(writable(s, 0), [0, 1, 2]);
  assert.deepEqual(writable(s, 1), []);
  assert.equal(choices(s, 0).length, 39);
  assert.equal(options(s, 0, 2).full, 25);
  const [score] = act(s, 0, { type: 'score', box: 'full', game: 2 });
  assert.deepEqual(score, { type: 'score', seat: 0, game: 2, box: 'full', points: 25, extra: 0 });
  assert.equal(s.boxes[0][2].full, 25);
  assert.equal(s.boxes[0][0].full, undefined);
});

test('free: without a column, the first with the box open; a wrong column is refused', () => {
  const s = createGame({ players: 1, games: 2, rules: { free: true } });
  Object.assign(s.boxes[0][0], { chance: 20 });
  act(s, 0, { type: 'roll' }, { randomInt: faces(1, 2, 3, 4, 6) });
  throws(() => act(s, 0, { type: 'score', box: 'chance', game: 2 }), 'column');
  throws(() => act(s, 0, { type: 'score', box: 'chance', game: '1' }), 'column');
  throws(() => act(s, 0, { type: 'score', box: 'chance', game: 0 }), 'taken');
  assert.equal(act(s, 0, { type: 'score', box: 'chance' })[0].game, 1);
});

test('in order (the default), only the game\'s own column may be written', () => {
  const s = createGame({ players: 1, games: 2 });
  act(s, 0, { type: 'roll' }, { randomInt: faces(1, 2, 3, 4, 6) });
  assert.deepEqual(writable(s, 0), [0]);
  throws(() => act(s, 0, { type: 'score', box: 'chance', game: 1 }), 'column');
  assert.equal(act(s, 0, { type: 'score', box: 'chance' })[0].game, 0);
});

test('free with the basic rule: no crossing out while any column takes the dice', () => {
  const s = createGame({ players: 1, games: 2, rules: { variant: 'basis', free: true } });
  Object.assign(s.boxes[0][0], allBut('wuerfle'));
  Object.assign(s.boxes[0][1], allBut('sixes'));
  act(s, 0, { type: 'roll' }, { randomInt: faces(6, 2, 3, 4, 5) });
  assert.deepEqual(choices(s, 0), [{ game: 1, box: 'sixes', points: 6, extra: 0 }]);
  throws(() => act(s, 0, { type: 'score', box: 'wuerfle', game: 0 }), 'box');
  assert.deepEqual(suggest(s, 0), { game: 1, box: 'sixes' });
  assert.equal(judgeAll(s, 0)(s.dice)?.game, 1);
});

test('a room keeps the house rule as the host sets it', () => {
  const merged = mergeSettings({ games: 3, clock: 'off', bots: 'journeyman' }, { variant: 'meister', free: false }, { rules: { free: true } });
  assert.equal(merged.rules.free, true);
  assert.equal(merged.rules.variant, 'meister');
  const kept = mergeSettings(merged.settings, merged.rules, { rules: { free: 'yes' } });
  assert.equal(kept.rules.free, true);
});
