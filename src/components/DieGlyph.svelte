<!-- A small flat die face, for the block's upper rows and the guide: cobalt glass, white pips. -->
<script lang="ts">
  let { value, size = 14 }: { value: number; size?: number } = $props();

  const PIPS: Record<number, [number, number][]> = {
    1: [[12, 12]],
    2: [[7, 7], [17, 17]],
    3: [[7, 7], [12, 12], [17, 17]],
    4: [[7, 7], [17, 7], [7, 17], [17, 17]],
    5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
    6: [[7, 6.5], [17, 6.5], [7, 12], [17, 12], [7, 17.5], [17, 17.5]],
  };
</script>

<svg class="glyph" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
  <rect x="1.5" y="1.5" width="21" height="21" rx="5" />
  {#each PIPS[value] ?? [] as [x, y], k (k)}<circle cx={x} cy={y} r="2.3" />{/each}
</svg>

<style>
  .glyph {
    flex: none;
    display: block;
  }
  rect {
    fill: #3355e0;
    stroke: #8fa5ff;
    stroke-width: 1.2;
  }
  circle {
    fill: #ffffff;
  }
</style>
