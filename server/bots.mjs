// Würfle's bots, at a guild's three ranks (as in Stichle and Stammtisch):
//
//   apprentice  a beginner: keeps the most common face (a straight only when four in a row show),
//               writes the box with the most points now, with no thought for the bonus or what's
//               left, and crosses out the cheapest
//   journeyman  a solid player (the default): keeps by a plan (the face it still needs, a straight
//               from three or four in a row, two pairs for a full house), stops when the dice already
//               score well, and writes by judgement() in rules.mjs: the points now minus what the box
//               would likely bring later, minding the bonus. Chance is its safety net
//   master      expectimax over the rest of the turn: every keep against every way the dice can fall
//               (the 252 multisets of five, with their odds) through the rolls left, each leaf valued
//               by the journeyman's judgement; decided within MASTER_MS
//
// Every rank writes only what choices() allows (the basic rule's no crossing out, the joker rule),
// and under the house rule `free` it weighs every column it may write in. No randomness: the same
// state always gives the same move. Runs in the page too, for the solo game.

import { BOXES, MAX, UPPER, choices, counts, isFree, judgeAll } from './rules.mjs';

/** @typedef {import('./rules.mjs').State} State */
/** @typedef {{ type: 'roll', keep: boolean[] } | { type: 'score', box: string, game: number }} Move */

/** The ranks, weakest first. */
export const LEVELS = Object.freeze(['apprentice', 'journeyman', 'master']);

/**
 * A master's hard stop in wall-clock time (Stichle's, for the NAS's two slow cores). Its search takes
 * about a millisecond on a laptop; past the stop it plays the journeyman's keep instead.
 * WUERFLE_MASTER_MS overrides it.
 */
export const MASTER_MS = Number(globalThis.process?.env?.WUERFLE_MASTER_MS ?? 150);

const now = () => globalThis.performance?.now?.() ?? Date.now();
const NONE = Object.freeze([false, false, false, false, false]);

/**
 * The next move for `seat`, the seat in turn: a roll with what to keep, or the box to write. Null
 * when it isn't the seat's turn or the match is over. A level it doesn't know plays as a journeyman.
 * @param {State} state  @param {number} seat  @param {{ level?: string }} [o]
 * @returns {Move | null}
 */
export function botMove(state, seat, { level = 'journeyman' } = {}) {
  if (state.phase !== 'turn' || seat !== state.turn) return null;
  if (state.roll === 0) return { type: 'roll', keep: [...NONE] };
  if (level === 'apprentice') return apprentice(state, seat);
  if (level === 'master') return master(state, seat);
  return journeyman(state, seat);
}

/** @param {{ box: string, game: number }} where @returns {Move} */
const write = ({ box, game }) => ({ type: 'score', box, game });

/**
 * The boxes still open anywhere the seat may write: a column for plan() and the apprentice (under the
 * house rule a box counts as open while any column has it open).
 * @param {State} state  @param {number} seat
 * @returns {import('./rules.mjs').Column}
 */
function openBoxes(state, seat) {
  const columns = isFree(state) ? state.boxes[seat] : [state.boxes[seat][state.game]];
  /** @type {import('./rules.mjs').Column} */
  const out = {};
  for (const b of BOXES) if (columns.every((col) => col[b] !== undefined)) out[b] = /** @type {number} */ (columns[0][b]);
  return out;
}
/** @param {boolean[]} keep @returns {Move} */
const reroll = (keep) => ({ type: 'roll', keep });

/** Keeps the leftmost dice that make up `want` (counts per face). @param {number[]} dice @param {number[]} want */
function keepOf(dice, want) {
  const left = [...want];
  return dice.map((d) => {
    if (left[d - 1] <= 0) return false;
    left[d - 1] -= 1;
    return true;
  });
}

/** The longest run of consecutive faces showing: its first face and length. @param {number[]} c */
function runOf(c) {
  let best = { from: 0, len: 0 };
  for (let f = 1; f <= 6; f++) {
    let len = 0;
    while (f + len <= 6 && c[f + len - 1] > 0) len += 1;
    if (len > best.len) best = { from: f, len };
  }
  return best;
}

