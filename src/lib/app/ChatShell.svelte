<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { ChatAppHost } from "#lib/app/host.js";
  import HistoryViewport from "#lib/plugins/history/HistoryViewport.svelte";
  let { app }: { app: ChatAppHost } = $props();
  // ChatApp keys this composition by host, so all descendant contexts share its lifetime.
  untrack(() => app.provide());
  onMount(() => app.restore());
</script>

<div class="flex h-dvh flex-col">
  <HistoryViewport />
  <footer
    class="bg-base-100 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
  >
    <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-1 px-1 pb-2 sm:gap-2 sm:px-2">
      {#each app.views.toolbar as entry (entry.key)}
        {@const Control = entry.component}
        <Control />
      {/each}
    </div>
    {#each app.views.composer as entry (entry.key)}
      {@const Composer = entry.component}
      <Composer />
    {/each}
  </footer>
</div>
{#each app.views.overlays as entry (entry.key)}
  {@const Overlay = entry.component}
  <Overlay />
{/each}
