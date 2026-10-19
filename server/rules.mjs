// Würfle's rules: the classic five-dice game (what Schmidt Spiele sells as Kniffel) as a pure state
// machine. 1 to 8 players at one table play a match of 1 to 6 games, as the paper block has six
// columns: game 1 in column 1, and so on; the match total is the sum of the games. A game is 13
// rounds, everyone once a round in seat order; each game starts one seat further on.
//
// A turn: up to three rolls of five dice. The first rolls all five; before the second and third the
// player keeps any dice (chosen anew each time, so a kept die may be rolled again later). After any
// roll they fill one open box of the game's column, and after the third they must.
//
// The variants (rules.variant), checked against Schmidt's 2024 leaflet and Hasbro's rules:
//   meister  Schmidt's "Meisterschaftsregel" (the default): any open box any time, at what the dice
//            show. A further five-alike (Würfle already 50) brings +50 and goes only where it fits:
//            its upper box, Dreier-, Viererpasch or Chance; never Full House or a straight.
//   basis    Schmidt's basic rule: a box may be crossed out only when the roll fits none (Chance
//            always fits while it's open). A further five-alike brings +50 and goes into any open
//            box at that box's highest value, whatever the dice show.
//   joker    Hasbro's Yahtzee: any open box any time. A further five-alike brings +100 when Würfle
//            holds 50 (nothing when it holds 0) and is placed by the joker rule: its upper box if
//            open, else any lower box at full value, else 0 in an upper box.
//
// Moves (plain JSON, from the page or a bot):
//   { type: 'roll', keep?: boolean[5] }  keep is ignored on a turn's first roll
//   { type: 'score', box }               one of BOXES, as options() allows
// act() returns events, all public: everything at this table is.
//
// No randomness of its own (the dice come from the caller's randomInt) and no I/O: the page runs
// this unchanged for the solo game, offline. judgement() and suggest() are the journeyman's sense of
// what a box is worth, here so the page's hint and server/bots.mjs share it.

export class RuleError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'RuleError';
    this.code = code;
  }
}

/** @typedef {'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes' | 'three' | 'four' | 'full' | 'small' | 'large' | 'wuerfle' | 'chance'} Box */

export const UPPER = Object.freeze(['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']);
export const LOWER = Object.freeze(['three', 'four', 'full', 'small', 'large', 'wuerfle', 'chance']);
export const BOXES = Object.freeze([...UPPER, ...LOWER]);
export const PLAYERS = Object.freeze({ min: 1, max: 8 });
export const GAMES = Object.freeze({ min: 1, max: 6 });
export const VARIANTS = Object.freeze(['meister', 'basis', 'joker']);
export const RULES = Object.freeze({ variant: 'meister' });

/** Each box's highest score (what Schmidt's basic rule gives a further five-alike). */
export const MAX = Object.freeze({
  ones: 5, twos: 10, threes: 15, fours: 20, fives: 25, sixes: 30,
  three: 30, four: 30, full: 25, small: 30, large: 40, wuerfle: 50, chance: 30,
});

/** The upper section's bonus, and what it takes: three of each face. */
export const BONUS = Object.freeze({ points: 35, at: 63 });

const ROUNDS = 13;
/** The face an upper box counts (1 to 6), 0 for a lower box. */
const FACE = Object.freeze(Object.fromEntries(BOXES.map((b) => [b, UPPER.indexOf(b) + 1])));

/**
 * The rules from a lobby's settings: the defaults, with every known key that's set replacing its
 * default (null: the defaults). Throws 'rules' for a wrong value; unknown keys are dropped.
 * @param {Record<string, unknown> | null} [input]
 */
export function cleanRules(input = {}) {
  if (input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new RuleError('rules');
  const out = { ...RULES };
  if (input.variant !== undefined) {
    if (!VARIANTS.includes(/** @type {string} */ (input.variant))) throw new RuleError('rules');
    out.variant = /** @type {'meister' | 'basis' | 'joker'} */ (input.variant);
  }
  return Object.freeze(out);
}

/** How many dice show each face (index 0 for ones), and their sum. @param {number[]} dice */
export function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0];
  let sum = 0;
  for (const d of dice) {
    c[d - 1] += 1;
    sum += d;
  }
  return { c, sum };
}

