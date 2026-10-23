<script lang="ts">
 import {untrack} from 'svelte';
 import {goto} from '$app/navigation';
 import type {ResearchInspection} from '#lib/contracts/research.js';
 import StudyDetail from './StudyDetail.svelte';
 import StudyPreparation from './StudyPreparation.svelte';
 import Modal from '#lib/ui/Modal.svelte';
 import {researchRequest} from './client';
 let {initial,administrator}:{initial:ResearchInspection;administrator:boolean}=$props();
 let selected=$state.raw(untrack(()=>initial));let deleting=$state(false),removing=$state(false),removed=$state(false),failure=$state('');
 const id=$derived(selected.status==='ready'?selected.study.id:selected.id);
 const title=$derived(selected.status==='ready'?selected.study.plan.title:selected.topic);
 async function remove(){removing=true;failure='';try{const current=await researchRequest<ResearchInspection>('/api/research/'+id);if(current.status==='ready'&&current.study.status==='published')await researchRequest('/api/research/'+id,{action:'close'});await researchRequest('/api/research/'+id,undefined,'DELETE');deleting=false;if(administrator)await goto('/research');else removed=true;}catch(error){failure=error instanceof Error?error.message:'请重试。';}finally{removing=false;}}
</script>
<svelte:head><title>{title} · Mira</title><meta name="robots" content="noindex,nofollow"/></svelte:head>
<main class="mx-auto max-w-5xl p-5 sm:p-8">
 <header class="mb-8 flex items-center justify-between gap-4">{#if administrator}<a href="/research" class="text-lg font-semibold">Mira <span class="text-base-content/40 font-normal">/ 研究</span></a><a href="/admin" class="btn btn-ghost btn-sm">管理后台<span class="icon-[lucide--arrow-up-right] size-4" aria-hidden="true"></span></a>{:else}<span class="text-lg font-semibold">Mira <span class="text-base-content/40 font-normal">/ 研究</span></span>{/if}</header>
 {#if removed}<p class="py-20 text-center text-base-content/60">这项研究已删除。</p>
 {:else if selected.status==='ready'}<StudyDetail initial={selected.study} initialResults={selected.results} onback={administrator?()=>{void goto('/research');}:undefined} ondelete={()=>deleting=true} onplanning={job=>selected=job}/>
 {:else}<StudyPreparation initial={selected} onready={ready=>selected=ready} onback={administrator?()=>{void goto('/research');}:undefined} ondelete={()=>deleting=true}/>{/if}
</main>
<Modal open={deleting} onOpenChange={open=>{if(!removing)deleting=open;}} title="删除研究？" closeButton="none"><p class="font-medium">{title}</p><p class="text-base-content/60 mt-3 text-sm">方案和回答将永久删除，参与链接与管理链接随即失效。</p>{#if failure}<p role="alert" class="text-error mt-3 text-sm">{failure}</p>{/if}{#snippet footer()}<button class="btn btn-ghost" disabled={removing} onclick={()=>deleting=false}>取消</button><button class="btn btn-error" disabled={removing} onclick={remove}>删除</button>{/snippet}</Modal>
