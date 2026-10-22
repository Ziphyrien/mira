<script lang="ts">
  import Disclosure from '#lib/ui/Disclosure.svelte';
  import type {ResearchStudy} from '#lib/contracts/research.js';
  import {researchRequest} from './client';
  let {study,onupdate}:{study:ResearchStudy;onupdate:(study:ResearchStudy)=>void}=$props();
  let description=$state(''),from=$state(''),until=$state(''),busy=$state(false),failure=$state('');
  async function save(event:SubmitEvent){event.preventDefault();busy=true;failure='';try{onupdate(await researchRequest<ResearchStudy>('/api/research/'+study.id,{action:'collection-note',note:{description,from:from?new Date(from).getTime():null,until:until?new Date(until).getTime():null}}));description='';from='';until='';}catch(e){failure=e instanceof Error?e.message:'请重试。';}finally{busy=false;}}
</script>
<Disclosure triggerClass="text-base-content/60 py-2 text-sm">
  {#snippet trigger(open)}<span>收集期间的变化{#if study.collectionNotes?.length}（{study.collectionNotes.length}）{/if}</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}
  <div class="mt-3 space-y-5">
    <p class="text-base-content/60 text-xs">记录可能影响回答的实际变化，分析时结合时间与样本情况判断。</p>
    {#each study.collectionNotes??[] as note (note.id)}<div class="border-base-300 border-l-2 pl-3 text-sm"><p class="whitespace-pre-wrap">{note.description}</p><p class="text-base-content/50 mt-1 text-xs">{#if note.from!==null}开始：{new Date(note.from).toLocaleString()}{/if}{#if note.until!==null} · 结束：{new Date(note.until).toLocaleString()}{/if}{#if note.from===null&&note.until===null}影响时段待确认{/if}</p><p class="text-base-content/40 mt-1 text-xs">记录于 {new Date(note.recordedAt).toLocaleString()}</p></div>{/each}
    <form class="space-y-3" onsubmit={save}><fieldset class="space-y-3" disabled={busy}><label class="fieldset"><span class="fieldset-legend">发生了什么变化？</span><textarea class="textarea w-full" bind:value={description} maxlength="2000" required></textarea></label><div class="grid gap-3 sm:grid-cols-2"><label class="fieldset"><span class="fieldset-legend">开始时间（如已知）</span><input class="input w-full" type="datetime-local" bind:value={from}/></label><label class="fieldset"><span class="fieldset-legend">结束时间（如已知）</span><input class="input w-full" type="datetime-local" bind:value={until}/></label></div></fieldset>{#if failure}<p class="text-error text-sm" role="alert">{failure}</p>{/if}<button class="btn btn-outline btn-sm" type="submit" disabled={busy}>添加记录</button></form>
  </div>
</Disclosure>