/** A box's natural value from the dice's counts and sum. @param {string} box @param {number[]} c @param {number} sum */
function natural(box, c, sum) {
  const f = FACE[box];
  if (f) return c[f - 1] * f;
  const most = Math.max(...c);
  switch (box) {
    case 'three': return most >= 3 ? sum : 0;
    case 'four': return most >= 4 ? sum : 0;
    // Three alike and two alike of another number: five alike is no Full House.
    case 'full': return c.includes(3) && c.includes(2) ? 25 : 0;
    // Four in a row; five in a row holds four too.
    case 'small': return (c[2] && c[3] && ((c[0] && c[1]) || (c[1] && c[4]) || (c[4] && c[5]))) ? 30 : 0;
    case 'large': return (c[1] && c[2] && c[3] && c[4] && (c[0] || c[5])) ? 40 : 0;
    case 'wuerfle': return most === 5 ? 50 : 0;
    default: return sum;
  }
}

/** Whether `dice` are five faces 1 to 6. @param {unknown} dice */
const isDice = (dice) => Array.isArray(dice) && dice.length === 5 && dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6);

/**
 * The natural value of a box for five dice: the points it would get with no variant's rule.
 * @param {string} box  @param {number[]} dice
 */
export function score(box, dice) {
  if (!BOXES.includes(/** @type {Box} */ (box))) throw new RuleError('box');
  if (!isDice(dice)) throw new TypeError('score needs five dice, 1 to 6');
  const { c, sum } = counts(dice);
  return natural(box, c, sum);
}

/**
 * @typedef {{ variant: 'meister' | 'basis' | 'joker' }} Rules
 * @typedef {Record<string, number>} Column  box → points, for the boxes filled so far
 * @typedef {{
 *   rules: Rules, players: number, games: number,
 *   game: number, round: number, turn: number, first: number,
 *   roll: number, dice: number[], held: boolean[],
 *   boxes: Column[][], extra: number[][],
 *   phase: 'turn' | 'done',
 *   last: { seat: number, game: number, box: string, points: number, extra: number } | null,
 * }} State
 */

/**
 * A fresh match. `first` starts game 1; each further game starts one seat on.
 * @param {{ players: number, games: number, rules?: Record<string, unknown>, first?: number }} o
 * @returns {State}
 */
export function createGame({ players, games, rules: raw, first = 0 }) {
  if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) throw new RuleError('players');
  if (!Number.isInteger(games) || games < GAMES.min || games > GAMES.max) throw new RuleError('games');
  if (!Number.isInteger(first) || first < 0 || first >= players) throw new RuleError('players');
  const rules = cleanRules(raw);
  return {
    rules,
    players,
    games,
    game: 0,
    round: 1,
    turn: first,
    first,
    roll: 0,
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    boxes: Array.from({ length: players }, () => Array.from({ length: games }, () => ({}))),
    extra: Array.from({ length: players }, () => Array(games).fill(0)),
    phase: 'turn',
    last: null,
  };
}

/**
 * What a column may take for these dice under the rules, box → points (the joker's and the basic
 * rule's values included), and the extra a further five-alike brings with it. Not bound to whose
 * turn it is: the bots try every way the dice could fall with it.
 * @param {Rules} rules  @param {Column} column  @param {number[]} dice
 * @returns {{ points: Record<string, number>, extra: number }}
 */
