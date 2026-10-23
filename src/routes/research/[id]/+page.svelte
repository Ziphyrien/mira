<script lang="ts">
 import StudyWorkspace from '#lib/plugins/research/StudyWorkspace.svelte';
 import type {PageProps} from './$types';
 let {data}:PageProps=$props();
</script>
{#key data.inspection.status==='ready'?data.inspection.study.id:data.inspection.id}<StudyWorkspace initial={data.inspection} administrator={data.administrator}/>{/key}
