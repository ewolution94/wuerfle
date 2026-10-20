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

test('a room: the host makes it, others join by its code, everyone sees the same table', () => {
  const { rooms } = setup();
  const t = table(rooms, 2);
  assert.equal(t.pages[0].view.phase, 'lobby');
  assert.deepEqual(t.pages[0].view.settings, DEFAULT_SETTINGS);
  assert.deepEqual(t.pages[0].view.rules, RULES);
  assert.equal(t.pages[0].view.order.length, 3);
  assert.equal(t.pages[1].view.host, t.host.player);
  assert.deepEqual(rooms.info(t.code), { code: t.code, phase: 'lobby', players: 3, full: false });
  refused(() => rooms.join('ZZZZ', { name: 'X' }), 'no-room');
  refused(() => rooms.create({ name: '' }), 'name');
});

test('settings: the host picks the games (1 to 6), the rules, the clock and the bots; invalid values are ignored', () => {
  const merged = mergeSettings({ ...DEFAULT_SETTINGS }, { ...RULES }, { games: 6, clock: 'quick', bots: 'master', rules: { variant: 'joker' } });
  assert.deepEqual(merged.settings, { games: 6, clock: 'quick', bots: 'master' });
  assert.equal(merged.rules.variant, 'joker');
  const bad = mergeSettings({ ...DEFAULT_SETTINGS }, { ...RULES }, { games: 7, clock: 'slow', bots: 'grandmaster', rules: { variant: 'yahtzee' } });
  assert.deepEqual(bad.settings, DEFAULT_SETTINGS);
  assert.equal(bad.rules.variant, 'meister');
  assert.equal(mergeSettings(DEFAULT_SETTINGS, RULES, { games: 0 }).settings.games, 1);

  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { games: 3, rules: { variant: 'basis' } });
  assert.equal(t.pages[1].view.settings.games, 3);
  assert.equal(t.pages[1].view.rules.variant, 'basis');
  refused(() => t.act(t.seats[1], 'settings', { games: 2 }), 'not-host');
});

test('the order of play: the host moves people with their ids in a new order, or shuffles', () => {
  const { rooms } = setup();
  const t = table(rooms, 2);
  const order = t.pages[0].view.order;
  t.act(t.host, 'order', { order: [order[2], order[0], order[1]] });
  assert.deepEqual(t.pages[1].view.order, [order[2], order[0], order[1]]);
  refused(() => t.act(t.host, 'order', { order: [order[0], order[0], order[1]] }), 'order');
  refused(() => t.act(t.host, 'order', { order: [order[0], order[1]] }), 'order');
  refused(() => t.act(t.seats[1], 'order', { order }), 'not-host');
  t.act(t.host, 'start');
  assert.deepEqual(t.pages[0].view.game.seats, [order[2], order[0], order[1]], 'the match keeps the lobby order');
});

test('a throw: the server rolls, every page gets the numbers and where the dice left the thrower’s hand', () => {
  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  const g = () => t.pages[1].view.game;
  assert.equal(g().state.turn, 0);
  refused(() => t.act(t.seats[1], 'move', { move: { type: 'roll' } }), 'turn');
  t.act(t.host, 'move', { move: { type: 'roll' }, fling: fling(5) });
  assert.equal(g().throw.n, 1);
  assert.equal(g().throw.seat, 0);
  assert.equal(g().throw.roll, 1);
  assert.ok(g().throw.dice.every((v) => v >= 1 && v <= 6));
  assert.deepEqual(g().throw.dice, g().state.dice);
  assert.equal(g().throw.fling.dice.length, 5, 'the fling reaches the other page');
  assert.deepEqual(t.pages[0].view.game.throw, g().throw, 'the same throw on every page');

  // Keeping, live: the other page sees the dice go to the rail before the next throw.
  t.act(t.host, 'hold', { held: [true, true, false, false, false] });
  assert.deepEqual(g().hold, [true, true, false, false, false]);
  refused(() => t.act(t.seats[1], 'hold', { held: [true, false, false, false, false] }), 'turn');
  refused(() => t.act(t.host, 'hold', { held: [true] }), 'move');

  const kept = g().state.dice.slice(0, 2);
  t.act(t.host, 'move', { move: { type: 'roll', keep: [true, true, false, false, false] }, fling: fling(3) });
  assert.equal(g().throw.n, 2);
  assert.deepEqual(g().throw.dice.slice(0, 2), kept, 'kept dice keep their numbers');
  assert.equal(g().throw.fling.dice.length, 3);
  // A fling that doesn't fit the throw (the wrong count, out of range) is dropped; the throw still goes.
  t.act(t.host, 'move', { move: { type: 'roll', keep: [true, true, false, false, false] }, fling: fling(5) });
  assert.equal(g().throw.fling, null);
  refused(() => t.act(t.host, 'move', { move: { type: 'roll' } }), 'rolls');
  refused(() => t.act(t.host, 'hold', { held: [true, true, true, true, true] }), 'wrong-phase');

  const box = Object.keys(t.pages[0].view.game.state.boxes[0][0]).length;
  assert.equal(box, 0);
  t.act(t.host, 'move', { move: { type: 'score', box: 'chance' } });
  assert.equal(g().state.boxes[0][0].chance, g().throw.dice.reduce((a, b) => a + b, 0));
  assert.equal(g().state.turn, 1, 'the turn passes');
  assert.deepEqual(g().hold, [false, false, false, false, false], 'nothing kept at the next turn');
  assert.equal(g().totals[0].total, g().state.boxes[0][0].chance);
});