export function entry(rules, column, dice) {
  const { c, sum } = counts(dice);
  const open = BOXES.filter((b) => column[b] === undefined);
  /** @type {Record<string, number>} */
  const points = {};
  const face = c.indexOf(5) + 1;
  const wuerfle = column.wuerfle;
  // A further five-alike: Würfle is filled (in Schmidt's rules, with 50).
  if (face && wuerfle !== undefined && (rules.variant === 'joker' || wuerfle === 50)) {
    const mine = UPPER[face - 1];
    if (rules.variant === 'meister') {
      const fit = [mine, 'three', 'four', 'chance'].filter((b) => column[b] === undefined);
      if (fit.length) for (const b of fit) points[b] = natural(b, c, sum);
      else for (const b of open) points[b] = 0;
      return { points, extra: 50 };
    }
    if (rules.variant === 'basis') {
      for (const b of open) points[b] = MAX[/** @type {Box} */ (b)];
      return { points, extra: 50 };
    }
    // The joker: its own upper box if open, else any lower box at full value, else 0 above.
    if (column[mine] === undefined) points[mine] = 5 * face;
    else if (LOWER.some((b) => column[b] === undefined)) {
      const full = { three: sum, four: sum, full: 25, small: 30, large: 40, chance: sum };
      for (const b of LOWER) if (column[b] === undefined) points[b] = full[/** @type {keyof typeof full} */ (b)];
    } else for (const b of open) points[b] = 0;
    return { points, extra: wuerfle === 50 ? 100 : 0 };
  }
  for (const b of open) points[b] = natural(b, c, sum);
  // The basic rule: a box is crossed out only when the roll fits no open box.
  if (rules.variant === 'basis' && open.some((b) => points[b] > 0)) {
    for (const b of open) if (points[b] === 0) delete points[b];
  }
  return { points, extra: 0 };
}

/** The column `seat` fills now. @param {State} state @param {number} seat */
const columnOf = (state, seat) => state.boxes[seat][state.game];

/**
 * What `seat` may write now, box → points under the variant; {} when it may not score now (not its
 * turn, no roll yet, the match over).
 * @param {State} state  @param {number} seat
 */
export function options(state, seat) {
  if (state.phase !== 'turn' || seat !== state.turn || state.roll === 0) return {};
  return entry(state.rules, columnOf(state, seat), state.dice).points;
}

/**
 * Makes a move. Changes `state` and returns what happened, in order. `randomInt(n)` (0..n-1) rolls
 * the dice.
 * @param {State} state  @param {number} seat  @param {Record<string, any>} move
 * @param {{ randomInt?: (n: number) => number }} [ctx]
 */
export function act(state, seat, move, { randomInt } = {}) {
  if (state.phase !== 'turn') throw new RuleError('done');
  if (seat !== state.turn) throw new RuleError('turn');
  if (!move || typeof move !== 'object') throw new RuleError('move');
  if (move.type === 'roll') return roll(state, seat, move.keep, randomInt);
  if (move.type === 'score') return write(state, seat, move.box);
  throw new RuleError('move');
}

/** @param {State} state @param {number} seat @param {unknown} keep @param {((n: number) => number) | undefined} randomInt */
function roll(state, seat, keep, randomInt) {
  if (state.roll >= 3) throw new RuleError('rolls');
  const first = state.roll === 0;
  if (!first && keep != null && !(Array.isArray(keep) && keep.length === 5 && keep.every((k) => typeof k === 'boolean'))) {
    throw new RuleError('move');
  }
  if (typeof randomInt !== 'function') throw new TypeError('act needs randomInt to roll');
  const held = first || keep == null ? [false, false, false, false, false] : [.../** @type {boolean[]} */ (keep)];
  // Left to right over the dice not kept: the server and the page draw in this order.
  state.dice = state.dice.map((d, i) => (held[i] ? d : randomInt(6) + 1));
  state.held = held;
  state.roll += 1;
  return [{ type: 'roll', seat, roll: state.roll, dice: [...state.dice], held: [...held] }];
}

