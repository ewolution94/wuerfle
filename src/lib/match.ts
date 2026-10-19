// What the table needs, whoever runs the match: a room on the server (src/lib/room.svelte.ts) or a
// solo game in the page (src/lib/solo.svelte.ts). The table (Table.svelte) shows a MatchView and asks
// a Driver for the three things a turn has: a throw, a box written, the dice kept.

import type { Avatar } from './avatar';
import type { BoxId, Level, MatchState, Standing, Totals } from './api';
import type { Fling, Throw } from './dice';
import type { View } from './api';

export interface Person {
  name: string;
  avatar: Avatar;
  bot: boolean;
  level?: Level;
  /** Here (a bot always is), or their page is closed. */
  online: boolean;
  /** Left the table: a bot plays for them. */
  gone: boolean;
}

export interface MatchView {
  /** Changes with every new match at the table, so the dice start afresh. */
  id: string;
  state: MatchState;
  totals: Totals[];
  standings: Standing[];
  /** By seat, in playing order. */
  people: Person[];
  /** Your seat, or -1: watching. */
  me: number;
  throw: Throw | null;
  /** The dice the player in turn is keeping, live. */
  hold: boolean[];
  /** A seat whose clock ran out: the bot is finishing its turn. */
  autopilot: number;
  /** When the turn's clock runs out (the server's time), or null. */
  endsAt: number | null;
  over: boolean;
}

export interface Driver {
  /** Throw the dice not kept; `fling` is where they left the hand, for the others to see. */
  roll(keep: boolean[], fling: Fling | null, from?: Element | null): Promise<void>;
  /** Write the current dice into a box. */
  /** A box written in column `game`. */
  score(box: BoxId, game: number, from?: Element | null): Promise<void>;
  /** The dice you're keeping for your next throw (shown to everyone; no answer waited for). */
  hold(held: boolean[]): void;
  /** Milliseconds until a server timestamp. */
  left(at: number, now?: number): number;
}

/** A room's view as the table sees it. */
export function fromRoom(view: View): MatchView | null {
  const g = view.game;
  if (!g) return null;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return {
    id: `${view.code}:${g.n}`,
    state: g.state,
    totals: g.totals,
    standings: g.standings,
    people: g.seats.map((id, seat) => {
      const p = byId.get(id);
      return {
        name: p?.name ?? '?',
        avatar: p?.avatar ?? (null as unknown as Avatar),
        bot: p?.bot ?? false,
        level: p?.level,
        online: p?.online ?? false,
        gone: g.gone[seat] ?? !p,
      };
    }),
    me: g.seat,
    throw: g.throw,
    hold: g.hold,
    autopilot: g.autopilot,
    endsAt: g.endsAt,
    over: view.phase === 'final',
  };
}
