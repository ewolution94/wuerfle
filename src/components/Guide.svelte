<!--
  How to play, as full-screen pages: Folio's <ewo-guide> brings the frame (swipe, the dots, Back and
  Next, Done); each page has a small picture drawn with the game's own dice and the block. Opens once
  on a device's first visit (Home), and from the start page, the lobby and Settings.
-->
<script lang="ts">
  import { t, type Key } from '../lib/i18n.svelte';
  import { ui } from '../lib/ui.svelte';
  import DieGlyph from './DieGlyph.svelte';

  const close = () => (ui.guide = false);
  const pages = [1, 2, 3, 4, 5, 6];
</script>

<ewo-guide
  open={ui.guide}
  label={t('guideTitle')}
  next-label={t('guideNext')}
  back-label={t('guideBack')}
  skip-label={t('guideSkip')}
  done-label={t('guideDone')}
  oncancel={close}
  onclose={close}
>
  {#each pages as n (n)}
    <section class="page">
      <div class="art" aria-hidden="true">
        {#if n === 1}
          <div class="scatter">
            {#each [[5, -14, -8], [3, 10, 12], [6, -4, 30], [2, 22, -10], [4, 34, 18]] as [v, r, y], k (k)}
              <span style:rotate="{r}deg" style:translate="0 {y}px"><DieGlyph value={v} size={46} /></span>
            {/each}
          </div>
          <svg class="flick" viewBox="0 0 120 40"><path d="M6 32 C 40 30, 70 18, 110 6" /><path d="M96 4 L110 6 L102 18" /></svg>
        {:else if n === 2}
          <div class="rail">
            {#each [5, 5, 5] as v, k (k)}<span class="kept"><DieGlyph value={v} size={44} /></span>{/each}
          </div>
          <div class="loose">
            <span style:rotate="-12deg"><DieGlyph value={2} size={40} /></span>
            <span style:rotate="9deg"><DieGlyph value={6} size={40} /></span>
          </div>
        {:else if n === 3}
          <div class="mini">
            <span class="lbl">{t('box_full')}</span><span class="pencil">25</span>
            <span class="lbl">{t('box_large')}</span><span class="zero">0</span>
          </div>
        {:else if n === 4}
          <div class="row">
            {#each [4, 4, 4, 1, 6] as v, k (k)}<span class:dim={k > 2}><DieGlyph value={v} size={40} /></span>{/each}
          </div>
          <p class="tag">{t('box_fours')} 12 · 63 → +35</p>
        {:else if n === 5}
          <div class="row">
            {#each [1, 2, 3, 4, 5] as v (v)}<DieGlyph value={v} size={40} />{/each}
          </div>
          <p class="tag">{t('box_large')} 40</p>
        {:else}
          <div class="cols">
            {#each [1, 2, 3, 4, 5, 6] as g (g)}<span class:cur={g === 2}>{g}</span>{/each}
          </div>
        {/if}
      </div>
      <h2 class="display">{t(`guide${n}Title` as Key)}</h2>
      <p>{t(`guide${n}Text` as Key)}</p>
    </section>
  {/each}
</ewo-guide>

<style>
  /* The guide on the night block: the grid behind, printed headings, the main button gold. */
  ewo-guide {
    --ewo-guide-bg: linear-gradient(rgb(143 165 255 / 0.07) 1px, transparent 1px) 0 0 / 16px 16px, linear-gradient(90deg, rgb(143 165 255 / 0.07) 1px, transparent 1px) 0 0 / 16px 16px, #0b1029;
    --ewo-guide-fg: var(--ink);
    --ewo-guide-fg-2: var(--ink-2);
    --ewo-guide-accent: var(--gold);
    --ewo-guide-accent-ink: var(--gold-ink);
    --ewo-guide-dot: rgb(143 165 255 / 0.5);
    --ewo-guide-dot-on: var(--gold);
  }
  ewo-guide::part(next) {
    border-radius: 6px;
    box-shadow: 0 3px 0 var(--gold-deep);
    font: 400 17px/1 var(--display);
  }
  .page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 12px 28px 8px;
    text-align: center;
  }
  h2 {
    margin: 8px 0 0;
    font-size: 28px;
    color: #ffffff;
  }
  p {
    margin: 0;
    max-width: 36ch;
    font-size: 16px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  .art {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    width: min(320px, 100%);
    min-height: 170px;
  }
  .scatter,
  .row,
  .loose,
  .rail {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
  }
  .flick {
    width: 120px;
    height: 40px;
    fill: none;
    stroke: var(--gold);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .rail {
    padding-bottom: 10px;
    border-bottom: 3px solid var(--cobalt-hi);
  }
  .kept {
    padding: 5px;
    border: 2.5px solid var(--gold);
    border-radius: 50%;
  }
  .dim {
    opacity: 0.4;
  }
  .mini {
    display: grid;
    grid-template-columns: 1fr 60px;
    width: 230px;
    border: 1.5px solid var(--cobalt-hi);
    background: var(--night-2);
  }
  .mini > span {
    padding: 8px 10px;
    border-bottom: 1px solid var(--rule);
  }
  .lbl {
    text-align: left;
    font: 500 15.5px/1 var(--text);
    color: var(--ink-2);
  }
  .pencil,
  .zero {
    font: 400 20px/1 var(--display);
    color: var(--cobalt-hi);
    border-left: 1px solid var(--rule);
    background: rgb(143 165 255 / 0.09);
  }
  .zero {
    color: var(--gold);
    text-decoration: line-through;
    text-decoration-thickness: 2px;
  }
  .tag {
    font: 400 18px/1 var(--display);
    color: var(--gold);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(6, 38px);
    border: 1.5px solid var(--cobalt-hi);
  }
  .cols span {
    padding: 10px 0 70px;
    border-left: 1px solid var(--rule);
    font: 700 12.5px/1 var(--text);
    letter-spacing: 0.12em;
    color: var(--cobalt-hi);
  }
  .cols span.cur {
    background: var(--cobalt);
    color: #ffffff;
  }
</style>
