<!--
  The block, as on paper: the boxes down the side, one column per game of the match (1 to 6, the
  host's choice), the sums where the paper block has them. The current game's column is tinted; while
  you may write, its open boxes show in pencil what the dice would score there. A tap chooses a box; the
  gold bubble beside it (or a second tap) writes it, a tap anywhere else in the block or × lets it go
  (the user, after their iPhone test, 2026-10-19: "a confirm floating button ... next to it").
  The header stays while the rows scroll (the table keeps its height: everything else on the screen
  is fixed, learnings/projects/stichle.md "the table never moves").
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { isFree, sheet } from '../../server/rules.mjs';
  import { LOWER, UPPER, type BoxId, type GameSheet, type MatchState } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { prefs } from '../lib/prefs.svelte';
  import DieGlyph from './DieGlyph.svelte';

  let {
    state: st,
    seat,
    options = null,
    suggest = null,
    chosen = null,
    onpick,
    onwrite,
    ondrop,
  }: {
    state: MatchState;
    seat: number;
    /** What you may write now and what it scores; null when you may not. */
    /** Every box you may write now, column by column; null when you may not. */
    options?: { game: number; box: BoxId; points: number }[] | null;
    suggest?: { game: number; box: BoxId } | null;
    /** The box tapped, waiting for its ✓. */
    chosen?: { game: number; box: BoxId } | null;
    onpick?: (pick: { game: number; box: BoxId }, from: Element) => void;
    onwrite?: (pick: { game: number; box: BoxId }, from: Element) => void;
    ondrop?: () => void;
  } = $props();

  const columns = $derived(Array.from({ length: st.games }, (_, g) => g));
  const boxes = $derived(st.boxes[seat] ?? []);
  /** Each column's sums, as the rules add them (the bonus, the five-alikes' extra). */
  const games = $derived(columns.map((g) => sheet(st, seat, g) as GameSheet));
  const anyExtra = $derived(games.some((g) => g.extra > 0));
  const done = $derived(st.phase === 'done');

  const label = (box: BoxId) => t(`box_${box}` as Parameters<typeof t>[0]);
  const face: Partial<Record<BoxId, number>> = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
  /** The paper block's pencilled "+4" and "−3": a written upper box against three of its number. */
  const signed = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '');
  const par = (box: BoxId, v: number) => signed(v - 3 * face[box]!);
  /** The upper boxes written so far in a column, against three of each: where it stands for the 63. */
  /**
   * Whether a mark fits beside its number (which stays centred) in a column this wide; if not, it
   * goes small into the cell's top corner. Widths measured in WebKit: Young Serif digits 9.2 px at
   * 17 px (8.8 at the sum's 15.5), a crossed-out box's line 22 px, Karla's marks about 3.6 px a glyph.
   */
  let blockW = $state(0);
  const colW = $derived(blockW > 0 ? (blockW - 120) / columns.length : 120);
  const beside = (numW: number, mark: string) => numW / 2 + 3 + 3.6 * (mark.length + 1) <= colW / 2 - 2;
  const boxW = (v: number) => (v === 0 ? 22 : String(v).length * 9.2);
  const standing = (g: number) => {
    const written = UPPER.filter((b) => boxes[g]?.[b] !== undefined);
    return written.length && written.length < 6 ? written.reduce((n, b) => n + boxes[g][b]! - 3 * face[b]!, 0) : null;
  };
  const writeLabel = (box: BoxId, n: number) => (n === 0 ? t('scratchBox', { box: label(box) }) : t('writeBox', { box: label(box), n }));

  // ---- the bubble ----------------------------------------------------------------------------

  let blockEl: HTMLDivElement | undefined = $state();
  let bubble: HTMLDivElement | undefined = $state();
  /** column → box → points, for what may be written now. */
  const can = $derived.by(() => {
    const out: Partial<Record<BoxId, number>>[] = columns.map(() => ({}));
    for (const o of options ?? []) out[o.game][o.box] = o.points;
    return out;
  });
  /** The chosen box, while it may be written. */
  const open = $derived(chosen && can[chosen.game]?.[chosen.box] !== undefined ? chosen : null);
  const isOpen = (g: number, box: BoxId) => open !== null && open.game === g && open.box === box;
  /** The columns being played: the game's own, or under the house rule every one still open. */
  const free = $derived(isFree(st));
  const live = (g: number) => !done && (free ? Object.keys(boxes[g] ?? {}).length < 13 : g === st.game);
  let at = $state({ left: 0, top: 0, ax: 0, above: false, ready: false });

  /**
   * The bubble under the chosen box, centred on it, or above it near the block's bottom edge; with
   * `reveal`, the block scrolls so the box and its bubble show (below the header that stays).
   */
  function place(reveal: boolean) {
    const b = blockEl;
    const el = bubble;
    const c = b?.querySelector<HTMLElement>('.cand.chosen');
    if (!b || !el || !c) return;
    const head = b.querySelector('thead')?.getBoundingClientRect().height ?? 30;
    let br = b.getBoundingClientRect();
    let cr = c.getBoundingClientRect();
    const h = el.offsetHeight;
    if (reveal) {
      const top = cr.top - br.top + b.scrollTop;
      if (top - head - 6 < b.scrollTop) b.scrollTop = top - head - 6;
      else if (top + cr.height + h + 14 > b.scrollTop + b.clientHeight) b.scrollTop = Math.min(top + cr.height + h + 14 - b.clientHeight, top - head - 6);
      br = b.getBoundingClientRect();
      cr = c.getBoundingClientRect();
    }
    const top = cr.top - br.top + b.scrollTop;
    const cx = cr.left - br.left + b.scrollLeft + cr.width / 2;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(6, cx - w / 2), b.clientWidth - w - 6);
    let y = top + cr.height + 8;
    const above = y + h > b.scrollTop + b.clientHeight - 4;
    if (above) y = top - h - 8;
    at = { left, top: y, ax: cx - left, above, ready: true };
  }

  $effect(() => {
    if (!open || !bubble) return;
    place(true);
  });

  onMount(() => {
    // The block grows as the table folds down: the box stays in view, the bubble with it.
    const ro = new ResizeObserver(() => open && place(true));
    if (blockEl) ro.observe(blockEl);
    return () => ro.disconnect();
  });

  function onblockclick(e: MouseEvent) {
    if (!(e.target as Element).closest('button')) ondrop?.();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="block"
  tabindex="-1"
  role="region"
  aria-label={t('gameCol')}
  bind:this={blockEl}
  bind:clientWidth={blockW}
  onclick={onblockclick}
  onkeydown={(e) => e.key === 'Escape' && ondrop?.()}
  onscroll={() => open && place(false)}
>
  <table>
    <colgroup>
      <col class="lbl" />
      {#each columns as g (g)}<col />{/each}
    </colgroup>
    <thead>
      <tr>
        <th scope="col" class="corner">{t('gameCol')}</th>
        {#each columns as g (g)}<th scope="col" class:cur={live(g)}>{g + 1}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#snippet row(box: BoxId)}
        <tr>
          <th scope="row" class="lbl" class:chosen={open?.box === box}>
            {#if face[box]}<DieGlyph value={face[box]!} />{/if}
            <span>{label(box)}</span>
          </th>
          {#each columns as g (g)}
            {@const v = boxes[g]?.[box]}
            {@const pts = can[g]?.[box]}
            {@const m = v !== undefined && prefs.marks && face[box] ? par(box, v) : ''}
            {@const side = m !== '' && beside(boxW(v!), m)}
            <td class:cur={live(g)}>
              {#if v !== undefined}
                <span class="v" class:zero={v === 0}
                  >{v}{#if side}<span class="par side" class:up={v > 3 * face[box]!} aria-hidden="true">{m}</span>{/if}</span
                >
                {#if m && !side}<span class="par corner" class:up={v > 3 * face[box]!} aria-hidden="true">{m}</span>{/if}
              {:else if pts !== undefined}
                {@const n = pts}
                <button
                  type="button"
                  class="cand"
                  class:nil={n === 0}
                  class:hint={suggest?.game === g && suggest?.box === box}
                  class:chosen={isOpen(g, box)}
                  aria-pressed={isOpen(g, box)}
                  aria-label={columns.length > 1 ? `${writeLabel(box, n)} · ${t('gameCol')} ${g + 1}` : writeLabel(box, n)}
                  onclick={(e) => onpick?.({ game: g, box }, e.currentTarget)}>{n}</button
                >
              {/if}
            </td>
          {/each}
        </tr>
      {/snippet}
      {#snippet sum(name: string, pick: (i: number) => string | number | null, cls = '', marks = false)}
        <tr class="sum {cls}">
          <th scope="row" class="lbl">{name}</th>
          {#each columns as g (g)}
            {@const v = pick(g)}
            {@const m = marks && prefs.marks ? standing(g) : null}
            {@const side = Boolean(m) && v !== null && beside(String(v).length * 8.8, signed(m!))}
            <td class:cur={live(g)}
              >{#if v !== null}<span class="n"
                  >{v}{#if m && side}<span class="par side" class:up={m > 0} aria-hidden="true">{signed(m)}</span>{/if}</span
                >{/if}{#if m && !side}<span class="par corner" class:up={m > 0} aria-hidden="true">{signed(m)}</span>{/if}</td
            >
          {/each}
        </tr>
      {/snippet}

      {#each UPPER as box (box)}{@render row(box)}{/each}
      {@render sum(t('sumUp'), (g) => (UPPER.some((b) => boxes[g]?.[b] !== undefined) ? (games[g]?.up ?? null) : null), '', true)}
      {@render sum(t('sumBonus'), (g) => (games[g]?.bonus == null ? null : games[g].bonus ? '+35' : '0'), 'bonus')}
      {@render sum(t('sumTop'), (g) => (UPPER.some((b) => boxes[g]?.[b] !== undefined) ? (games[g]?.top ?? null) : null))}
      {#each LOWER as box (box)}{@render row(box)}{/each}
      {@render sum(t('sumLow'), (g) => (LOWER.some((b) => boxes[g]?.[b] !== undefined) ? (games[g]?.low ?? null) : null))}
      {#if anyExtra}{@render sum(t('sumExtra'), (g) => (games[g]?.extra ? `+${games[g].extra}` : null), 'bonus')}{/if}
      {@render sum(t('sumGame'), (g) => (Object.keys(boxes[g] ?? {}).length ? (games[g]?.total ?? null) : null), 'total')}
    </tbody>
  </table>
  {#if open}
    {@const n = can[open.game][open.box]!}
    <div
      class="confirm"
      class:above={at.above}
      class:ready={at.ready}
      bind:this={bubble}
      style:left="{at.left}px"
      style:top="{at.top}px"
      style:--ax="{at.ax}px"
    >
      <button type="button" class="ok" aria-label={writeLabel(open.box, n)} onclick={(e) => onwrite?.(open, e.currentTarget)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>{t('write')}
      </button>
      <button type="button" class="x" aria-label={t('dropBox')} onclick={() => ondrop?.()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .block {
    position: relative;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--night-2);
    border: 1.5px solid var(--cobalt-hi);
    border-radius: 3px;
    box-shadow: 0 2px 0 var(--cobalt-soft);
    -webkit-overflow-scrolling: touch;
    outline: none;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    font-variant-numeric: tabular-nums lining-nums;
  }
  col.lbl {
    width: 118px;
  }
  th,
  td {
    height: 31px;
    padding: 0;
    border-bottom: 1px solid var(--rule);
    text-align: center;
  }
  td,
  thead th + th {
    border-left: 1px solid var(--rule);
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 30px;
    background: var(--night-2);
    color: var(--cobalt-hi);
    font: 700 12px/1 var(--text);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border-bottom: 1.5px solid var(--cobalt-hi);
  }
  thead th.cur {
    background: var(--cobalt);
    color: #ffffff;
  }
  thead .corner {
    text-align: left;
    padding-left: 10px;
  }
  th.lbl {
    padding-left: 10px;
    text-align: left;
    font: 500 15.5px/1 var(--text);
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
  }
  th.lbl,
  th.lbl span {
    text-overflow: ellipsis;
  }
  tbody th.lbl {
    display: flex;
    align-items: center;
    gap: 6px;
    border-left: 0;
  }
  /* The numbers on their own line, not on the cell's Karla line: their middle is the cell's. */
  td {
    position: relative;
    line-height: 0;
  }
  td.cur {
    background: rgb(143 165 255 / 0.09);
  }
  .v {
    display: inline-block;
    vertical-align: top;
    font: 400 17px/1 var(--display);
    color: #ffffff;
  }
  /* Crossed out: the line alone (the user, 2026-10-20: "the line is enough"); the 0 stays for screen
     readers, unseen. */
  .v.zero {
    position: relative;
    color: transparent;
  }
  .v.zero::after {
    content: '';
    position: absolute;
    left: -6px;
    right: -6px;
    top: 50%;
    height: 2px;
    border-radius: 2px;
    background: var(--gold);
    transform: rotate(-16deg);
  }
  /* The pencilled mark, small and faint: ahead in green, behind in red. Beside the number, which
     stays centred (the user, 2026-10-20); where the column is too narrow, small in the cell's top
     corner, above the number. */
  .par {
    position: absolute;
    font: 600 9.5px/1 var(--text);
    font-variant-numeric: tabular-nums lining-nums;
    letter-spacing: 0.01em;
    color: var(--bad);
    opacity: 0.75;
    white-space: nowrap;
    pointer-events: none;
  }
  .par.up {
    color: var(--good);
  }
  .par.side {
    left: 100%;
    top: 50%;
    margin-left: 3px;
    translate: 0 -50%;
  }
  /* A crossed-out box's line reaches 6 px past its 0. */
  .zero .par.side {
    margin-left: 9px;
  }
  .par.corner {
    top: 2px;
    right: 2px;
    font-size: 8.5px;
  }
  .v,
  .n {
    position: relative;
  }
  .cand {
    position: absolute;
    inset: 0;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    font: 400 17px/1 var(--display);
    color: var(--cobalt-hi);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .cand.nil {
    color: rgb(143 165 255 / 0.42);
  }
  .cand.hint {
    color: var(--gold);
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
  }
  .cand.chosen {
    color: var(--gold);
    background: rgb(240 199 94 / 0.14);
    box-shadow: inset 0 0 0 2px var(--gold);
  }
  th.lbl.chosen {
    color: var(--gold);
  }
  .cand:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -3px;
  }

  /* The ✓ for the chosen box: gold, like the throw, pointing at its box. */
  .confirm {
    position: absolute;
    z-index: 2;
    display: inline-flex;
    align-items: stretch;
    border-radius: 10px;
    background: var(--gold);
    color: var(--gold-ink);
    box-shadow: 0 3px 0 var(--gold-deep), 0 14px 26px -8px rgb(0 0 0 / 0.75);
    visibility: hidden;
  }
  .confirm.ready {
    visibility: visible;
    animation: pop 0.2s cubic-bezier(0.3, 0.8, 0.25, 1) both;
  }
  .confirm::before {
    content: '';
    position: absolute;
    left: calc(var(--ax) - 7px);
    top: -6px;
    width: 14px;
    height: 14px;
    border-radius: 2px;
    background: var(--gold);
    rotate: 45deg;
  }
  .confirm.above::before {
    top: auto;
    bottom: -6px;
  }
  .confirm button {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .confirm .ok {
    gap: 7px;
    padding: 0 14px;
    font: 400 16px/1 var(--display);
    white-space: nowrap;
  }
  .confirm .x {
    padding: 0 12px;
    border-left: 1px solid rgb(26 20 4 / 0.22);
  }
  .confirm svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .confirm button:focus-visible {
    outline: 3px solid var(--night);
    outline-offset: -4px;
    border-radius: 8px;
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.9;
    }
  }
  @media (hover: hover) {
    .cand:hover {
      background: rgb(143 165 255 / 0.14);
    }
  }
  .sum th.lbl {
    font: 700 11.5px/1 var(--text);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--cobalt-hi);
  }
  .sum td,
  .sum th {
    background-color: rgb(143 165 255 / 0.04);
  }
  .sum td.cur {
    background-color: rgb(143 165 255 / 0.12);
  }
  .n {
    display: inline-block;
    vertical-align: top;
    font: 400 15.5px/1 var(--display);
    color: var(--ink);
  }
  .bonus .n {
    color: var(--gold);
  }
  /* The double rule under the total takes 3 px at the bottom: as much on top keeps the number centred. */
  .total td,
  .total th {
    padding-top: 3px;
    border-bottom: 3px double var(--cobalt-hi);
  }
</style>
