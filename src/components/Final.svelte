<!--
  The end of a match: who won, everyone's total, and with more than one game each game's total as
  on the block's bottom line. Below it, what comes next: at a table the host plays again or goes
  back to the lobby (the actions, from Game.svelte); alone, another game or home (Solo.svelte).
  From Stammtisch's Final.svelte.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { names, t } from '../lib/i18n.svelte';
  import type { MatchView } from '../lib/match';
  import Avatar from './Avatar.svelte';

  let { match, note = '', best = false, actions }: { match: MatchView; note?: string; best?: boolean; actions: Snippet } = $props();

  const nameAt = (seat: number) => (seat === match.me ? t('you') : (match.people[seat]?.name ?? '?'));
  const played = $derived(match.totals.some((x) => x.total > 0));
  const winners = $derived(played ? match.standings.filter((s) => s.place === 1) : []);
  const top = $derived(winners[0]?.total ?? 0);
  const games = $derived(match.state.games);
</script>

<div class="final">
  <section class="sheet head">
    {#if note}<span class="label early">{note}</span>{/if}
    {#if winners.length}
      <div class="crown">
        {#each winners as w (w.seat)}
          {@const p = match.people[w.seat]}
          {#if p?.avatar}<Avatar avatar={p.avatar} size={64} />{/if}
        {/each}
      </div>
      <h1 class="display">
        {#if match.people.length === 1}{t('soloDone')}{:else if winners.length > 1}{t('winnersAre', { names: names(winners.map((w) => nameAt(w.seat))) })}{:else if winners[0].seat === match.me}{t('youWin')}{:else}{t('winnerIs', { name: nameAt(winners[0].seat) })}{/if}
      </h1>
      <p class="points">{t('withPoints', { n: top })}</p>
      {#if best}<p class="best">{t('newBest')}</p>{/if}
    {/if}

    <table class="standings">
      {#if games > 1}
        <thead>
          <tr>
            <th></th>
            <th></th>
            {#each { length: games } as _, g (g)}<th class="g">{g + 1}</th>{/each}
            <th class="sum">{t('allGames')}</th>
          </tr>
        </thead>
      {/if}
      <tbody>
        {#each match.standings as s (s.seat)}
          {@const p = match.people[s.seat]}
          <tr class:me={s.seat === match.me}>
            <td class="place">{t('place', { n: s.place })}</td>
            <td class="who">
              {#if p?.avatar}<Avatar avatar={p.avatar} size={24} ring={false} />{/if}
              <span>{nameAt(s.seat)}</span>
            </td>
            {#if games > 1}
              {#each match.totals[s.seat]?.games ?? [] as n, g (g)}<td class="g">{n}</td>{/each}
            {/if}
            <td class="sum">{s.total}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <div class="actions">
    {@render actions()}
  </div>
</div>

<style>
  .final {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 520px;
    margin: 14px auto 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px 18px 18px;
    text-align: center;
  }
  .early {
    color: var(--bad);
  }
  .crown {
    display: flex;
    gap: 6px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    line-height: 1.1;
    text-wrap: balance;
    color: #ffffff;
  }
  .points {
    margin: 0;
    font: 700 22px/1.2 var(--hand);
    color: var(--gold);
  }
  .best {
    margin: 0;
    padding: 4px 10px 2px;
    border: 1.6px solid var(--gold);
    border-radius: 4px;
    font: 700 15px/1.2 var(--print);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--gold);
    rotate: -3deg;
  }
  .standings {
    width: 100%;
    margin-top: 6px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums lining-nums;
  }
  th {
    padding: 0 4px 6px;
    font: 700 13px/1 var(--print);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--cobalt-hi);
    border-bottom: 1.5px solid var(--cobalt-hi);
  }
  td {
    height: 40px;
    padding: 0 4px;
    border-bottom: 1px solid var(--rule);
  }
  tr.me td {
    background: rgb(143 165 255 / 0.08);
  }
  .place {
    width: 28px;
    font: 700 16px/1 var(--print);
    color: var(--cobalt-hi);
    text-align: center;
  }
  .who {
    text-align: left;
  }
  .who :global(ewo-emblem) {
    vertical-align: middle;
    margin-right: 6px;
  }
  .who span {
    font: 700 18px/1 var(--hand);
    color: var(--ink);
  }
  .g {
    width: 40px;
    text-align: center;
    font: 400 17px/1 var(--hand);
    color: var(--ink-2);
  }
  th.g {
    font: 700 13px/1 var(--print);
    color: var(--cobalt-hi);
  }
  .sum {
    width: 64px;
    text-align: right;
    font: 700 21px/1 var(--hand);
    color: var(--gold);
  }
  th.sum {
    font: 700 12px/1 var(--print);
    color: var(--cobalt-hi);
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .actions :global(.btn) {
    width: 100%;
  }
  .actions :global(.btn.quiet) {
    width: auto;
  }
</style>
