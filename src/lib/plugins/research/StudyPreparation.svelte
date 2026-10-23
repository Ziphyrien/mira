<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ResearchPlanning, ResearchInspection } from '#lib/contracts/research.js';
  import { researchRequest } from './client';
  let { initial, onready, onback, ondelete }: {initial:ResearchPlanning;onready:(ready:Extract<ResearchInspection,{status:'ready'}>)=>void;onback?:()=>void;ondelete:()=>void}=$props();
  let job=$state.raw(untrack(()=>initial));let failure=$state('');let retrying=$state(false);let answer=$state('');
  let refresh=()=>{};
  onMount(()=>{
    let active=true;let timer:ReturnType<typeof setTimeout>;
    async function check(){
      try{const result=await researchRequest<ResearchInspection>('/api/research/'+initial.id);if(!active)return;failure='';if(result.status==='ready'){onready(result);return;}job=result;if(result.status==='failed'||result.status==='clarifying')return;}
      catch(e){if(active)failure=e instanceof Error?e.message:'连接中断，正在重试。';}
      if(active)timer=setTimeout(()=>void check(),2500);
    }
    refresh=()=>{clearTimeout(timer);void check();};refresh();return()=>{active=false;clearTimeout(timer);};
  });
  async function retry(){retrying=true;failure='';try{job=await researchRequest<ResearchPlanning>('/api/research/'+job.id,{action:'retry'});refresh();}catch(e){failure=e instanceof Error?e.message:'请重试。';}finally{retrying=false;}}
  async function clarify(event:SubmitEvent){event.preventDefault();retrying=true;failure='';try{job=await researchRequest<ResearchPlanning>('/api/research/'+job.id,{action:'clarify',answer});answer='';refresh();}catch(e){failure=e instanceof Error?e.message:'请重试。';}finally{retrying=false;}}
  async function cancel(){retrying=true;failure='';try{onready(await researchRequest<Extract<ResearchInspection,{status:'ready'}>>('/api/research/'+job.id,{action:'cancel-refinement'}));}catch(e){failure=e instanceof Error?e.message:'请重试。';}finally{retrying=false;}}
</script>
<div class="flex items-center justify-between gap-3"><button class="btn btn-ghost btn-sm" hidden={!onback} onclick={onback}><span class="icon-[lucide--arrow-left] size-4" aria-hidden="true"></span>研究列表</button><button class="btn btn-ghost btn-sm" disabled={retrying} onclick={ondelete}><span class="icon-[lucide--trash-2] size-4" aria-hidden="true"></span>删除研究</button></div>
<section class="mx-auto max-w-md space-y-5 py-20 text-center" aria-live="polite">
  {#if job.status==='clarifying'}
    <h1 class="text-xl font-medium">再了解一点背景</h1>
    <div class="space-y-4 text-left">{#each job.questions??[] as question (question.question)}<div><p>{question.question}</p><p class="text-base-content/60 mt-1 text-sm">{question.reason}</p></div>{/each}</div>
    <form class="space-y-4 text-left" onsubmit={clarify}><label class="fieldset"><span class="fieldset-legend">你的补充</span><textarea class="textarea min-h-32 w-full" bind:value={answer} maxlength="12000" required placeholder="按实际情况说明，尚未确定的也可以说明。" disabled={retrying}></textarea></label><button class="btn btn-primary" type="submit" disabled={retrying}>继续准备方案</button></form>
  {:else if job.status==='failed'}<span class="icon-[lucide--circle-alert] text-warning mx-auto block size-9" aria-hidden="true"></span><h1 class="text-xl font-medium">暂时没能生成方案</h1><p class="text-base-content/60 text-sm">{job.message}</p><button class="btn btn-primary" disabled={retrying} onclick={retry}>重试</button>
  {:else}<span class="loading loading-spinner text-primary size-8" aria-hidden="true"></span><h1 class="text-xl font-medium">正在准备研究方案</h1><p class="text-base-content/60 text-sm">{job.topic}</p><p class="text-base-content/40 text-xs">稍后可从研究列表查看</p>{/if}
  {#if job.revising}<button class="btn btn-ghost btn-sm" disabled={retrying} onclick={cancel}>保留原方案</button>{/if}
  {#if failure}<p class="text-error text-sm" role="alert">{failure}</p>{/if}
</section>
