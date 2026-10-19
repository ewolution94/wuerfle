<!--
  Settings, the family's way (plans/settings-alignment.md): Folio's ewo-sheet, opened from the band's
  ewo-settings-button, General first: the language, the sounds, shaking the phone to roll, and the
  suggested box in the block. Würfle is dark only, so there's no theme. During a match (`room` given)
  it opens with "This match" first: the host can end it for everyone, anyone can leave, each after a
  second tap that says what it does (development/plans/end-game.md); a solo game can be given up.
  From Stammtisch's Settings.svelte.
-->
<script lang="ts">
  import GuideRow from './GuideRow.svelte';
  import { themeShift } from '../../vendor/ewo/elements/theme-shift.js';
  import { ApiError } from '../lib/api';
  import { errorText, i18n, setLanguage, systemLang, t, type LangChoice } from '../lib/i18n.svelte';
  import { prefs, setHint } from '../lib/prefs.svelte';
  import type { Room } from '../lib/room.svelte';
  import { play, setSound, sound } from '../lib/sound.svelte';
  import { ui } from '../lib/ui.svelte';
  import { actAt } from '../lib/waits';

  let {
    open,
    onclose,
    room = null,
    onleave,
    ongiveup,
  }: {
    open: boolean;
    onclose: () => void;
    room?: Room | null;
    onleave?: (from: Event) => Promise<void>;
    /** A solo game: give it up. */
    ongiveup?: () => void;
  } = $props();

  const view = $derived(room?.view ?? null);
  const isHost = $derived(Boolean(view && view.me === view.host));
  const hostName = $derived(view?.players.find((p) => p.id === view.host)?.name ?? '');
  let sure: 'end' | 'leave' | 'giveup' | null = $state(null);
  let error = $state('');
  $effect(() => {
    if (!open) {
      sure = null;
      error = '';
    }
  });

  async function end(from: Event) {
    error = '';
    try {
      await actAt(room!, 'stop', undefined, from);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  async function leave(from: Event) {
    error = '';
    try {
      await onleave?.(from);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  let shown = $state(false);
  $effect(() => {
    if (open) shown = true;
  });
  function closed() {
    shown = false;
    onclose();
  }

  function pickLanguage(next: LangChoice) {
    if (next === i18n.choice) return;
    const shows = next === 'system' ? systemLang() : next;
    if (shows === i18n.lang) setLanguage(next);
    else themeShift(() => setLanguage(next));
  }
</script>

<ewo-sheet {open} label={t('settings')} oncancel={onclose} onclose={closed}>
  <span slot="heading">{t('settings')}</span>
  {#if shown}
    <div class="guide"><GuideRow before={onclose} /></div>
    {#if (room && view?.phase === 'play') || ongiveup}
      <section class="game">
        <h3 class="label">{t('thisGame')}</h3>
        {#if sure === 'end'}
          <p class="sure">{t('endSure')}</p>
          <div class="pair">
            <button class="btn danger-fill" type="button" onclick={end}>{t('endYes')}</button>
            <button class="btn" type="button" onclick={() => (sure = null)}>{t('keepPlaying')}</button>
          </div>
        {:else if sure === 'leave'}
          <p class="sure">{isHost ? t('leaveSureHost') : t('leaveSure')}</p>
          <div class="pair">
            <button class="btn danger-fill" type="button" onclick={leave}>{t('leaveYes')}</button>
            <button class="btn" type="button" onclick={() => (sure = null)}>{t('keepPlaying')}</button>
          </div>
        {:else if sure === 'giveup'}
          <p class="sure">{t('soloEndSure')}</p>
          <div class="pair">
            <button class="btn danger-fill" type="button" onclick={() => ongiveup?.()}>{t('soloEndYes')}</button>
            <button class="btn" type="button" onclick={() => (sure = null)}>{t('keepPlaying')}</button>
          </div>
        {:else if ongiveup}
          <button class="btn" type="button" onclick={() => (sure = 'giveup')}>{t('soloEnd')}</button>
        {:else}
          <div class="pair">
            {#if isHost}
              <button class="btn" type="button" onclick={() => (sure = 'end')}>{t('stopGame')}</button>
            {/if}
            <button class="btn quiet" type="button" onclick={() => (sure = 'leave')}>{t('leaveGame')}</button>
          </div>
          {#if !isHost}<p class="hint">{t('endHint', { name: hostName })}</p>{/if}
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </section>
    {/if}
    <section>
      <h3 class="label">{t('general')}</h3>
      <div class="row">
        <span class="name">{t('language')}</span>
        <ewo-segmented stretch value={i18n.choice} label={t('language')} onchange={(e) => pickLanguage(e.detail.value as LangChoice)}>
          <option value="system">{t('langSystem')}</option>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </ewo-segmented>
      </div>
      <div class="row">
        <span class="name">{t('soundsHint')}</span>
        <ewo-switch
          checked={sound.on}
          aria-label={t('sounds')}
          onchange={(e) => {
            setSound(e.detail.checked);
            if (e.detail.checked) play.wuerfle();
          }}
        ></ewo-switch>
      </div>
      <div class="row">
        <span class="name">{t('hintBox')}<small>{t('hintBoxHint')}</small></span>
        <ewo-switch checked={prefs.hint} aria-label={t('hintBox')} onchange={(e) => setHint(e.detail.checked)}></ewo-switch>
      </div>
    </section>
  {/if}
</ewo-sheet>

<style>
  .guide {
    margin-bottom: 22px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 8px;
  }
  section + section {
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }
  h3 {
    margin: 0;
  }
  .game {
    padding-bottom: 16px;
    margin-bottom: 4px;
    border-bottom: 1.5px solid var(--line);
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--mute);
  }
  .error {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 15px;
  }
  .name small {
    font-size: 12.5px;
    color: var(--mute);
  }
  ewo-segmented {
    flex: none;
    width: min(300px, 62%);
  }
  @media (max-width: 480px) {
    .row:has(ewo-segmented) {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }
    ewo-segmented {
      width: 100%;
    }
  }
</style>
