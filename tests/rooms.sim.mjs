// Simulated games for rooms: matches played out by bots, random or scripted players, and the master's timing.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MS, cleanFling, DEFAULT_SETTINGS, GameError, KEEP_SHOW, mergeSettings, MOVE_SECONDS, THROW_SHOW } from '../server/rooms.mjs';
import { botMove } from '../server/bots.mjs';
import { RULES } from '../server/rules.mjs';
import { setup, table, watch } from './room-helpers.mjs';

const refused = (fn, code) => assert.throws(fn, (e) => e instanceof GameError && e.code === code, code);

/** Runs the clock until the match is over (or gives up). */
function playOut(clock, page, maxMs = 6 * 60 * 60_000) {
  for (let t = 0; t < maxMs && page.view.phase === 'play'; t += 1000) clock.advance(1000);
  return page.view;
}

/** A fling as a page sends it, for `n` thrown dice. */
const fling = (n) => ({ dice: Array.from({ length: n }, (_, i) => ({ p: [i - 2, 2.4, 1], q: [0, 0, 0, 1], v: [1, 2, -8], w: [5, -3, 9] })) });

/** Plays the seat in turn as a person would: the journeyman's move, a roll sent with a fling. */
function personMove(t, page, seatIndex) {
  const s = page.view.game.state;
  const move = botMove(s, s.turn, { level: 'journeyman' });
  const free = move.type === 'roll' ? (s.roll === 0 ? 5 : move.keep.filter((k) => !k).length) : 0;
  t.act(t.seats[seatIndex], 'move', { move, ...(move.type === 'roll' ? { fling: fling(free) } : {}) });
}

test('a whole match with bots and people: everyone writes 13 boxes per game, the totals add up', () => {
  const { rooms, clock } = setup(11);
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { games: 2 });
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'start');
  const page = t.pages[0];
  let moves = 0;
  while (page.view.phase === 'play' && moves < 5000) {
    const s = page.view.game.state;
    const seat = s.turn;
    if (seat <= 1) {
      personMove(t, page, seat);
      moves++;
    } else clock.advance(1000);
  }
  assert.equal(page.view.phase, 'final');
  const g = page.view.game;
  assert.equal(g.ended, 'done');
  for (let seat = 0; seat < 4; seat++) {
    for (let game = 0; game < 2; game++) assert.equal(Object.keys(g.state.boxes[seat][game]).length, 13, `seat ${seat}, game ${game}`);
    assert.equal(g.totals[seat].total, g.totals[seat].games.reduce((a, b) => a + b, 0));
  }
  assert.equal(g.standings[0].place, 1);
  assert.ok(g.standings[0].total >= g.standings.at(-1).total);
});