/** @param {State} state @param {number} seat @param {unknown} box */
function write(state, seat, box) {
  if (state.roll === 0) throw new RuleError('unrolled');
  if (typeof box !== 'string' || !BOXES.includes(/** @type {Box} */ (box))) throw new RuleError('box');
  const column = columnOf(state, seat);
  if (column[box] !== undefined) throw new RuleError('taken');
  const { points, extra } = entry(state.rules, column, state.dice);
  if (points[box] === undefined) throw new RuleError('box');

  const game = state.game;
  column[box] = points[box];
  state.extra[seat][game] += extra;
  state.last = { seat, game, box, points: points[box], extra };
  /** @type {Record<string, unknown>[]} */
  const events = [{ type: 'score', seat, game, box, points: points[box], extra }];

  state.roll = 0;
  state.dice = [0, 0, 0, 0, 0];
  state.held = [false, false, false, false, false];
  const next = (seat + 1) % state.players;
  state.turn = next;
  // Everyone has had this round's turn once play comes back to the game's first player.
  if (next !== state.first) return events;
  if (state.round < ROUNDS) {
    state.round += 1;
    events.push({ type: 'round', game, round: state.round });
  } else if (game + 1 < state.games) {
    state.game = game + 1;
    state.round = 1;
    state.first = (state.first + 1) % state.players;
    state.turn = state.first;
    events.push({ type: 'game', game: state.game });
  } else {
    state.phase = 'done';
    events.push({ type: 'done' });
  }
  return events;
}

/**
 * One column of the block: its boxes, the upper sum and bonus (35 or 0 once known, null while upper
 * boxes are open and the sum under 63), upper with bonus, lower, the further five-alikes' extra.
 * @param {State} state  @param {number} seat  @param {number} [game]
 */
export function sheet(state, seat, game = state.game) {
  const column = state.boxes[seat][game];
  const boxes = Object.fromEntries(BOXES.filter((b) => column[b] !== undefined).map((b) => [b, column[b]]));
  const add = (/** @type {readonly string[]} */ list) => list.reduce((n, b) => n + (column[b] ?? 0), 0);
  const up = add(UPPER);
  const bonus = up >= BONUS.at ? BONUS.points : UPPER.every((b) => column[b] !== undefined) ? 0 : null;
  const top = up + (bonus ?? 0);
  const low = add(LOWER);
  const extra = state.extra[seat][game];
  return { boxes, up, bonus, top, low, extra, total: top + low + extra };
}

/** Each seat's game totals and match total. @param {State} state */
export function totals(state) {
  return state.boxes.map((_, seat) => {
    const games = state.boxes[seat].map((_, game) => sheet(state, seat, game).total);
    return { games, total: games.reduce((a, b) => a + b, 0) };
  });
}

/** The table's order, best first; equal totals share a place (1, 1, 3). @param {State} state */
export function standings(state) {
  const all = totals(state).map(({ total }, seat) => ({ seat, total }));
  return all
    .map((s) => ({ ...s, place: 1 + all.filter((o) => o.total > s.total).length }))
    .sort((a, b) => b.total - a.total || a.seat - b.seat);
}

/** A JSON-safe copy for the pages: everything at this table is public. @param {State} state @returns {State} */
export const view = (state) => JSON.parse(JSON.stringify(state));

// ---- judgement: what a box is worth -------------------------------------------------------------
//
// Writing a box is worth its points now minus what the box would likely bring later, if kept open,
// plus the change in the upper bonus's outlook. "Later" shrinks as the game runs out: early on a box
// is worth about what good play averages in it, with one turn left only what one try at it brings.

/** What a box brings over a whole game of good play (upper boxes: about three of a face, more of a high one). */
const EARLY = Object.freeze({
  ones: 1.9, twos: 5.3, threes: 8.6, fours: 12.2, fives: 15.7, sixes: 19.2,
  three: 21.7, four: 13.1, full: 21.5, small: 29.5, large: 32.7, wuerfle: 16.9, chance: 22,
});
/** What one turn's best try at a box brings (computed by expectimax over three rolls). */
const LATE = Object.freeze({
  ones: 2.106, twos: 4.213, threes: 6.319, fours: 8.426, fives: 10.532, sixes: 12.639,
  three: 15.195, four: 5.611, full: 9.072, small: 18.463, large: 10.444, wuerfle: 2.301, chance: 23.333,
});
/** How fast "later" moves from one try to a whole game's worth, in turns. */
const SPREAD = 6;

