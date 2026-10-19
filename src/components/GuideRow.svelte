<!--
  "So geht's" as a row of its own, in the panels' look (the user, 2026-10-20: the quiet button "looks
  really lost in this ui"): a die, the title, what's inside, a chevron. On the start page and at the top
  of Settings, as Stichle has it.
-->
<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { ui } from '../lib/ui.svelte';

  let { before }: { before?: () => void } = $props();
</script>

<button
  class="sheet guide-row"
  type="button"
  onclick={() => {
    before?.();
    ui.guide = true;
  }}
>
  <svg class="die" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
    <circle cx="8.5" cy="8.5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="15.5" cy="15.5" r="1.6" />
  </svg>
  <span class="text"><b>{t('guide')}</b><small>{t('guideOpen')}</small></span>
  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
</button>

<style>
  .guide-row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 68px;
    padding: 12px 14px 12px 16px;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--ewo-dur-1) var(--ewo-ease), box-shadow var(--ewo-dur-1) var(--ewo-ease);
  }
  .guide-row:active {
    transform: translateY(2px);
    box-shadow: 0 0 0 var(--cobalt-soft);
  }
  .guide-row:focus-visible {
    outline: 3px solid var(--gold);
    outline-offset: 2px;
  }
  .die {
    flex: none;
    width: 34px;
    height: 34px;
  }
  .die rect {
    fill: var(--cobalt);
    stroke: var(--cobalt-hi);
    stroke-width: 1.4;
  }
  .die circle {
    fill: #ffffff;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .text b {
    font: 400 20px/1.15 var(--display);
    color: var(--ink);
  }
  .text small {
    font: 500 14px/1.3 var(--text);
    color: var(--mute);
  }
  .chev {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--cobalt-hi);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