/** One die of each face in a run, as counts. @param {{ from: number, len: number }} run */
const runCounts = ({ from, len }) => [1, 2, 3, 4, 5, 6].map((f) => (f >= from && f < from + len ? 1 : 0));

// ---- apprentice -----------------------------------------------------------------------------------

/** @param {State} state @param {number} seat */
function apprentice(state, seat) {
  const opts = choices(state, seat);
  // A made hand is written at once.
  const made = opts.some((o) => (o.box === 'wuerfle' && o.points === 50) || (o.box === 'large' && o.points === 40) || (o.box === 'full' && o.points === 25) || (o.box === 'small' && o.points === 30));
  if (state.roll === 3 || made) return write(greedy(opts));
  const { c } = counts(state.dice);
  const column = openBoxes(state, seat);
  const run = runOf(c);
  if (run.len >= 4 && (column.small === undefined || column.large === undefined)) {
    return reroll(keepOf(state.dice, runCounts({ from: run.from, len: 4 })));
  }
  // The most common face, the higher one on a tie.
  let face = 6;
  for (let f = 5; f >= 1; f--) if (c[f - 1] > c[face - 1]) face = f;
  if (c[face - 1] === 5) return write(greedy(opts));
  return reroll(state.dice.map((d) => d === face));
}

/**
 * The box with the most points now (the first column on a tie); with nothing to score, the one with
 * the least to lose.
 * @param {{ game: number, box: string, points: number }[]} opts
 */
function greedy(opts) {
  let best = opts[0];
  for (const o of opts) {
    const max = MAX[/** @type {keyof typeof MAX} */ (o.box)];
    const was = MAX[/** @type {keyof typeof MAX} */ (best.box)];
    if (o.points > best.points || (o.points === 0 && best.points === 0 && max < was)) best = o;
  }
  return best;
}

// ---- journeyman -----------------------------------------------------------------------------------

/** Above this judgement the journeyman stops rolling, unless it holds three alike or more to build on. */
const ENOUGH = 15;

/** @param {State} state @param {number} seat */
function journeyman(state, seat) {
  const best = /** @type {NonNullable<ReturnType<ReturnType<typeof judgeAll>>>} */ (judgeAll(state, seat)(state.dice));
  if (state.roll === 3) return write(best);
  const keep = plan(openBoxes(state, seat), state.dice, best);
  // Keeping all five would only spend a roll.
  return keep && !keep.every(Boolean) ? reroll(keep) : write(best);
}

/**
 * What a solid player keeps for the next roll, or null to write `best` now.
 * @param {import('./rules.mjs').Column} column  @param {number[]} dice
 * @param {{ box: string, points: number, extra: number, value: number }} best
 * @returns {boolean[] | null}
 */
function plan(column, dice, best) {
  const open = (/** @type {string} */ b) => column[b] === undefined;
  const { c } = counts(dice);
  const most = Math.max(...c);
  // Made hands: a further five-alike's extra, five alike, a straight, a full house.
  if (best.extra > 0 || (most === 5 && best.points > 0)) return null;
  if (['wuerfle', 'large', 'full'].includes(best.box) && best.points > 0) return null;
  const run = runOf(c);
  if (best.box === 'small' && best.points > 0 && !(open('large') && run.len === 4)) return null;

  // The face to collect: the most of it, then one whose upper box is open, then the higher.
  const kinds = open('three') || open('four') || open('wuerfle');
  const useful = (/** @type {number} */ f) => open(UPPER[f - 1]) || kinds;
  let face = 0;
  for (let f = 6; f >= 1; f--) {
    if (!c[f - 1] || !useful(f)) continue;
    if (!face || c[f - 1] > c[face - 1] || (c[f - 1] === c[face - 1] && open(UPPER[f - 1]) && !open(UPPER[face - 1]))) face = f;
  }
  const n = face ? c[face - 1] : 0;
  const only = (/** @type {number} */ f) => c.map((k, i) => (i === f - 1 ? k : 0));

  if (n >= 3) return keepOf(dice, only(face));
  if (best.value >= ENOUGH) return null;
  const straights = open('small') || open('large');
  if (run.len >= 4 && straights) return keepOf(dice, runCounts({ from: run.from, len: Math.min(4, run.len) }));
  const pairs = c.filter((k) => k === 2).length;
  if (pairs === 2 && open('full')) return keepOf(dice, c.map((k) => (k === 2 ? 2 : 0)));
  // A pair is worth building on when it's high or its upper box still needs it.
  const goodPair = n === 2 && (face >= 4 || open(UPPER[face - 1]));
  if (run.len === 3 && open('small') && !goodPair) return keepOf(dice, runCounts(run));
  if (n === 2) return keepOf(dice, only(face));
  if (run.len === 3 && straights) return keepOf(dice, runCounts(run));
  // Nothing to build on: high dice for Chance, if it's open.
  if (open('chance')) return dice.map((d) => d >= 5);
  return [...NONE];
}

