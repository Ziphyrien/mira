<script lang="ts">
 import StudyWorkspace from '#lib/plugins/research/StudyWorkspace.svelte';
 import ResearchQueryProvider from '#lib/plugins/research/ResearchQueryProvider.svelte';
 import type {PageProps} from './$types';
 let {data}:PageProps=$props();
</script>
{#key data.draftNamespace+':'+(data.inspection.status==='ready'?data.inspection.study.id:data.inspection.id)}<ResearchQueryProvider><StudyWorkspace draftNamespace={data.draftNamespace} initial={data.inspection} administrator={data.administrator}/></ResearchQueryProvider>{/key}
