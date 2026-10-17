<script lang="ts">
  import { getSearch } from "#lib/plugins/search/context.js";
  const search = getSearch();
</script>

<svelte:window
  onkeydown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "k") {
      event.preventDefault();
      search.open();
    }
  }}
/>
<button
  type="button"
  class="btn btn-ghost btn-sm gap-1.5"
  onclick={() => search.open()}
  aria-label="搜索对话"
>
  <span class="icon-[lucide--search] size-4"></span>
  <span class="hidden sm:inline">搜索</span>
</button>