// ---- master ---------------------------------------------------------------------------------------
//
// Every multiset of 0 to 5 dice (462 of them, 252 of five), indexed once at load: for each kept
// multiset the fives one roll can make of it, with their odds, and for each five what can be kept.

/** @type {number[][]} */
const SETS = [];
(function all(c, f, left) {
  if (f === 6) return void SETS.push([...c]);
  for (let k = 0; k <= left; k++) {
    c[f] = k;
    all(c, f + 1, left - k);
  }
  c[f] = 0;
})([0, 0, 0, 0, 0, 0], 0, 5);
const keyOf = (/** @type {number[]} */ c) => c[0] + 6 * c[1] + 36 * c[2] + 216 * c[3] + 1296 * c[4] + 7776 * c[5];
const INDEX = new Int16Array(46656).fill(-1);
SETS.forEach((c, i) => (INDEX[keyOf(c)] = i));
const SIZE = SETS.map((c) => c.reduce((a, b) => a + b, 0));
const FACT = [1, 1, 2, 6, 24, 120];
/** The odds of rolling exactly this multiset with as many dice as it holds. */
const ODDS = SETS.map((c, i) => FACT[SIZE[i]] / c.reduce((a, k) => a * FACT[k], 1) / 6 ** SIZE[i]);
const FIVES = SETS.map((_, i) => i).filter((i) => SIZE[i] === 5);
/** A five's dice, low to high. */
const DICE = SETS.map((c) => c.flatMap((k, f) => Array(k).fill(f + 1)));

/** For kept multiset K: entries START[K] to START[K + 1] of TO (the five it becomes) and P (its odds). */
const START = new Int32Array(SETS.length + 1);
/** @type {number[]} */
const to = [];
/** @type {number[]} */
const p = [];
SETS.forEach((k, K) => {
  START[K] = to.length;
  SETS.forEach((o, O) => {
    if (SIZE[O] !== 5 - SIZE[K]) return;
    to.push(INDEX[keyOf(k.map((x, f) => x + o[f]))]);
    p.push(ODDS[O]);
  });
});
START[SETS.length] = to.length;
const TO = Int16Array.from(to);
const P = Float64Array.from(p);

/** For each five: the distinct multisets it can keep, the most dice first (ties keep more). */
const SUBS = SETS.map((c, i) => {
  if (SIZE[i] !== 5) return new Int16Array(0);
  /** @type {number[]} */
  const out = [];
  (function sub(k, f) {
    if (f === 6) return void out.push(INDEX[keyOf(k)]);
    for (let x = c[f]; x >= 0; x--) sub([...k, x], f + 1);
  })([], 0);
  return Int16Array.from(out.sort((a, b) => SIZE[b] - SIZE[a]));
});

/** What one roll from kept multiset K is worth on average, with `value` per five. @param {Float64Array} value @param {number} K */
function expect(value, K) {
  let sum = 0;
  for (let j = START[K]; j < START[K + 1]; j++) sum += P[j] * value[TO[j]];
  return sum;
}

