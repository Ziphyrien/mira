<script lang="ts">
  import { onMount } from "svelte";
  import type { Profile, SpaceState } from "#lib/contracts/index.js";
  import { createChatAppHost, type ChatAppHost } from "#lib/app/host.js";
  import ChatShell from "#lib/app/ChatShell.svelte";
  let {
    initial,
    onReset,
  }: {
    initial: Extract<SpaceState, { profile: Profile }>;
    onReset: () => void;
  } = $props();
  let app = $state.raw<ChatAppHost>();
  let failure = $state("");
  onMount(() => {
    let disposed = false;
    void createChatAppHost(initial, onReset)
      .then(async (value) => {
        if (disposed) {
          await value.dispose();
          return;
        }
        app = value;
      })
      .catch((error: unknown) => {
        if (!disposed)
          failure = error instanceof Error ? error.message : "无法打开对话";
      });
    return () => {
      disposed = true;
      if (app)
        void app
          .dispose()
          .catch((error: unknown) => console.error("web.close", error));
    };
  });
</script>

{#if failure}<main class="grid min-h-dvh place-items-center p-6 text-center">
    <p role="alert">{failure}</p>
  </main>{:else if app}
  {#key app}<ChatShell {app} />{/key}
{:else}<main class="grid min-h-dvh place-items-center">
    <span class="loading loading-spinner" aria-label="加载中"></span>
  </main>{/if}