test('cleanFling keeps only well-formed numbers in range', () => {
  const held = [true, false, false, false, false];
  assert.equal(cleanFling(fling(4), held).dice.length, 4);
  assert.equal(cleanFling(fling(5), held), null, 'one die too many');
  assert.equal(cleanFling({ dice: [{ p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 999], w: [0, 0, 0] }, ...fling(3).dice] }, held), null, 'too fast');
  assert.equal(cleanFling({ dice: 'x' }, held), null);
  assert.equal(cleanFling(null, held), null);
  const odd = cleanFling({ dice: Array.from({ length: 4 }, () => ({ p: [1.23456, 2, 3], q: [0, 0, 0, 1], v: [1, 2, 3], w: [1, 2, 3] })) }, held);
  assert.equal(odd.dice[0].p[0], 1.235, 'rounded');
});

test('bots wait for the dice to land, and show their keeps before they throw the rest', () => {
  let checked = 0;
  for (let seed = 1; seed < 40 && checked < 3; seed++) {
    const { rooms, clock } = setup(seed);
    const t = table(rooms, 0);
    t.act(t.host, 'bot', { add: true });
    t.act(t.host, 'order', { order: [...t.pages[0].view.order].reverse() });
    t.act(t.host, 'start');
    const g = () => t.pages[0].view.game;
    assert.equal(g().state.turn, 0, 'the bot starts');
    clock.advance(1200);
    assert.equal(g().throw?.n, 1, 'the bot has thrown');
    clock.advance(THROW_SHOW - 200);
    assert.equal(g().throw.n, 1, 'nothing more before the dice have landed');
    // Step on until the bot's next decision: a keep shown on its own, then the throw that keeps them.
    let shown = null;
    for (let i = 0; i < 60 && g().throw.n === 1 && g().state.turn === 0; i++) {
      clock.advance(50);
      if (!shown && g().throw.n === 1 && g().hold.some(Boolean)) shown = { hold: [...g().hold], at: i };
    }
    if (!shown || g().throw.n !== 2) continue;
    checked++;
    assert.deepEqual(g().throw.held, shown.hold, 'the throw keeps what was shown');
    assert.ok(KEEP_SHOW >= 500);
  }
  assert.ok(checked >= 1, 'some seed had the bot keep dice and throw again');
});

test('the clock: when it runs out, a bot finishes the turn; playing yourself is refused meanwhile', () => {
  const { rooms, clock } = setup(3);
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { clock: 'quick' });
  t.act(t.host, 'start');
  const g = () => t.pages[1].view.game;
  assert.ok(g().endsAt > 0);
  clock.advance(MOVE_SECONDS.quick * 1000 + 400);
  assert.equal(g().autopilot, 0, 'the bot plays the host’s turn');
  refused(() => t.act(t.host, 'move', { move: { type: 'roll' } }), 'autopilot');
  for (let i = 0; i < 30 && g().state.turn === 0; i++) clock.advance(1000);
  assert.equal(g().state.turn, 1, 'the turn is over and passed on');
  assert.equal(g().autopilot, -1, 'the next turn is the next player’s own');
});

test('someone gone on their turn: after a while the bot plays it for them', () => {
  const { rooms, clock } = setup(9);
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  t.pages[0].close();
  clock.advance(AWAY_MS + 4000);
  assert.ok(t.pages[1].view.game.throw, 'the absent host’s turn was played');
});

test('stop and rematch: the host ends the match for everyone, then deals again or goes back to the lobby', () => {
  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  refused(() => t.act(t.seats[1], 'stop'), 'not-host');
  t.act(t.host, 'stop');
  assert.equal(t.pages[1].view.phase, 'final');
  assert.equal(t.pages[1].view.game.ended, 'stopped');
  t.act(t.host, 'rematch');
  assert.equal(t.pages[1].view.phase, 'play');
  assert.equal(t.pages[1].view.game.n, 2);
  t.act(t.host, 'stop');
  t.act(t.host, 'rematch', { lobby: true });
  assert.equal(t.pages[1].view.phase, 'lobby');
});

test('a watcher sees the match and has no seat', () => {
  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  const late = rooms.join(t.code, { name: 'Zoe' });
  const page = watch(rooms, t.code, late.player);
  assert.equal(page.view.game.seat, -1);
  refused(() => rooms.act(t.code, late.token, 'move', { move: { type: 'roll' } }), 'not-playing');
});
