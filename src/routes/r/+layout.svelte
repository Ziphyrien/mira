<script lang="ts">
 import InteractionGate from '#lib/ui/InteractionGate.svelte';
 import type { LayoutProps } from './$types';
 let {children}:LayoutProps=$props();
</script>
<InteractionGate><div class="bg-base-100 text-base-content min-h-dvh">{@render children()}</div></InteractionGate>
