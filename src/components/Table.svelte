<!--
  The table: the printed band (the round, the clock, Settings), the dice on the night block
  (src/lib/dice.ts), the throw button with the throws left, the players' totals, and the block
  (ScoreBlock.svelte). The same for a room and a solo game: a MatchView to show, a Driver to ask.

  Nothing above or below the block changes height while you play, so the table never moves under a
  finger (learnings/projects/stichle.md); what changes is the hint over the dice and the block's
  pencil.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { options as allowed, sheet, suggest as suggestion } from '../../server/rules.mjs';
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
  const options = $derived(canWrite && blockSeat === me ? (allowed(s, me) as Partial<Record<BoxId, number>>) : null);
  const suggest = $derived(options && prefs.hint ? (suggestion(s, me) as BoxId) : null);
  const turnName = $derived(match.people[s.turn]?.name ?? '');

  const hint = $derived.by(() => {
    if (over) return '';
    if (me < 0) return t('hintTheirs', { name: turnName });
    if (match.autopilot >= 0) return match.autopilot === me ? t('hintAutoYou') : t('hintAuto', { name: turnName });
    if (s.turn !== me) return t('hintTheirs', { name: turnName });
    if (s.roll === 0) return prefs.shake && motionReady ? t('hintFirstShake') : t('hintFirst');
    if (s.roll >= 3) return t('hintWrite');
    const n = 3 - s.roll;
    return n === 1 ? t('hintKeepOne') : t('hintKeep', { n });
  });

  // ---- the dice table ----------------------------------------------------------------------

  let gone = false;
  onMount(() => {
    unlockOnGesture();
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
      },
      });
      ready = true;
    });
    return () => {
      gone = true;
      dice?.destroy();
      dice = null;
      stopMotion();
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

  // A new turn: nothing kept, the dice back on the table; your turn has its sound.
  let turnKey = '';
  $effect(() => {
    const key = `${match.id}:${s.game}:${s.round}:${s.turn}`;
    if (key === turnKey) return;
    const first = turnKey === '';
    turnKey = key;
    if (s.roll === 0) {
      mine = [...NONE];
      if (!first) dice?.setHeld(NONE);
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

  function throwNow() {
    if (!canThrow) return;
    dice?.throwFromEdge();
  }

  function write(box: BoxId, from: Element) {
    if (!canWrite) return;
    pending = true;
    error = '';
    driver
      .score(box, from)
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

  let motionReady = $state(false);
  let motionAsked = false;
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (a && a.x !== null) dice?.motion(a.x ?? 0, a.y ?? 0, a.z ?? 0);
  };
  function startMotion() {
    if (motionReady) return;
    addEventListener('devicemotion', onMotion);
    motionReady = true;
  }
  function stopMotion() {
    removeEventListener('devicemotion', onMotion);
    motionReady = false;
  }
  /** iOS asks for motion once, and only from a tap; elsewhere it just starts. */
  function askMotion() {
    if (!prefs.shake || motionReady || motionAsked || typeof DeviceMotionEvent === 'undefined') return;
    const ask = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    motionAsked = true;
    if (!ask) return startMotion();
    ask().then((answer) => answer === 'granted' && startMotion(), () => {});
  }
  $effect(() => {
    if (!prefs.shake) stopMotion();
    else if (typeof DeviceMotionEvent !== 'undefined' && !('requestPermission' in DeviceMotionEvent)) startMotion();
  });
</script>

<div class="table" class:watching={me < 0}>
  <header class="band">
    <span class="app">Würfle</span>
    <span class="round">
      {#if over}{t('soloDone')}{:else if s.games > 1}{t('roundOf', { game: s.game + 1, games: s.games, round: s.round })}{:else}{t('roundOfOne', { round: s.round })}{/if}
    </span>
    {#if match.endsAt && !over}<Clock left={(at, now) => driver.left(at, now)} endsAt={match.endsAt} tick={myTurn} />{/if}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <ewo-settings-button onclick={onsettings}></ewo-settings-button>
  </header>

  <!-- The first tap at the table is iOS's moment to ask for motion (shaking to roll). -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tray" ontouchend={askMotion} onpointerup={askMotion}>
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
  </div>

  <nav class="who" aria-label={t('blockOf', { name: '' })}>
    {#each match.people as p, seat (seat)}
      <button type="button" class="person" class:turn={!over && s.turn === seat} aria-pressed={blockSeat === seat} onclick={() => (shown = seat)}>
        {#if p.avatar}<Avatar avatar={p.avatar} size={22} ring={false} />{/if}
        <span class="name" class:gone={p.gone || !p.online}>{seat === me ? t('you') : p.name}</span>
        <b>{match.totals[seat]?.total ?? 0}</b>
      </button>
    {/each}
  </nav>

  <div class="sheet-wrap">
    <ScoreBlock state={s} seat={blockSeat} {options} {suggest} onwrite={write} />
  </div>

  <div class="grand">
    <span>{blockSeat === me ? t('allGames') : t('blockOf', { name: match.people[blockSeat]?.name ?? '' })}</span>
    <b>{match.totals[blockSeat]?.total ?? 0}</b>
  </div>
</div>

<style>
  /* The screen, top to bottom: the band, the dice, the throw, the players, the block (which takes what's
     left and scrolls inside), the total. On a wide screen the dice go left and the block right. */
  .table {
    --tray-h: clamp(250px, 38dvh, 360px);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto var(--tray-h) auto auto minmax(0, 1fr) auto;
    grid-template-areas: 'band' 'tray' 'actions' 'who' 'sheet' 'grand';
    height: 100dvh;
    max-width: 560px;
    margin: 0 auto;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  @media (min-width: 980px) and (min-height: 620px) {
    .table {
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
    font: 700 21px/1 var(--print);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .round {
    margin-left: auto;
    font: 600 15px/1 var(--print);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-variant-numeric: tabular-nums lining-nums;
    white-space: nowrap;
  }

  .tray {
    grid-area: tray;
    position: relative;
    min-height: 0;
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
    display: block;
    width: 100%;
    height: 100%;
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
    font: 400 16px/1.2 var(--hand);
    color: rgb(200 212 255 / 0.85);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint.alert {
    color: var(--gold);
    font-weight: 700;
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
    min-width: 170px;
    font-size: 19px;
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
    font: 400 16px/1 var(--hand);
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
  }
  .grand span {
    font: 700 16px/1 var(--print);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--cobalt-hi);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grand b {
    font: 700 30px/1 var(--hand);
    color: var(--gold);
    font-variant-numeric: tabular-nums lining-nums;
  }
</style>
