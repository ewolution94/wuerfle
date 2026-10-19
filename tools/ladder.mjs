// The ranks against each other: seeded solo games of Würfle for each rank (and a random player, for
// scale), every rank on the same dice: in game g, roll k of round r draws the same five numbers for
// each of them, its dice not kept taking them in order. What each rank scores on average and how
// widely, how often it makes the upper bonus and writes a five-alike, and how long the master thinks.
//
//   node tools/ladder.mjs [games] [variant]          1000 games by default; meister | basis | joker
//   WUERFLE_MASTER_MS=60 node tools/ladder.mjs 2000  a tighter budget for the master
//
// The master's times are its searching decisions: after a turn's first roll, where it builds the
// turn's tables, and after the second, where it reuses them. The first roll and the box after the
// third are no decision.
import { VARIANTS, act, createGame, sheet } from '../server/rules.mjs';
import { MASTER_MS, botMove, randomMove } from '../server/bots.mjs';

const GAMES = Number(process.argv[2] ?? 1000);
const variant = process.argv[3] ?? 'meister';
if (!VARIANTS.includes(variant)) throw new Error(`no variant ${variant} (${VARIANTS.join(', ')})`);
const RANKS = ['random', 'apprentice', 'journeyman', 'master'];

/** mulberry32: a repeatable random integer below n. @param {number} seed */
function seeded(seed) {
  let a = seed >>> 0;
  return (/** @type {number} */ n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/** One game's dice: for every round and roll, five numbers 0..5. @param {number} g */
function diceFor(g) {
  const r = seeded(20261019 + g * 7919);
  return Array.from({ length: 13 }, () => Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => r(6))));
}

/** @type {Record<string, { scores: number[], bonus: number, five: number, extra: number }>} */
const stats = Object.fromEntries(RANKS.map((r) => [r, { scores: [], bonus: 0, five: 0, extra: 0 }]));
/** The master's decision times, after the first roll and after the second. @type {number[][]} */
const times = [[], []];
const started = Date.now();

for (let g = 0; g < GAMES; g++) {
  const dice = diceFor(g);
  for (const rank of RANKS) {
    const s = createGame({ players: 1, games: 1, rules: { variant } });
    /** @type {number[]} */
    let pool = [];
    let at = 0;
    const randomInt = () => pool[at++];
    const choose = seeded(g + 1);
    while (s.phase !== 'done') {
      const roll = s.roll;
      const t0 = performance.now();
      const move = rank === 'random' ? randomMove(s, 0, choose) : botMove(s, 0, { level: rank });
      if (rank === 'master' && (roll === 1 || roll === 2)) times[roll - 1].push(performance.now() - t0);
      if (!move) throw new Error('no move');
      if (move.type === 'roll') {
        pool = dice[s.round - 1][s.roll];
        at = 0;
      }
      act(s, 0, move, { randomInt });
    }
    const sh = sheet(s, 0, 0);
    const st = stats[rank];
    st.scores.push(sh.total);
    if (sh.bonus === 35) st.bonus += 1;
    if (sh.boxes.wuerfle === 50) st.five += 1;
    st.extra += sh.extra;
  }
}

const pct = (/** @type {number} */ n) => `${((100 * n) / GAMES).toFixed(1)} %`.padStart(7);
console.log(`Würfle, ${variant}, ${GAMES} solo games a rank, the same dice for each:`);
console.log('  rank          average  spread   low  high   bonus   five-alike  extra');
for (const rank of RANKS) {
  const { scores, bonus, five, extra } = stats[rank];
  const mean = scores.reduce((a, b) => a + b, 0) / GAMES;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / GAMES);
  console.log(`  ${rank.padEnd(12)} ${mean.toFixed(1).padStart(8)} ${sd.toFixed(1).padStart(7)} ${String(Math.min(...scores)).padStart(5)} ${String(Math.max(...scores)).padStart(5)} ${pct(bonus)} ${pct(five)}     ${(extra / GAMES).toFixed(1).padStart(5)}`);
}
console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
for (const [k, list] of times.entries()) {
  list.sort((a, b) => a - b);
  const at = (/** @type {number} */ q) => list[Math.min(list.length - 1, Math.floor(list.length * q))].toFixed(2);
  const when = k ? 'after the second roll' : 'after the first roll ';
  console.log(`  master ${when}: ${String(list.length).padStart(6)} decisions, median ${at(0.5)} ms, 99 % ${at(0.99)} ms, slowest ${at(1)} ms`);
}
console.log(`  (the master's budget: ${MASTER_MS} ms)`);
