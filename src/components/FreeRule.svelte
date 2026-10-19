<!--
  The house rule "any column" (server/rules.mjs → free), for two games or more: a switch for whoever
  sets the table (alone: you; at a table: the host), the state for everyone else. The user's family
  plays it this way (2026-10-20).
-->
<script lang="ts">
  import { t } from '../lib/i18n.svelte';

  let { checked, editable = true, onchange }: { checked: boolean; editable?: boolean; onchange?: (on: boolean) => void } = $props();
</script>

<div class="free">
  <div class="line">
    <span class="label">{t('freeColumns')}</span>
    {#if editable}
      <ewo-switch {checked} aria-label={t('freeColumns')} onchange={(e) => onchange?.(e.detail.checked)}></ewo-switch>
    {:else}
      <b class="value">{checked ? t('freeOn') : t('freeOff')}</b>
    {/if}
  </div>
  <span class="hint">{checked ? t('freeHintOn') : t('freeHintOff')}</span>
</div>

<style>
  .free {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
  }
  .value {
    font: 400 18px/1.2 var(--display);
  }
  .hint {
    font-size: 13px;
    line-height: 1.4;
    color: var(--mute);
  }
</style>
