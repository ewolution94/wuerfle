// A solo game: the rules and the bots (server/rules.mjs, server/bots.mjs) run in the page, so it
// plays with no server and works offline (the service worker keeps the page). Alone, or against up
// to three bots. The game is kept on the device as it goes (`wuerfle:solo`), so a reload or a locked
// phone carries on where it was; finished games alone go into the record (`wuerfle:record`): games
// played, the best and the total, for the start page.

import { act, createGame, standings, totals, view as ruleView } from '../../server/rules.mjs';
import { botMove } from '../../server/bots.mjs';
import { cryptoWord, fairInt } from '../../server/fair.mjs';
import type { BoxId, Level, MatchState, Variant } from './api';
import { randomAvatar, type Avatar } from './avatar';
import type { Fling, Throw } from './dice';
import type { Driver, MatchView, Person } from './match';

const GAME = 'wuerfle:solo';
const RECORD = 'wuerfle:record';
/** As on the server (server/rooms.mjs): the dice land before a bot moves on, its keeps show first. */
const THROW_SHOW = 1900;
const KEEP_SHOW = 700;
const BOT_THINK = [550, 1100];
const BOT_NAMES = ['Robo Rita', 'Bot Bernd', 'Pasch Paula'];

export interface SoloSetup {
  games: number;
  bots: number;
  level: Level;
  variant: Variant;
  /** The house rule: any column (two games or more). */
  free?: boolean;
}

export interface Record {
  played: number;
  best: number;
  sum: number;
}

interface Saved {
  setup: SoloSetup;
  people: Person[];
  state: MatchState;
  throws: number;
  throw: Throw | null;
  hold: boolean[];
  id: string;
}

/** A fair die: a random integer below n from the browser's crypto, without modulo bias (server/fair.mjs, tested). */
const randomInt = (n: number) => fairInt(n, cryptoWord);

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not kept
  }
}

export const record = $state<Record>(read<Record>(RECORD) ?? { played: 0, best: 0, sum: 0 });

/** A solo game left unfinished on this device, if any. */
export const savedSolo = () => {
  const s = read<Saved>(GAME);
  return s && s.state?.phase === 'turn' ? s : null;
};

export class Solo implements Driver {
  view: MatchView = $state.raw(null as unknown as MatchView);
  /** This game just set a new best. */
  newBest = $state(false);

  #setup: SoloSetup;
  #people: Person[];
  #state: MatchState;
  #throws = 0;
  #throw: Throw | null = null;
  #hold = [false, false, false, false, false];
  #id: string;
  #timer = 0;
  #holdUntil = 0;
  #closed = false;

  constructor(setup: SoloSetup, me: { name: string; avatar: Avatar }, saved: Saved | null = null) {
    if (saved) {
      this.#setup = saved.setup;
      this.#people = saved.people;
      this.#state = saved.state;
      this.#throws = saved.throws;
      this.#throw = saved.throw;
      this.#hold = saved.hold;
      this.#id = saved.id;
    } else {
      this.#setup = setup;
      this.#people = [
        { name: me.name, avatar: me.avatar, bot: false, online: true, gone: false },
        ...BOT_NAMES.slice(0, setup.bots).map((name) => ({ name, avatar: randomAvatar(), bot: true, level: setup.level, online: true, gone: false })),
      ];
      this.#state = createGame({ players: this.#people.length, games: setup.games, rules: { variant: setup.variant, free: Boolean(setup.free) }, first: 0 }) as MatchState;
      this.#id = `solo:${Date.now().toString(36)}`;
    }
    this.#publish();
  }

  static resume(me: { name: string; avatar: Avatar }) {
    const saved = savedSolo();
    return saved ? new Solo(saved.setup, me, saved) : null;
  }

  get setup() {
    return this.#setup;
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
  }

  /** Gives the game up: it's forgotten, and not counted. */
  abandon() {
    this.close();
    write(GAME, null);
  }

  async roll(keep: boolean[], fling: Fling | null) {
    this.#move(0, { type: 'roll', keep }, fling);
  }

  async score(box: BoxId, game: number) {
    this.#move(0, { type: 'score', box, game }, null);
  }

  hold(held: boolean[]) {
    this.#hold = [...held];
    this.#publish();
  }

  left(at: number, now = Date.now()) {
    return Math.max(0, at - now);
  }

  #move(seat: number, move: { type: 'roll'; keep: boolean[] } | { type: 'score'; box: BoxId; game: number }, fling: Fling | null) {
    const s = this.#state;
    const events = act(s, seat, move, { randomInt }) as { type: string; dice?: number[]; held?: boolean[]; roll?: number }[];
    const rolled = events.find((e) => e.type === 'roll');
    if (rolled) {
      this.#throws++;
      this.#throw = { n: this.#throws, seat, roll: rolled.roll ?? s.roll, dice: [...(rolled.dice ?? s.dice)], held: [...(rolled.held ?? s.held)], fling };
      this.#hold = [...(rolled.held ?? s.held)];
      this.#holdUntil = Date.now() + THROW_SHOW;
    }
    if (events.some((e) => e.type === 'score')) this.#hold = [false, false, false, false, false];
    if (s.phase === 'done') this.#finish();
    this.#publish();
  }

  #finish() {
    write(GAME, null);
    // Only games alone count: a record against bots would depend on how many there were.
    if (this.#setup.bots > 0) return;
    const games = (totals(this.#state) as { games: number[]; total: number }[])[0].games;
    const best = Math.max(...games);
    this.newBest = best > record.best;
    record.played += games.length;
    record.sum += games.reduce((a, b) => a + b, 0);
    record.best = Math.max(record.best, best);
    write(RECORD, { ...record });
  }

  #publish() {
    const s = this.#state;
    this.view = {
      id: this.#id,
      state: ruleView(s) as MatchState,
      totals: totals(s) as MatchView['totals'],
      standings: standings(s) as MatchView['standings'],
      people: this.#people,
      me: 0,
      throw: this.#throw,
      hold: this.#hold,
      autopilot: -1,
      endsAt: null,
      over: s.phase === 'done',
    };
    if (s.phase !== 'done') {
      write(GAME, { setup: this.#setup, people: this.#people, state: s, throws: this.#throws, throw: this.#throw, hold: this.#hold, id: this.#id } satisfies Saved);
      this.#bots();
    }
  }

  /** A bot's turn: it thinks a moment once the dice have landed, shows its keeps, then moves. */
  #bots() {
    clearTimeout(this.#timer);
    const s = this.#state;
    const seat = s.turn;
    if (this.#closed || s.phase === 'done' || !this.#people[seat]?.bot) return;
    const think = BOT_THINK[0] + Math.random() * (BOT_THINK[1] - BOT_THINK[0]);
    const wait = Math.max(think, this.#holdUntil - Date.now() + think / 2);
    this.#timer = window.setTimeout(() => {
      if (this.#closed || s.turn !== seat) return;
      const move = botMove(s, seat, { level: this.#people[seat].level ?? 'journeyman' }) as { type: 'roll'; keep: boolean[] } | { type: 'score'; box: BoxId; game: number } | null;
      if (!move) return;
      if (move.type === 'roll' && s.roll > 0 && move.keep.some((k, i) => k !== this.#hold[i])) {
        this.#hold = move.keep.map(Boolean);
        this.view = { ...this.view, hold: this.#hold };
        this.#timer = window.setTimeout(() => !this.#closed && s.turn === seat && this.#move(seat, move, null), KEEP_SHOW);
        return;
      }
      this.#move(seat, move, null);
    }, wait);
  }
}
