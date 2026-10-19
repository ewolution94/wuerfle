<!--
  The block, as on paper: the boxes down the side, one column per game of the match (1 to 6, the
  host's choice), the sums where the paper block has them. The current game's column is tinted; while
  you may write, its open boxes show in pencil what the dice would score there, and a tap writes it.
  The header stays while the rows scroll (the table keeps its height: everything else on the screen
  is fixed, learnings/projects/stichle.md "the table never moves").
-->
<script lang="ts">
  import { sheet } from '../../server/rules.mjs';
  import { LOWER, UPPER, type BoxId, type GameSheet, type MatchState } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import DieGlyph from './DieGlyph.svelte';

  let {
    state,
    seat,
    options = null,
    suggest = null,
    onwrite,
  }: {
    state: MatchState;
    seat: number;
    /** What you may write now and what it scores; null when you may not. */
    options?: Partial<Record<BoxId, number>> | null;
    suggest?: BoxId | null;
    onwrite?: (box: BoxId, from: Element) => void;
  } = $props();

  const columns = $derived(Array.from({ length: state.games }, (_, g) => g));
  const boxes = $derived(state.boxes[seat] ?? []);
  /** Each column's sums, as the rules add them (the bonus, the five-alikes' extra). */
  const games = $derived(columns.map((g) => sheet(state, seat, g) as GameSheet));
  const anyExtra = $derived(games.some((g) => g.extra > 0));
  const done = $derived(state.phase === 'done');

  const label = (box: BoxId) => t(`box_${box}` as Parameters<typeof t>[0]);
  const face: Partial<Record<BoxId, number>> = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
</script>

<div class="block" tabindex="-1">
  <table>
    <colgroup>
      <col class="lbl" />
      {#each columns as g (g)}<col />{/each}
    </colgroup>
    <thead>
      <tr>
        <th scope="col" class="corner">{t('gameCol')}</th>
        {#each columns as g (g)}<th scope="col" class:cur={g === state.game && !done}>{g + 1}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#snippet row(box: BoxId)}
        <tr>
          <th scope="row" class="lbl">
            {#if face[box]}<DieGlyph value={face[box]!} />{/if}
            <span>{label(box)}</span>
          </th>
          {#each columns as g (g)}
            {@const v = boxes[g]?.[box]}
            {@const can = g === state.game && options && options[box] !== undefined}
            <td class:cur={g === state.game && !done}>
              {#if v !== undefined}
                <span class="v" class:zero={v === 0}>{v}</span>
              {:else if can}
                {@const n = options![box]!}
                <button
                  type="button"
                  class="cand"
                  class:nil={n === 0}
                  class:hint={suggest === box}
                  aria-label={n === 0 ? t('scratchBox', { box: label(box) }) : t('writeBox', { box: label(box), n })}
                  onclick={(e) => onwrite?.(box, e.currentTarget)}>{n}</button
                >
              {/if}
            </td>
          {/each}
        </tr>
      {/snippet}
      {#snippet sum(name: string, pick: (i: number) => string | number | null, cls = '')}
        <tr class="sum {cls}">
          <th scope="row" class="lbl">{name}</th>
          {#each columns as g (g)}
            {@const v = pick(g)}
            <td class:cur={g === state.game && !done}>{#if v !== null}<span class="n">{v}</span>{/if}</td>
          {/each}
        </tr>
      {/snippet}

      {#each UPPER as box (box)}{@render row(box)}{/each}
      {@render sum(t('sumUp'), (g) => (UPPER.some((b) => boxes[g]?.[b] !== undefined) ? (games[g]?.up ?? null) : null))}
      {@render sum(t('sumBonus'), (g) => (games[g]?.bonus == null ? null : games[g].bonus ? '+35' : '0'), 'bonus')}
      {@render sum(t('sumTop'), (g) => (UPPER.some((b) => boxes[g]?.[b] !== undefined) ? (games[g]?.top ?? null) : null))}
      {#each LOWER as box (box)}{@render row(box)}{/each}
      {@render sum(t('sumLow'), (g) => (LOWER.some((b) => boxes[g]?.[b] !== undefined) ? (games[g]?.low ?? null) : null))}
      {#if anyExtra}{@render sum(t('sumExtra'), (g) => (games[g]?.extra ? `+${games[g].extra}` : null), 'bonus')}{/if}
      {@render sum(t('sumGame'), (g) => (Object.keys(boxes[g] ?? {}).length ? (games[g]?.total ?? null) : null), 'total')}
    </tbody>
  </table>
</div>

<style>
  .block {
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
    font: 700 13px/1 var(--print);
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
    font: 500 16px/1 var(--print);
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
  td {
    position: relative;
  }
  td.cur {
    background: rgb(143 165 255 / 0.09);
  }
  .v {
    font: 700 19px/1 var(--hand);
    color: #ffffff;
  }
  .v.zero {
    position: relative;
    color: var(--gold);
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
  .cand {
    position: absolute;
    inset: 0;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    font: 400 19px/1 var(--hand);
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
  .cand:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: -3px;
  }
  @media (hover: hover) {
    .cand:hover {
      background: rgb(143 165 255 / 0.14);
    }
  }
  .sum th.lbl {
    font: 700 13px/1 var(--print);
    letter-spacing: 0.1em;
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
    font: 700 16px/1 var(--print);
    color: var(--ink);
  }
  .bonus .n {
    color: var(--gold);
  }
  .total td,
  .total th {
    border-bottom: 3px double var(--cobalt-hi);
  }
</style>
