<script lang="ts">
 import {untrack} from 'svelte';
 import {goto} from '$app/navigation';
 import Modal from '#lib/ui/Modal.svelte';
 import type {StudySummary,ResearchPlanning} from '#lib/contracts/research.js';
 import {researchRequest} from './client';
 import CreateStudy from './CreateStudy.svelte';
 let {authenticated,initial}:{authenticated:boolean;initial:StudySummary[]}=$props();
 let studies=$state.raw(untrack(()=>initial)),creating=$state(false),refreshing=$state(false),failure=$state(''),sharing=$state<string|null>(null),sharePath=$state(''),shareTitle=$state(''),copied=$state(false);
 const statuses:Record<StudySummary['status'],string>={planning:'生成中',clarifying:'待补充',failed:'生成失败',draft:'待发布',published:'收集中',closed:'已结束',unavailable:'状态暂不可用'};
 let refreshList=()=>{};
 $effect(()=>{if(!authenticated||creating)return;let active=true,loading=false,timer:ReturnType<typeof setTimeout>|undefined;
 async function refresh(){if(!active||loading)return;clearTimeout(timer);loading=true;refreshing=true;try{const result=await researchRequest<StudySummary[]>('/api/research');if(active){studies=result;failure='';}}catch(error){if(active)failure=error instanceof Error?error.message:'列表暂未刷新。';}finally{loading=false;if(active){refreshing=false;timer=setTimeout(()=>{if(document.visibilityState==='visible')void refresh();},5000);}}}
 refreshList=()=>{void refresh();};void refresh();return()=>{active=false;clearTimeout(timer);refreshList=()=>{};refreshing=false;};});
 async function open(id:string){await goto('/research/'+id);}
 async function created(study:ResearchPlanning){creating=false;await open(study.id);}
 async function share(study:StudySummary){sharing=study.id;failure='';try{const result=await researchRequest<{path:string}>('/api/research/'+study.id,{action:'management-share'});sharePath=location.origin+result.path;shareTitle=study.topic;copied=false;}catch(error){failure=error instanceof Error?error.message:'请重试。';}finally{sharing=null;}}
 async function copy(){try{await navigator.clipboard.writeText(sharePath);copied=true;}catch{failure='请选中链接后复制。';}}
</script>
<svelte:window onfocus={()=>refreshList()}/><svelte:document onvisibilitychange={()=>{if(document.visibilityState==='visible')refreshList();}}/>
<svelte:head><title>研究 · Mira</title><meta name="robots" content="noindex,nofollow"/></svelte:head>
<main class="mx-auto max-w-5xl p-5 sm:p-8">
 <header class="mb-8 flex items-center justify-between gap-4"><a href="/research" class="text-lg font-semibold">Mira <span class="text-base-content/40 font-normal">/ 研究</span></a><a href="/admin" class="btn btn-ghost btn-sm">管理后台<span class="icon-[lucide--arrow-up-right] size-4" aria-hidden="true"></span></a></header>
 {#if !authenticated}<div class="mx-auto max-w-sm space-y-5 py-24 text-center"><span class="icon-[lucide--lock-keyhole] text-base-content/35 mx-auto block size-9" aria-hidden="true"></span><h1 class="text-xl font-medium">登录研究工作台</h1><a href="/admin" class="btn btn-primary">管理员登录</a></div>
 {:else}
 <div class="mb-6 flex items-center justify-between gap-3"><h1 class="text-2xl font-semibold">研究</h1><div class="flex items-center gap-2"><button class="btn btn-ghost btn-sm btn-circle" aria-label="刷新研究列表" disabled={refreshing} onclick={()=>refreshList()}><span class={refreshing?'loading loading-spinner loading-xs':'icon-[lucide--refresh-cw] size-4'} aria-hidden="true"></span></button><button class="btn btn-primary btn-sm" onclick={()=>creating=true}><span class="icon-[lucide--plus] size-4" aria-hidden="true"></span>新建研究</button></div></div>
 {#if studies.length}<div class="divide-base-300 border-base-300 divide-y rounded-box border">{#each studies as study (study.id)}<div role="group" aria-label={study.topic} class="flex items-center gap-1 pr-3 sm:pr-4"><button class="hover:bg-base-200 flex min-w-0 flex-1 items-center gap-4 p-4 text-left transition-colors sm:p-5" onclick={()=>open(study.id)}><span class="icon-[lucide--clipboard-list] text-base-content/40 size-5 shrink-0" aria-hidden="true"></span><span class="min-w-0 flex-1"><span class="block truncate font-medium">{study.topic}</span><span class="text-base-content/50 mt-1 block text-xs">{new Date(study.createdAt).toLocaleDateString('zh-CN')}</span></span><span class={['badge badge-soft badge-sm shrink-0',study.status==='failed'&&'badge-error',study.status==='planning'&&'badge-info',study.status==='published'&&'badge-success']}>{statuses[study.status]}</span></button><button class="btn btn-ghost btn-sm btn-circle shrink-0" aria-label="分享管理" title="分享管理" disabled={sharing===study.id} onclick={()=>share(study)}><span class={sharing===study.id?'loading loading-spinner loading-xs':'icon-[lucide--link] size-4'} aria-hidden="true"></span></button></div>{/each}</div>
 {:else}<div class="border-base-300 rounded-box border border-dashed py-20 text-center"><span class="icon-[lucide--clipboard-list] text-base-content/25 mx-auto mb-4 block size-10" aria-hidden="true"></span><p class="text-base-content/50 text-sm">还没有研究</p></div>{/if}{/if}
 {#if failure}<p role="alert" class="text-error mt-4 text-sm">{failure}</p>{/if}
</main>
<Modal open={Boolean(sharePath)} onOpenChange={open=>{if(!open)sharePath='';}} title="分享研究管理" closeButton="icon"><div class="space-y-4"><p class="font-medium">{shareTitle}</p><p class="text-base-content/65 text-sm">持有此链接的人可以查看回答、导出数据，并管理或删除这项研究。</p><input class="input w-full text-sm" aria-label="研究管理链接" readonly value={sharePath} onclick={event=>event.currentTarget.select()}/><div class="flex gap-3"><button class="btn btn-primary flex-1" onclick={copy}>{copied?'已复制':'复制链接'}</button><a class="btn btn-outline" href={sharePath} target="_blank" rel="noreferrer">打开管理页</a></div></div></Modal>
{#if creating}<CreateStudy open={creating} onclose={()=>creating=false} oncreated={created}/>{/if}
