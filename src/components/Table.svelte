<!--
  The table: the printed band (the round, the clock, Settings), the dice on the night block
  (src/lib/dice.ts), the throw button with the throws left, the players' totals, and the block
  (ScoreBlock.svelte). The same for a room and a solo game: a MatchView to show, a Driver to ask.

  On a phone the table is big and the block shows its first rows; the table folds down to a strip of
  the five dice when the block is wanted (the fold button, a tap on a box, by itself after the third
  roll) and opens again for the next throw (the user's pick after their iPhone test, 2026-10-19,
  development/plans/wuerfle/table.html). Apart from that, nothing changes height while you play, so
  the table never moves under a finger (learnings/projects/stichle.md). A box you tap is chosen
  first; the bubble beside it, or a second tap, writes it. On a wide screen the block sits beside the
  dice and nothing folds.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { choices as allowed, roundsOf, sheet, suggest as suggestion, isFree } from '../../server/rules.mjs';
  import { ApiError, type BoxId } from '../lib/api';
  // The dice (three.js and cannon-es) are their own chunk, fetched after the first screen.
  import type { DiceTable, Fling } from '../lib/dice';
  import { errorText, t } from '../lib/i18n.svelte';
  import type { Driver, MatchView } from '../lib/match';
  import { prefs } from '../lib/prefs.svelte';
  import { play, unlockOnGesture } from '../lib/sound.svelte';
  import Avatar from './Avatar.svelte';
  import Clock from './Clock.svelte';
  import ScoreBlock from './ScoreBlock.svelte';

  let { match, driver, onsettings }: { match: MatchView; driver: Driver; onsettings: () => void } = $props();

  type Pick = { game: number; box: BoxId };
  type Choice = Pick & { points: number };

  const NONE = [false, false, false, false, false];

  let canvas: HTMLCanvasElement | undefined = $state();
  let throwButton: HTMLButtonElement | undefined = $state();
  let dice: DiceTable | null = null;
  /** The dice's chunk has come and the table is drawn: the effects below may use it. */
  let ready = $state(false);
  /** The dice are flying or settling: no taps, no box written until they've landed. */
  let flying = $state(false);
  /** A throw or a box of yours is on its way to the server. */
  let pending = $state(false);
  let error = $state('');
  /** The dice you're keeping for your next throw (the table answers the tap; the server hears it). */
  let mine = $state([...NONE]);
  /** The throw this page sent and waits for (its number will be the next one), or null. */
  let ownThrow: number | null = null;
  /** The last throw shown here. */
  let seen = 0;
  let matchId = '';
  /** Whose block is open: yours, or a player you tapped. */
  let shown = $state(-1);
  /** The table folded down to a strip of the dice, the block taking the room (phones only). */
  let folded = $state(false);
  /** The block beside the dice (a wide screen): nothing folds. */
  let side = $state(false);
  /** The folded strip's height: as much of the canvas as shows the rail's row (DiceTable.stripHeight). */
  let stripH = $state(124);
  /** The open table's height: the screen less the band, the throw and the totals (measured). */
  let wideH = $state(0);
  let tableEl: HTMLDivElement | undefined = $state();
  /** The box you tapped (its column and box), waiting for its ✓ (or a second tap). */
  let chosen: Pick | null = $state(null);

  const s = $derived(match.state);
  const me = $derived(match.me);
  const over = $derived(match.over || s.phase === 'done');
  const myTurn = $derived(!over && s.turn === me && match.autopilot !== me);
  const held = $derived(myTurn ? mine : match.hold);
  // Not before the dice's chunk has come: a tap would do nothing (a slow connection, the first seconds).
  const canThrow = $derived(ready && myTurn && s.roll < 3 && !pending && !flying);
  const canKeep = $derived(ready && myTurn && s.roll >= 1 && s.roll < 3 && !pending && !flying);
  const canWrite = $derived(myTurn && s.roll >= 1 && !pending && !flying);
  const blockSeat = $derived(shown >= 0 ? shown : me >= 0 ? me : s.turn);
  // What you may write now, in every column you may write in (one, or all under the house rule).
  const options = $derived(canWrite && blockSeat === me ? (allowed(s, me) as Choice[]) : null);
  const suggest = $derived(options && prefs.hint ? (suggestion(s, me) as Pick | null) : null);
  const turnName = $derived(match.people[s.turn]?.name ?? '');

  const hint = $derived.by(() => {
    if (over) return '';
    if (me < 0) return t('hintTheirs', { name: turnName });
    if (match.autopilot >= 0) return match.autopilot === me ? t('hintAutoYou') : t('hintAuto', { name: turnName });
    if (s.turn !== me) return t('hintTheirs', { name: turnName });
    if (s.roll === 0) return t('hintFirst');
    if (s.roll >= 3) return t('hintWrite');
    const n = 3 - s.roll;
    return n === 1 ? t('hintKeepOne') : t('hintKeep', { n });
  });

  // ---- the dice table ----------------------------------------------------------------------

  let gone = false;
  onMount(() => {
    unlockOnGesture();
    const wide = matchMedia('(min-width: 980px) and (min-height: 620px)');
    const onwide = () => {
      side = wide.matches;
      if (side) setFold(false);
    };
    onwide();
    wide.addEventListener('change', onwide);
    // The open table takes what the band, the throw and the players' totals leave (the band grows
    // with the phone's notch, so it's measured, not guessed).
    const measure = () => {
      const t = tableEl;
      if (!t || side) return;
      const h = (sel: string) => t.querySelector<HTMLElement>(sel)?.offsetHeight ?? 0;
      const pad = parseFloat(getComputedStyle(t).paddingBottom) || 0;
      wideH = Math.max(250, Math.floor(t.clientHeight - h('.band') - h('.actions') - h('.who') - pad - 6));
    };
    const ro = new ResizeObserver(measure);
    if (tableEl) ro.observe(tableEl);
    measure();
    void import('../lib/dice').then(({ DiceTable }) => {
      if (gone) return;
      dice = new DiceTable({
      canvas: canvas!,
      onthrow,
      onkeep,
      onrefuse: () => {
        if (!over && me >= 0 && s.turn !== me) flash(t('notYourTurn'));
      },
      onclack: (v) => play.clack(v),
      onrest: () => {
        flying = false;
        const d = s.dice;
        if (d.every((v) => v > 0 && v === d[0])) play.wuerfle();
        // Your last throw: the block comes up by itself.
        if (myTurn && s.roll >= 3) setTimeout(() => myTurn && s.roll >= 3 && setFold(true), 380);
      },
      });
      ready = true;
    });
    return () => {
      gone = true;
      wide.removeEventListener('change', onwide);
      ro.disconnect();
      clearTimeout(unfoldTimer);
      dice?.destroy();
      dice = null;
    };
  });

  // A new match at the table (or the first view): the dice as they lie, nothing replayed.
  $effect(() => {
    if (!ready || !dice || match.id === matchId) return;
    matchId = match.id;
    seen = match.throw?.n ?? 0;
    ownThrow = null;
    mine = [...(match.hold ?? NONE)];
    dice.show(s.roll > 0 ? s.dice : (match.throw?.dice ?? [1, 2, 3, 4, 5]), s.roll > 0 && s.roll < 3 ? match.hold : NONE);
  });

  // A throw: yours lands on the server's numbers; anyone else's is played here the same way.
  $effect(() => {
    const th = match.throw;
    if (!ready || !dice || !th || th.n <= seen || match.id !== matchId) return;
    seen = th.n;
    if (ownThrow !== null && th.seat === me) {
      ownThrow = null;
      dice.resolve(th);
    } else {
      flying = true;
      dice.replay(th);
    }
    mine = [...th.held];
  });

  // Someone else keeping dice between throws: they move to the rail here too.
  $effect(() => {
    const hold = match.hold;
    if (!ready || !dice || myTurn || flying || !hold) return;
    dice.setHeld(s.roll > 0 && s.roll < 3 ? hold : NONE);
  });

  // A new turn: nothing kept, the dice back on the table, the table open; your turn has its sound.
  let turnKey = '';
  let unfoldTimer = 0;
  $effect(() => {
    const key = `${match.id}:${s.game}:${s.round}:${s.turn}`;
    if (key === turnKey) return;
    const first = turnKey === '';
    turnKey = key;
    if (s.roll === 0) {
      mine = [...NONE];
      if (!first) dice?.setHeld(NONE);
    }
    chosen = null;
    if (!first && folded) {
      clearTimeout(unfoldTimer);
      unfoldTimer = window.setTimeout(() => setFold(false), 700);
    }
    if (!first && s.turn === me && !over) {
      play.yourTurn();
      shown = -1;
    }
  });

  // A box written (by anyone): the pencil's sound; the bonus when it comes.
  let lastScore = '';
  $effect(() => {
    const l = s.last;
    const key = l ? `${match.id}:${l.seat}:${l.game}:${l.box}` : '';
    if (key === lastScore) return;
    const first = lastScore === '';
    lastScore = key;
    if (first || !l) return;
    play.write();
    // The bonus, the moment this box took the upper sum to 63.
    const column = sheet(s, l.seat, l.game) as { bonus: number | null; up: number };
    const upper = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(l.box);
    if (l.seat === me && upper && column.bonus === 35 && column.up - l.points < 63) setTimeout(() => play.bonus(), 250);
  });

  $effect(() => {
    if (ready && dice) dice.allow = { throw: canThrow, keep: canKeep };
  });

  // ---- what you do -------------------------------------------------------------------------

  function onthrow(fling: Fling | null) {
    if (!myTurn) return;
    chosen = null;
    pending = true;
    flying = Boolean(fling);
    error = '';
    ownThrow = s.roll;
    driver
      .roll([...mine], fling, throwButton)
      .catch((e) => {
        ownThrow = null;
        flying = false;
        dice?.cancel(s.roll > 0 ? s.dice : (match.throw?.dice ?? [1, 2, 3, 4, 5]), s.roll > 0 ? mine : NONE);
        flash(errorText(e instanceof ApiError ? e.code : 'other'));
      })
      .finally(() => (pending = false));
  }

  function onkeep(i: number) {
    if (!canKeep) return;
    mine[i] = !mine[i];
    dice?.setHeld(mine);
    driver.hold([...mine]);
  }

  /** Folded, Roll opens the table first and throws once the dice are back on it. */
  function throwNow() {
    if (!canThrow) return;
    if (folded) {
      setFold(false);
      setTimeout(() => canThrow && !folded && dice?.throwFromEdge(), 420);
      return;
    }
    dice?.throwFromEdge();
  }

  function setFold(on: boolean) {
    if (side) on = false;
    clearTimeout(unfoldTimer);
    if (on === folded) return;
    if (on && dice) stripH = dice.stripHeight();
    folded = on;
    dice?.fold(on);
    if (!on) chosen = null;
  }

  /** A box tapped: chosen (and the block up), or written when it already was. */
  function pick(p: Pick, from: Element) {
    if (!canWrite) return;
    if (chosen && chosen.game === p.game && chosen.box === p.box) return write(p, from);
    chosen = p;
    setFold(true);
  }

  function write(p: Pick, from: Element) {
    if (!canWrite) return;
    chosen = null;
    pending = true;
    error = '';
    driver
      .score(p.box, p.game, from)
      .catch((e) => flash(errorText(e instanceof ApiError ? e.code : 'other')))
      .finally(() => (pending = false));
  }

  let flashTimer = 0;
  function flash(text: string) {
    error = text;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (error = ''), 3200);
  }

  function keys(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      throwNow();
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 5) onkeep(n - 1);
  }

  // ---- shaking the phone -------------------------------------------------------------------

