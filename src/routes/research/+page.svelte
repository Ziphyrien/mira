<script lang="ts">
 import Dashboard from '#lib/plugins/research/Dashboard.svelte';
 import ResearchQueryProvider from '#lib/plugins/research/ResearchQueryProvider.svelte';
 import type { PageProps } from './$types';
 let {data}:PageProps=$props();
</script>
{#key data.draftNamespace}<ResearchQueryProvider><Dashboard draftNamespace={data.draftNamespace} authenticated={data.authenticated} initial={data.studies}/></ResearchQueryProvider>{/key}
