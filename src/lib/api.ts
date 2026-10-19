// The server's shapes (server/rooms.mjs → view, server/rules.mjs → view) and the calls that change
// them. Adapted from Stammtisch's.

import type { Avatar } from './avatar';
import type { Fling, Throw } from './dice';

export type Phase = 'lobby' | 'play' | 'final' | 'gone';
export type ClockChoice = 'off' | 'relaxed' | 'quick';
/** A bot's rank, as in a guild, weakest first (server/bots.mjs, the family's three). */
export type Level = 'apprentice' | 'journeyman' | 'master';
export const LEVELS: Level[] = ['apprentice', 'journeyman', 'master'];
/** The rules: Schmidt's championship rules (the default), its basic rules, or Hasbro's joker rule. */
export type Variant = 'meister' | 'basis' | 'joker';
export const VARIANTS: Variant[] = ['meister', 'basis', 'joker'];

export type BoxId = 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes' | 'three' | 'four' | 'full' | 'small' | 'large' | 'wuerfle' | 'chance';
export const UPPER: BoxId[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const LOWER: BoxId[] = ['three', 'four', 'full', 'small', 'large', 'wuerfle', 'chance'];
export const BOXES: BoxId[] = [...UPPER, ...LOWER];

export interface Settings {
  /** How many games (columns of the block) the match plays, 1 to 6. */
  games: number;
  clock: ClockChoice;
  /** The bots' rank: every bot's (until the host gives one its own) and the stand-ins'. */
  bots: Level;
}

export interface Rules {
  variant: Variant;
  /** The house rule: with two games or more, any column may be written (server/rules.mjs). */
  free: boolean;
}

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  online: boolean;
  bot: boolean;
  level?: Level;
}

/** The match as the rules keep it (server/rules.mjs); everything in it is public. */
export interface MatchState {
  rules: Rules;
  players: number;
  games: number;
  /** The game being played (0-based), its round (1 to 13), whose turn, who started it. */
  game: number;
  round: number;
  turn: number;
  first: number;
  /** Throws used this turn (0 to 3), the dice (zeros before the first), what was kept for the last throw. */
  roll: number;
  dice: number[];
  held: boolean[];
  /** boxes[seat][game][box]: what's written. extra[seat][game]: points from further five-alikes. */
  boxes: Partial<Record<BoxId, number>>[][];
  extra: number[][];
  phase: 'turn' | 'done';
  last: { seat: number; game: number; box: BoxId; points: number; extra: number } | null;
}

export interface GameSheet {
  boxes: Partial<Record<BoxId, number>>;
  up: number;
  /** 35, 0, or null while it's still open. */
  bonus: number | null;
  top: number;
  low: number;
  extra: number;
  total: number;
}

/** A seat's match: each game's total, and all of them. */
export interface Totals {
  games: number[];
  total: number;
}

export interface Standing {
  seat: number;
  total: number;
  place: number;
}

export interface TableEvent {
  n: number;
  type: string;
  seat?: number;
  [k: string]: unknown;
}

export type Ended = 'done' | 'stopped' | 'left';

export interface Game {
  n: number;
  /** Player ids round the table, in playing order. */
  seats: string[];
  gone: boolean[];
  /** Your seat, or -1: watching. */
  seat: number;
  state: MatchState;
  totals: Totals[];
  standings: Standing[];
  throw: Throw | null;
  /** The dice the player in turn is keeping for the next throw, live. */
  hold: boolean[];
  holdUntil: number;
  /** A seat whose clock ran out: the bot is finishing its turn. */
  autopilot: number;
  events: TableEvent[];
  endsAt: number | null;
  startedAt: number;
  endedAt: number | null;
  ended: Ended | null;
  stoppedBy: string | null;
}

export interface View {
  code: string;
  phase: Phase;
  version: number;
  host: string;
  me: string | null;
  settings: Settings;
  rules: Rules;
  notice: string | null;
  /** The players at the table, in playing order. */
  order: string[];
  players: Player[];
  game: Game | null;
  now: number;
}

export interface Seat {
  code: string;
  player: string;
  token: string;
}

export interface Config {
  clocks: ClockChoice[];
  moveSeconds: Record<string, number>;
  games: { min: number; max: number };
  players: { min: number; max: number };
  seats: number;
  variants: Variant[];
  levels: Level[];
  defaults: Settings & { rules: Rules };
}

export type { Fling, Throw };

/**
 * A refusal from the server ("no-room", "turn" …), a network failure ("offline"), the server or
 * Cloudflare in trouble ("busy": a 5xx without the game's own answer) or no answer in time
 * ("timeout": Folio's track() gave up). The last three are worth "Try again" (waits.ts).
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: 'no-store' });
  } catch {
    // Given up on (the signal from track()), or the network: Safari says "Load failed", Chrome
    // "Failed to fetch", so classify by type (learnings/ios-and-webkit.md).
    throw new ApiError(init.signal?.aborted ? 'timeout' : 'offline');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { error, ...detail } = body ?? {};
    throw new ApiError(error ?? (response.status >= 500 ? 'busy' : `http-${response.status}`), response.status, detail);
  }
  return body as T;
}

const post = (body: unknown, token?: string, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { 'x-wuerfle-token': token } : {}) },
  body: JSON.stringify(body ?? {}),
  signal,
});

/**
 * A deploy restarts the server and ends every room; for a few seconds a create or join can fail.
 * One quiet retry, then the error (learnings/projects/vollmond.md). Safe for create and join: they
 * carry a key, so a retry gets the seat a first try may have made. Not once the page gave up.
 */
async function again<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (signal?.aborted || !(error instanceof ApiError) || (error.code !== 'offline' && error.status < 500)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw error;
    return fn();
  }
}

export const api = {
  config: () => again(() => request<Config>('/api/config')),
  create: (name: string, avatar: Avatar, key?: string, signal?: AbortSignal) =>
    again(() => request<Seat>('/api/rooms', post({ name, avatar, key }, undefined, signal)), signal),
  info: (code: string) => request<{ code: string; phase: Phase; players: number; full: boolean }>(`/api/rooms/${code}`),
  join: (code: string, name: string, avatar: Avatar | null, token?: string, key?: string, signal?: AbortSignal) =>
    again(() => request<Seat>(`/api/rooms/${code}/join`, post({ name, avatar, token, key }, undefined, signal)), signal),
  act: (seat: Seat, action: string, body?: unknown, signal?: AbortSignal) => request<void>(`/api/rooms/${seat.code}/${action}`, post(body, seat.token, signal)),
};

/** Room codes: four consonants (server/rooms.mjs → CODE). */
export const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