/**
 * The turn's tables for one column (the same for both of a turn's decisions, so they're kept):
 * leaf, the judgement of each five; keep1, each kept multiset's worth with the last roll to come;
 * five1, each five's worth with one roll to come (the better of writing and its best keep).
 * @type {Map<string, { leaf: Float64Array, keep1: Float64Array, five1: Float64Array }>}
 */
const TABLES = new Map();

/** What a column's tables depend on: its open boxes, its upper sum up to 63, its Würfle. @param {import('./rules.mjs').Column} column */
function columnKey(column) {
  let up = 0;
  for (const b of UPPER) up += column[b] ?? 0;
  return `${BOXES.map((b) => (column[b] === undefined ? '-' : '+')).join('')}|${Math.min(up, 63)}|${column.wuerfle ?? '-'}`;
}

/**
 * @param {string} key  what the tables depend on (the variant and the columns)
 * @param {(dice: number[]) => { value: number } | null} judge  @param {number} until  the wall-clock stop
 */
function tablesFor(key, judge, until) {
  const hit = TABLES.get(key);
  if (hit) return hit;
  const leaf = new Float64Array(SETS.length);
  for (const i of FIVES) leaf[i] = /** @type {{ value: number }} */ (judge(DICE[i])).value;
  if (now() > until) return null;
  const keep1 = new Float64Array(SETS.length);
  for (let K = 0; K < SETS.length; K++) keep1[K] = expect(leaf, K);
  const five1 = new Float64Array(SETS.length);
  for (const i of FIVES) {
    let best = -Infinity;
    for (const K of SUBS[i]) if (keep1[K] > best) best = keep1[K];
    five1[i] = best;
  }
  const tables = { leaf, keep1, five1 };
  TABLES.set(key, tables);
  // A small cache: a game's columns change every turn.
  if (TABLES.size > 64) TABLES.delete(/** @type {string} */ (TABLES.keys().next().value));
  return tables;
}

/** @param {State} state @param {number} seat */
function master(state, seat) {
  const until = now() + MASTER_MS;
  const judge = judgeAll(state, seat);
  const best = /** @type {NonNullable<ReturnType<typeof judge>>} */ (judge(state.dice));
  if (state.roll === 3) return write(best);
  const columns = isFree(state) ? state.boxes[seat] : [state.boxes[seat][state.game]];
  const tables = tablesFor(`${state.rules.variant}|${isFree(state) ? 'free|' : ''}${columns.map(columnKey).join('/')}`, judge, until);
  if (!tables) return journeyman(state, seat);
  const { c } = counts(state.dice);
  const here = INDEX[keyOf(c)];
  // Writing now against every keep but all five (keeping all is never better than the best of them).
  let value = tables.leaf[here];
  let keep = -1;
  for (const K of SUBS[here]) {
    if (K === here) continue;
    const v = state.roll === 2 ? tables.keep1[K] : expect(tables.five1, K);
    if (v > value + 1e-9) {
      value = v;
      keep = K;
    }
  }
  return keep < 0 ? write(best) : reroll(keepOf(state.dice, SETS[keep]));
}

// ---- a random player, for scale ------------------------------------------------------------------

/**
 * A random legal move, for tools/ladder.mjs and the tests: rolls on with random keeps two times in
 * three, else writes a random allowed box.
 * @param {State} state  @param {number} seat  @param {(n: number) => number} randomInt
 * @returns {Move | null}
 */
export function randomMove(state, seat, randomInt) {
  if (state.phase !== 'turn' || seat !== state.turn) return null;
  if (state.roll === 0) return { type: 'roll', keep: [...NONE] };
  if (state.roll < 3 && randomInt(3) > 0) return reroll(NONE.map(() => randomInt(2) === 1));
  const allowed = choices(state, seat);
  return write(allowed[randomInt(allowed.length)]);
}

/** The master's multiset tables, for the tests. @internal */
export const _tables = { SETS, FIVES, SUBS, START, TO, P };
