// The table's Driver for a room on the server: a throw and a box are moves the server checks (and
// waited for at the control that made them, Folio's track()); the dice you keep go out one request at
// a time, the latest winning, without holding up the table (learnings/ui-preferences.md).

import type { BoxId } from './api';
import type { Fling } from './dice';
import type { Driver } from './match';
import type { Room } from './room.svelte';
import { waitAt } from './waits';
import { t } from './i18n.svelte';

export function remote(room: Room): Driver {
  let sending = false;
  let next: boolean[] | null = null;

  async function sendHold() {
    if (sending || !next) return;
    sending = true;
    const held = next;
    next = null;
    try {
      await room.act('hold', { held });
    } catch {
      // the next throw carries the keep anyway
    } finally {
      sending = false;
    }
    void sendHold();
  }

  return {
    roll: (keep: boolean[], fling: Fling | null, from?: Element | null) =>
      waitAt(from, (signal) => room.act('move', { move: { type: 'roll', keep }, fling }, signal)).then(() => undefined),
    score: (box: BoxId, game: number, from?: Element | null) =>
      waitAt(from, (signal) => room.act('move', { move: { type: 'score', box, game } }, signal), t('wait_score')).then(() => undefined),
    hold(held: boolean[]) {
      next = [...held];
      void sendHold();
    },
    left: (at: number, now?: number) => room.left(at, now),
  };
}
