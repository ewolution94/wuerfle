<!--
  The seal maker: Folio's emblem maker in the token theme (vendor/ewo; development/plans/emblems.md),
  arrows on either side of the big seal like the other games' makers, one pair per part, top to
  bottom (colours, division, charge), and a dice for all three. The seal lies on the night block like
  a coin on the table.
-->
<script lang="ts">
  import type { Avatar as AvatarValue } from '../lib/avatar';

  let { avatar, onchange }: { avatar: AvatarValue; onchange: (next: AvatarValue) => void } = $props();
</script>

<ewo-emblem-maker class="maker" theme="token" value={avatar} onchange={(e) => onchange(e.detail.value as AvatarValue)}></ewo-emblem-maker>

<style>
  .maker {
    gap: 14px;
    --ewo-emblem-maker-inset: 6%;
    --ewo-emblem-ink: var(--night);
  }
  .maker::part(arrow) {
    padding: 0;
    border: 1.5px solid var(--cobalt-hi);
    border-radius: 6px;
    background: var(--night-3);
    color: var(--ink);
    -webkit-tap-highlight-color: transparent;
  }
  @media (hover: hover) {
    .maker::part(arrow):hover {
      background: var(--cobalt);
    }
  }
  .maker::part(arrow):active {
    background: var(--cobalt);
  }
  .maker::part(arrow):focus-visible,
  .maker::part(dice):focus-visible {
    outline: 3px solid var(--gold);
    outline-offset: 2px;
  }
  .maker::part(stage) {
    margin-inline: 4px;
    border-radius: 50%;
    box-shadow: 0 10px 18px -10px rgb(5 8 25 / 0.55);
  }
  .maker::part(tag) {
    z-index: 2;
    padding: 5px 10px 4px;
    border-radius: 999px;
    background: var(--cobalt);
    color: #ffffff;
    font: 700 12.5px/1 var(--text);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .maker::part(legend) {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--mute);
  }
  .maker::part(dice) {
    min-height: 36px;
    padding: 0 14px;
    border: 1.5px solid var(--cobalt-hi);
    border-radius: 6px;
    background: transparent;
    color: var(--cobalt-hi);
    font: 400 16px / 1.2 var(--display);
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--ewo-dur-1) var(--ewo-ease);
  }
  @media (hover: hover) and (pointer: fine) {
    .maker::part(dice):active {
      transform: scale(0.97);
    }
  }
</style>