</script>

<div
  class="table"
  class:watching={me < 0}
  class:folded
  class:side
  bind:this={tableEl}
  style:--strip-h="{stripH}px"
  style:--tray-wide={wideH && !side ? `${wideH}px` : null}
>
  <header class="band">
    <span class="app">Würfle</span>
    <span class="round">
      {#if over}{t('soloDone')}{:else if isFree(s)}{t('roundOfFree', { round: s.round, rounds: roundsOf(s) })}{:else if s.games > 1}{t('roundOf', { game: s.game + 1, games: s.games, round: s.round })}{:else}{t('roundOfOne', { round: s.round })}{/if}
    </span>
    {#if match.endsAt && !over}<Clock left={(at, now) => driver.left(at, now)} endsAt={match.endsAt} tick={myTurn} />{/if}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <ewo-settings-button onclick={onsettings}></ewo-settings-button>
  </header>

  <div class="tray">
    <canvas
      bind:this={canvas}
      tabindex="0"
      aria-label={t('throw')}
      onkeydown={keys}
    ></canvas>
    <p class="hint" class:alert={error !== ''} aria-live="polite">{error || hint}</p>
  </div>

  <div class="actions">
    <button bind:this={throwButton} class="btn primary throw" type="button" aria-disabled={!canThrow} onclick={throwNow}>{t('throw')}</button>
    <span class="left" role="img" aria-label={myTurn ? (3 - s.roll === 1 ? t('throwsLeftOne') : t('throwsLeft', { n: 3 - s.roll })) : ''}>
      {#each [0, 1, 2] as k (k)}<i class:on={!over && k < 3 - s.roll && (myTurn || s.turn >= 0)}></i>{/each}
    </span>
    {#if !side}
      <!-- After a throw of yours this is how you stop rolling: the block comes up to write a box. -->
      <button type="button" class="btn small fold" class:cobalt={!folded && canWrite} aria-expanded={folded} onclick={() => setFold(!folded)}>
        {folded ? t('foldUp') : canWrite ? t('foldWrite') : t('foldDown')}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </button>
    {/if}
  </div>

  <nav class="who" aria-label={t('blockOf', { name: '' })}>
    {#each match.people as p, seat (seat)}
      <button type="button" class="person" class:turn={!over && s.turn === seat} aria-pressed={blockSeat === seat} onclick={() => {
          shown = seat;
          // On a phone their block is under the table: it comes up.
          setFold(true);
        }}>
        {#if p.avatar}<Avatar avatar={p.avatar} size={22} ring={false} />{/if}
        <span class="name" class:gone={p.gone || !p.online}>{seat === me ? t('you') : p.name}</span>
        <b>{match.totals[seat]?.total ?? 0}</b>
      </button>
    {/each}
  </nav>

  <div class="sheet-wrap">
    <ScoreBlock state={s} seat={blockSeat} {options} {suggest} {chosen} onpick={pick} onwrite={write} ondrop={() => (chosen = null)} />
  </div>

  <div class="grand">
    <span>{blockSeat === me ? t('allGames') : t('blockOf', { name: match.people[blockSeat]?.name ?? '' })}</span>
    <b>{match.totals[blockSeat]?.total ?? 0}</b>
  </div>
</div>

<style>
  /* The screen, top to bottom: the band, the dice, the throw, the players with their totals, the block
     (which takes what's left and scrolls inside), the total. Open, the table takes all the room above
     the throw and the players' totals sit at the bottom (the user, 2026-10-20: "only show the total
     scores at the bottom and expand the full scoreboard when i press the switch button"); folded, the
     table is a strip of the dice (--strip-h) and the block and its total have the rest. The canvas keeps
     the open table's height (--tray-wide, measured) and the tray clips it, so folding never resizes
     the drawing. On a wide screen the dice go left and the block right, and nothing folds. */
  .table {
    --tray-wide: max(250px, calc(100dvh - 170px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
    --tray-h: var(--tray-wide);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
    grid-template-areas: 'band' 'tray' 'actions' 'who' 'sheet' 'grand';
    height: 100dvh;
    max-width: 560px;
    margin: 0 auto;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .table.folded {
    --tray-h: var(--strip-h);
  }
  @media (min-width: 980px) and (min-height: 620px) {
    .table {
      --tray-wide: 100%;
      --tray-h: auto;
      max-width: 1240px;
      grid-template-columns: minmax(0, 1fr) 440px;
      grid-template-rows: auto minmax(0, 1fr) auto auto;
      grid-template-areas: 'band band' 'tray sheet' 'actions who' 'actions grand';
      column-gap: 22px;
      padding: 0 22px 18px;
    }
  }

  .band {
    grid-area: band;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: calc(env(safe-area-inset-top, 0px) + 6px) 12px 6px 18px;
    background: var(--cobalt);
    color: #ffffff;
    --ewo-fg: #ffffff;
    --ewo-fg-2: #ffffff;
    --ewo-fill-2: rgb(255 255 255 / 0.14);
  }
  .app {
    font: 400 22px/1 var(--display);
  }
  .round {
    margin-left: auto;
    font: 600 14.5px/1 var(--text);
    font-variant-numeric: tabular-nums lining-nums;
    white-space: nowrap;
  }

  .tray {
    grid-area: tray;
    position: relative;
    min-height: 0;
    height: var(--tray-h);
    overflow: hidden;
    transition: height 0.44s cubic-bezier(0.3, 0.8, 0.25, 1);
  }
  .tray::after {
    content: '';
    position: absolute;
    inset: 10px 10px 8px;
    border: 1.6px solid var(--cobalt-soft);
    border-radius: 255px 18px 225px 16px / 16px 225px 18px 255px;
    pointer-events: none;
  }
  canvas {
    position: absolute;
    inset: 0 0 auto;
    display: block;
    width: 100%;
    height: var(--tray-wide);
    touch-action: none;
    cursor: grab;
    outline: none;
  }
  canvas:active {
    cursor: grabbing;
  }
  canvas:focus-visible {
    box-shadow: inset 0 0 0 2px var(--gold);
  }
  .hint {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 14px;
    margin: 0;
    text-align: center;
    font: 500 15px/1.2 var(--text);
    color: rgb(200 212 255 / 0.85);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity 0.2s;
  }
  .hint.alert {
    color: var(--gold);
    font-weight: 700;
  }
  .folded .hint:not(.alert) {
    opacity: 0;
  }

  .actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    height: 64px;
  }
  .throw {
    min-width: 150px;
    font-size: 19px;
  }
  .fold {
    gap: 6px;
    padding: 0 12px;
  }
  .fold svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: rotate 0.44s cubic-bezier(0.3, 0.8, 0.25, 1);
  }
  .folded .fold svg {
    rotate: 180deg;
  }
  .left {
    display: inline-flex;
    gap: 5px;
  }
  .left i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.6px solid var(--gold);
  }
  .left i.on {
    background: var(--gold);
  }

  .who {
    grid-area: who;
    display: flex;
    gap: 14px;
    height: 40px;
    padding: 0 16px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    font: 600 15px/1 var(--text);
    color: var(--cobalt-hi);
    -webkit-tap-highlight-color: transparent;
  }
  .person b {
    font-weight: 700;
    font-variant-numeric: tabular-nums lining-nums;
  }
  .person .gone {
    opacity: 0.55;
  }
  .person.turn .name {
    color: #ffffff;
  }
  .person[aria-pressed='true'] .name,
  .person[aria-pressed='true'] b {
    text-decoration: underline;
    text-decoration-color: var(--gold);
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
  }
  .person:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .sheet-wrap {
    grid-area: sheet;
    min-height: 0;
    padding: 0 12px;
    transition: opacity 0.3s;
  }
  .table:not(.folded, .side) .sheet-wrap {
    opacity: 0;
    pointer-events: none;
  }
  @media (min-width: 980px) and (min-height: 620px) {
    .sheet-wrap {
      padding: 14px 0 0;
    }
    .who {
      padding: 10px 0 0;
    }
  }

  .grand {
    grid-area: grand;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    height: 54px;
    margin: 0 12px;
    padding: 10px 10px 0;
    border-bottom: 3px double var(--cobalt-hi);
    overflow: hidden;
    transition:
      height 0.44s cubic-bezier(0.3, 0.8, 0.25, 1),
      padding 0.44s cubic-bezier(0.3, 0.8, 0.25, 1),
      opacity 0.3s;
  }
  .table:not(.folded, .side) .grand {
    height: 0;
    padding-top: 0;
    border-bottom-width: 0;
    opacity: 0;
  }
  .grand span {
    font: 700 12.5px/1 var(--text);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--cobalt-hi);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grand b {
    font: 400 28px/1 var(--display);
    color: var(--gold);
    font-variant-numeric: tabular-nums lining-nums;
  }
</style>
