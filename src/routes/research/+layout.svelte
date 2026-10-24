<script lang="ts">
  import { page } from '$app/state';
  import InteractionGate from '#lib/ui/InteractionGate.svelte';
  import ResearchQueryProvider from '#lib/plugins/research/ResearchQueryProvider.svelte';
  import type { LayoutProps } from './$types';
  let { children }: LayoutProps = $props();
</script>
<InteractionGate>
  {#key page.data.draftNamespace}
    <ResearchQueryProvider><div class="bg-base-100 text-base-content min-h-dvh">{@render children()}</div></ResearchQueryProvider>
  {/key}
</InteractionGate>