/** The odds of 0 to 5 dice showing a face, n of 5 at chance p each. @param {number} p */
function binomial(p) {
  const choose = [1, 5, 10, 10, 5, 1];
  return choose.map((k, n) => k * p ** n * (1 - p) ** (5 - n));
}

/**
 * For every set of open upper boxes (a bitmask, ones = 1) and every shortfall to 63, the chance the
 * open boxes make it up, each face's count drawn from `dist(face)`.
 * @param {(face: number) => number[]} dist
 */
function bonusOdds(dist) {
  const odds = new Float64Array(64 * 64);
  for (let mask = 0; mask < 64; mask++) {
    let sums = [1];
    for (let f = 1; f <= 6; f++) {
      if (!(mask & (1 << (f - 1)))) continue;
      const next = Array(sums.length + 5 * f).fill(0);
      const d = dist(f);
      sums.forEach((p, s) => d.forEach((q, n) => (next[s + n * f] += p * q)));
      sums = next;
    }
    let tail = 0;
    for (let need = sums.length - 1; need >= 0; need--) {
      tail += sums[need];
      if (need < 64) odds[mask * 64 + need] = tail;
    }
  }
  return odds;
}
// One try: each die hits the face with 1 − (5/6)³. A whole game: the counts good play averages.
const ODDS_LATE = bonusOdds(() => binomial(1 - (5 / 6) ** 3));
const ODDS_EARLY = bonusOdds((f) => binomial(EARLY[UPPER[f - 1]] / f / 5));

/**
 * The journeyman's judgement for one column: a function from five dice to the box it would write,
 * { box, points, extra, value }, or null when no box is open. The value is what writing it gains:
 * the points minus the box's later worth, plus the change in the bonus's outlook and the extra.
 * @param {Rules} rules  @param {Column} column
 */
export function judgement(rules, column) {
  const open = BOXES.filter((b) => column[b] === undefined);
  const later = open.length - 1;
  const g = later <= 1 ? 0 : 1 - Math.exp(-(later - 1) / SPREAD);
  /** @type {Record<string, number>} */
  const worth = {};
  for (const b of open) worth[b] = later ? LATE[/** @type {Box} */ (b)] + (EARLY[/** @type {Box} */ (b)] - LATE[/** @type {Box} */ (b)]) * g : 0;
  let up = 0;
  let mask = 0;
  UPPER.forEach((b, i) => {
    if (column[b] === undefined) mask |= 1 << i;
    else up += column[b];
  });
  /** The bonus's outlook in points, with `u` written above and `m` the upper boxes still open. */
  const outlook = (/** @type {number} */ u, /** @type {number} */ m) => {
    if (u >= BONUS.at) return BONUS.points;
    if (!m || !later) return 0;
    const k = m * 64 + BONUS.at - u;
    return BONUS.points * (ODDS_LATE[k] + (ODDS_EARLY[k] - ODDS_LATE[k]) * g);
  };
  const below = outlook(up, mask);
  return (/** @type {number[]} */ dice) => {
    const { points, extra } = entry(rules, column, dice);
    /** @type {{ box: string, points: number, extra: number, value: number } | null} */
    let best = null;
    for (const box of open) {
      const p = points[box];
      if (p === undefined) continue;
      const f = FACE[box];
      const value = p - worth[box] + (f ? outlook(up + p, mask & ~(1 << (f - 1))) - below : 0) + extra;
      if (!best || value > best.value + 1e-9) best = { box, points: p, extra, value };
    }
    return best;
  };
}

/**
 * The box the journeyman would write now (the page's hint), null when `seat` may not score now.
 * @param {State} state  @param {number} seat
 */
export function suggest(state, seat) {
  if (!Object.keys(options(state, seat)).length) return null;
  return judgement(state.rules, columnOf(state, seat))(state.dice)?.box ?? null;
}
