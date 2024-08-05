<script>
  const { value, barColor } = $props();
  const progress = $derived(value === -1 || value > 100 ? 100 : value);
</script>

<div class="container">
  <div class="progressBar {barColor}" style="transform: translateX({progress - 100}%)"></div>
</div>

<style lang="postcss">
  .container {
    @apply relative w-full h-2 bg-gray-200 rounded-full overflow-hidden;
  }

  .progressBar {
    @apply absolute top-0 bottom-0 left-0 w-full transition-all;
  }
</style>
