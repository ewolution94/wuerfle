<!--
  The start: who you are (a seal and your name), then a game alone (how many games, against how many
  bots, which rules; or carry on the one you left), a new table for friends, or a table by its code.
  How to play opens once on a device's first visit. From Stammtisch's Home.svelte.
-->
<script lang="ts">
  import { api, ApiError, CODE, LEVELS, VARIANTS, type Level, type Seat, type Variant } from '../lib/api';
  import type { Avatar } from '../lib/avatar';
  import { errorText, t } from '../lib/i18n.svelte';
  import { saveAvatar, savedAvatar, savedName } from '../lib/session';
  import { record, savedSolo, type SoloSetup } from '../lib/solo.svelte';
  import { newKey, waitAt } from '../lib/waits';
  import AvatarMaker from './AvatarMaker.svelte';
  import { firstVisit } from '../../vendor/ewo/elements/guide.js';
  import { ui } from '../lib/ui.svelte';

  // A device's first visit opens how to play, once (Folio's firstVisit: never again, and never when
  // storage is unavailable).
  $effect(() => {
    if (firstVisit('wuerfle:guide')) ui.guide = true;
  });

  let {
    oncreate,
    onjoin,
    onsolo,
  }: {
    oncreate: (seat: Seat, name: string, signal: AbortSignal) => Promise<void>;
    onjoin: (code: string) => void;
    /** A solo game: a new one with this setup, or (null) the one left unfinished. */
    onsolo: (setup: SoloSetup | null, name: string) => void;
  } = $props();

  const SETUP = 'wuerfle:solo-setup';
  function savedSetup(): SoloSetup {
    const fallback: SoloSetup = { games: 1, bots: 0, level: 'journeyman', variant: 'meister' };
    try {
      const s = JSON.parse(localStorage.getItem(SETUP) ?? 'null');
      if (s && [1, 2, 3, 4, 5, 6].includes(s.games) && [0, 1, 2, 3].includes(s.bots) && LEVELS.includes(s.level) && VARIANTS.includes(s.variant)) return s;
    } catch {
      // the defaults
    }
    return fallback;
  }

  let name = $state(savedName());
  let avatar: Avatar = $state(savedAvatar());
  let code = $state('');
  let error = $state('');
  let setup: SoloSetup = $state(savedSetup());
  const unfinished = savedSolo();
  let key = newKey();

  const cleanCode = $derived(code.trim().toUpperCase());

  function changeAvatar(next: Avatar) {
    avatar = next;
    saveAvatar(next);
  }

  function changeSetup(patch: Partial<SoloSetup>) {
    setup = { ...setup, ...patch };
    try {
      localStorage.setItem(SETUP, JSON.stringify(setup));
    } catch {
      // not kept
    }
  }

  function who() {
    if (!name.trim()) {
      error = errorText('name');
      return null;
    }
    error = '';
    return name.trim();
  }

  function solo(resume: boolean) {
    const n = who();
    if (n) onsolo(resume ? null : setup, n);
  }

  async function create(event: Event) {
    const n = who();
    if (!n) return;
    try {
      await waitAt(event, async (signal) => oncreate(await api.create(n, avatar, key, signal), n, signal), t('wait_create'));
      key = newKey();
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  function join(event: SubmitEvent) {
    event.preventDefault();
    if (CODE.test(cleanCode)) onjoin(cleanCode);
  }
</script>

<div class="home">
  <section class="sheet card">
    <h1 class="display">{t('whoAreYou')}</h1>
    <AvatarMaker {avatar} onchange={changeAvatar} />
    <label class="field">
      <span class="label">{t('yourName')}</span>
      <input class="input" bind:value={name} maxlength="16" autocomplete="nickname" placeholder={t('namePlaceholder')} />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>

  <section class="sheet card">
    <h2 class="display">{t('soloTitle')}</h2>
    {#if unfinished}
      <button class="btn cobalt block" type="button" onclick={() => solo(true)}>{t('soloResume')}</button>
    {/if}
    <div class="setting">
      <span class="label">{t('games')}</span>
      <ewo-segmented stretch value={String(setup.games)} label={t('games')} onchange={(e) => changeSetup({ games: Number(e.detail.value) })}>
        {#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={String(n)}>{n}</option>{/each}
      </ewo-segmented>
    </div>
    <div class="setting">
      <span class="label">{t('opponents')}</span>
      <ewo-segmented stretch value={String(setup.bots)} label={t('opponents')} onchange={(e) => changeSetup({ bots: Number(e.detail.value) })}>
        <option value="0">{t('opponentsNone')}</option>
        {#each [1, 2, 3] as n (n)}<option value={String(n)}>{n}</option>{/each}
      </ewo-segmented>
    </div>
    {#if setup.bots > 0}
      <div class="setting">
        <span class="label">{t('bots')}</span>
        <ewo-segmented stretch value={setup.level} label={t('bots')} onchange={(e) => changeSetup({ level: e.detail.value as Level })}>
          {#each LEVELS as level (level)}<option value={level}>{t(`level_${level}`)}</option>{/each}
        </ewo-segmented>
      </div>
    {/if}
    <div class="setting">
      <span class="label">{t('rules')}</span>
      <ewo-segmented stretch value={setup.variant} label={t('rules')} onchange={(e) => changeSetup({ variant: e.detail.value as Variant })}>
        {#each VARIANTS as v (v)}<option value={v}>{t(`variant_${v}`)}</option>{/each}
      </ewo-segmented>
      <span class="hint">{t(`variantHint_${setup.variant}`)}</span>
    </div>
    <button class="btn primary block" type="button" onclick={() => solo(false)}>{t('solo')}</button>
    {#if record.played}
      <p class="record">{record.played === 1 ? t('recordOne', { best: record.best }) : t('record', { best: record.best, played: record.played })}</p>
    {/if}
  </section>

  <section class="sheet card">
    <h2 class="display">{t('newTable')}</h2>
    <button class="btn cobalt block" type="button" onclick={create}>{t('newTable')}</button>
    <form class="join" onsubmit={join}>
      <span class="label">{t('joinWithCode')}</span>
      <div class="row">
        <input
          class="input code"
          bind:value={code}
          maxlength="4"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          placeholder={t('codePlaceholder')}
          aria-label={t('code')}
        />
        <button class="btn" type="submit" disabled={!CODE.test(cleanCode)}>{t('join')}</button>
      </div>
    </form>
  </section>

  <button class="btn quiet guide" type="button" onclick={() => (ui.guide = true)}>{t('guide')}</button>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 440px;
    margin: 18px auto 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px 20px 20px;
  }
  h1,
  h2 {
    margin: 0;
    line-height: 1.1;
    color: #ffffff;
  }
  h1 {
    font-size: 28px;
    text-align: center;
  }
  h2 {
    font-size: 21px;
  }
  .field,
  .setting,
  .join {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .hint {
    font-size: 13px;
    line-height: 1.4;
    color: var(--mute);
  }
  .record {
    margin: 0;
    text-align: center;
    font: 400 15.5px/1.35 var(--text);
    color: var(--gold);
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .code {
    flex: 1;
    min-width: 0;
    font: 400 22px/1.2 var(--display);
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }
  .guide {
    align-self: center;
  }
</style>
