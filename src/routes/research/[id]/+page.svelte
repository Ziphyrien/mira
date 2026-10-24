<script lang="ts">
 import {createQuery} from '@tanstack/svelte-query';
 import type {ResearchInspection} from '#lib/contracts/research.js';
 import {researchQuery} from '#lib/plugins/research/queries.js';
 import StudyWorkspace from '#lib/plugins/research/StudyWorkspace.svelte';
 import type {PageProps} from './$types';
 let {data}:PageProps=$props();
 const inspection=createQuery(()=>({...researchQuery<ResearchInspection>('/api/research/'+data.id),initialData:data.inspection}));
</script>
{#if inspection.data}
 {#key data.id}<StudyWorkspace draftNamespace={data.draftNamespace} initial={inspection.data} administrator={data.administrator}/>{/key}
{:else if inspection.error}
 <main class="mx-auto max-w-5xl p-5 sm:p-8"><p role="alert" class="text-error">{inspection.error.message}</p><button class="btn btn-ghost btn-sm mt-4" onclick={()=>inspection.refetch()}>重试</button></main>
{:else}
 <main class="mx-auto max-w-5xl p-5 sm:p-8"><div class="mt-6 flex justify-center" role="status" aria-label="加载中"><span class="loading loading-spinner loading-sm" aria-hidden="true"></span></div></main>
{/if}
