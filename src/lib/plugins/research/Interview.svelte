<script lang="ts">
  import { untrack } from 'svelte';
  import { Checkbox } from 'bits-ui';
  import Modal from '#lib/ui/Modal.svelte';
  import Disclosure from '#lib/ui/Disclosure.svelte';
  import type { PublicStudy, InterviewView, AnswerValue, InterviewAnswer } from '#lib/contracts/research.js';
  import { researchRequest, ResearchRequestError } from './client';
  import QuestionInput from './QuestionInput.svelte';
  import {trackPresence} from './presence';
  import {clearDraft,clearDrafts} from './drafts';
  let { study, initial }: { study: PublicStudy; initial: InterviewView | null } = $props();
  let interview = $state.raw<InterviewView | null>(untrack(() => initial));
  let consent = $state(false);
  let eligible = $state(false);
  let editing = $state<InterviewAnswer|null>(null);
  let busy = $state(false);
  let failure = $state('');
  let reloadRequired=$state(false);
  let withdrawn = $state(false);
  let dialog = $state<'info' | 'withdraw' | 'finish' | null>(null);
  const endpoint = $derived('/api/research/public/' + study.id);
  const activeParticipation=$derived(study.available&&interview?.status==='active'?interview.draftKey:null);
  $effect(()=>{if(activeParticipation)return trackPresence(endpoint);});
  function display(a: InterviewAnswer) {
    if (a.value === null) return a.nonresponse?.label ?? '未回答';
    if (Array.isArray(a.value)) return a.value.map(v => a.question.options.find(o => o.id === v)?.label ?? v).join('、');
    return a.question.options.find(o => o.id === a.value)?.label ?? String(a.value);
  }
  async function act(body: unknown) {
    busy = true; failure = '';reloadRequired=false;
    try { interview = await researchRequest<InterviewView>(endpoint, body); dialog = null; editing = null; }
    catch (e) { failure = e instanceof Error ? e.message : '请重试。'; reloadRequired=e instanceof ResearchRequestError&&e.reloadRequired; }
    finally { busy = false; }
  }
  async function answer(value: AnswerValue, nonresponse?:string) { if (interview?.current){const key=interview.draftKey+":"+interview.current.id;await act({ action: 'answer', answer: { questionId: interview.current.id, value, nonresponse } });if(!failure)clearDraft(key);} }
  async function withdraw() {
    busy = true; failure = '';
    try { await researchRequest(endpoint, undefined, 'DELETE'); if(interview)clearDrafts(interview.draftKey); interview = null; withdrawn = true; dialog = null; }
    catch (e) { failure = e instanceof Error ? e.message : '请重试。'; }
    finally { busy = false; }
  }
</script>

<svelte:head><title>{study.title} · Mira</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-8 sm:px-6">
  <header class="flex items-center justify-between gap-4 py-5">
    <span class="text-base-content/50 text-sm">Mira</span>
    <button class="btn btn-ghost btn-sm btn-circle" aria-label="参与说明" onclick={() => dialog = 'info'}><span class="icon-[lucide--info] size-4" aria-hidden="true"></span></button>
  </header>
  {#if withdrawn}
    <section class="my-auto space-y-4 py-20 text-center"><span class="icon-[lucide--check] text-success mx-auto block size-10" aria-hidden="true"></span><h1 class="text-xl font-medium">已撤回</h1><p class="text-base-content/60 text-sm">本次回答已删除。</p></section>
  {:else if !interview}
    <section class="my-auto space-y-7 py-8">
      <div class="space-y-4"><h1 class="text-2xl leading-snug font-semibold">{study.title}</h1><p class="text-base-content/70 leading-relaxed">{study.welcome}</p></div>
      {#if study.estimatedMinutes}<div class="text-base-content/60 flex items-center gap-2 text-sm"><span class="icon-[lucide--clock-3] size-4" aria-hidden="true"></span>预计 {study.estimatedMinutes} 分钟</div>{/if}
      <p class="text-base-content/70 text-sm">{study.population}</p>
      {#if study.available}
        <div class="space-y-4 text-sm">
          {#if study.eligibility}<label class="flex cursor-pointer items-start gap-3"><Checkbox.Root bind:checked={eligible} class="checkbox checkbox-sm mt-0.5 shrink-0" aria-label="我符合参与条件" /><span>{study.eligibility}</span></label>{/if}
          <label class="flex cursor-pointer items-start gap-3"><Checkbox.Root bind:checked={consent} class="checkbox checkbox-sm mt-0.5 shrink-0" aria-label="我已阅读参与说明，同意参加" /><span>我已阅读<button class="link link-primary mx-1" onclick={event => { event.preventDefault(); dialog = 'info'; }}>参与说明</button>，同意参加</span></label>
        </div>
        <button class="btn btn-primary w-full" disabled={(Boolean(study.eligibility) && !eligible) || !consent || busy} onclick={() => act({ action: 'start', eligible, consent, timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone })}>{#if busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>{/if}开始</button>
      {:else}<p class="text-base-content/60">收集已结束</p>{/if}
    </section>
  {:else}
    <div class="pb-6"><h1 class="truncate text-sm font-medium">{study.title}</h1><div class="text-base-content/50 mt-3 flex justify-between text-xs"><span>已回答 {interview.answers.filter(a=>a.value!==null).length} 题{#if interview.answers.some(a=>a.value===null)} · 未回答 {interview.answers.filter(a=>a.value===null).length} 题{/if}</span>{#if interview.current?.source==='probe'}<span>补充交流</span>{/if}</div><progress class="progress progress-primary mt-2 h-1 w-full" value={interview.processedCore + interview.omitted.filter(q=>q.reason!=='not_reached').length} max={interview.totalCore} aria-label="访谈流程进度"></progress></div>
    <section class="grow py-4 sm:py-8" aria-busy={busy}>
      {#if editing && study.available}
        <button class="btn btn-ghost btn-sm mb-4" disabled={busy} onclick={()=>editing=null}>取消修改</button>
        {#key editing.question.id}<QuestionInput question={editing.question} initial={editing.value} submitLabel="保存修改" disabled={busy} onanswer={(value,nonresponse)=>act({action:"revise",answer:{questionId:editing!.question.id,value,nonresponse}})} />{/key}
      {:else if interview.paceCheck && study.available}
        <div class="space-y-6"><h2 class="text-xl font-medium">接下来，你想怎样继续？</h2><div class="flex flex-wrap gap-3"><button class="btn btn-primary" disabled={busy} onclick={() => act({ action: 'resume' })}>继续访谈</button><button class="btn" disabled={busy} onclick={() => act({ action: 'finish' })}>今天先到这里</button></div></div>
      {:else if interview.processing && study.available}
        <div class="flex items-center gap-3" role="status" aria-label="正在准备下一题"><span class="loading loading-spinner loading-sm" aria-hidden="true"></span><button class="btn btn-ghost btn-sm" disabled={busy} onclick={async()=>{try{interview=await researchRequest<InterviewView>(endpoint);}catch(e){failure=e instanceof Error?e.message:'请重试。';}}}>查看进度</button></div>
      {:else if interview.current && study.available}
        {#if interview.answers.length}<p class="text-base-content/60 mb-6 text-sm" aria-live="polite">{interview.message}</p>{/if}
        {#key interview.current.id}<QuestionInput question={interview.current} draftKey={interview.draftKey+":"+interview.current.id} disabled={busy} onanswer={answer} />{/key}
      {:else if interview.status === 'complete'}
        <div class="space-y-4 py-8 text-center"><span class="icon-[lucide--check] text-success mx-auto block size-10" aria-hidden="true"></span><h2 class="text-xl font-medium">访谈已结束</h2><p class="text-base-content/60 text-sm">{interview.message}</p></div>
      {:else}<p class="text-base-content/60">收集已结束</p>{/if}
    </section>
    {#if interview.answers.length}
      <Disclosure class="border-base-300 border-t py-2" triggerClass="text-base-content/50 py-3 text-xs">
        {#snippet trigger(open)}<span>查看作答记录</span><span class={['icon-[lucide--chevron-down] ml-auto size-3 transition-transform', open && 'rotate-180']} aria-hidden="true"></span>{/snippet}
        <ol class="space-y-5 py-4 text-sm">{#each interview.answers as a (a.question.id)}<li><div class="flex items-start gap-3"><p class="flex-1">{a.question.prompt}</p>{#if study.available}<button class="btn btn-ghost btn-xs" aria-label={`修改：${a.question.prompt}`} disabled={busy} onclick={()=>editing=a}>修改</button>{/if}</div><p class="text-base-content/60 mt-1 whitespace-pre-wrap break-words">{display(a)}</p></li>{/each}</ol>
      </Disclosure>
    {/if}
    <footer class="text-base-content/50 mt-3 flex justify-between text-xs"><div>{#if study.available && interview.answers.length && !editing}<button class="btn btn-ghost btn-sm" disabled={busy} onclick={()=>editing=interview!.answers.at(-1)!}><span class="icon-[lucide--arrow-left] size-4" aria-hidden="true"></span>上一题</button>{/if}</div>{#if interview.status === 'active'}<button class="btn btn-ghost btn-xs" disabled={busy} onclick={() => dialog = 'finish'}>结束访谈</button>{/if}</footer>
  {/if}
  {#if failure}<p role="alert" class="text-error mt-5 text-sm">{failure}</p>{#if reloadRequired}<button type="button" class="btn btn-outline btn-sm mt-3" onclick={()=>location.reload()}>刷新页面</button>{/if}{/if}
</main>

<Modal open={dialog === 'info'} onOpenChange={open => { if (!open) dialog = null; }} title="参与说明" placement="bottom">
  <div class="space-y-5 text-sm leading-relaxed"><p>{study.purpose}</p><p class="text-base-content/70">访谈由 AI 主持，回答交由本研究使用的 AI 服务处理，研究者可查看和导出。你可以按各题提供的选项作答，随时结束或撤回。</p><dl class="grid grid-cols-[5rem_1fr] gap-3"><dt class="text-base-content/50">保存期限</dt><dd>研究发布后 {study.retentionDays} 天</dd><dt class="text-base-content/50">联系研究者</dt><dd class="break-words">{study.contact}</dd></dl><Disclosure triggerClass="text-base-content/60 text-xs py-2">{#snippet trigger(open)}<span>续答与数据删除</span><span class={['icon-[lucide--chevron-down] ml-2 size-3', open && 'rotate-180']} aria-hidden="true"></span>{/snippet}<p class="text-base-content/60 mt-2 text-xs">当前标签页暂存未提交的草稿，刷新后可继续填写。页面前后台与最近连接时间用于判断续答状态。保留本浏览器的 Cookie 可继续访谈或撤回。到期后应用删除回答；已导出的副本请联系研究者处理。</p></Disclosure>{#if interview}<button class="btn btn-ghost btn-sm" disabled={busy} onclick={()=>dialog="withdraw"}>撤回回答</button>{/if}</div>
</Modal>
<Modal open={dialog === 'withdraw'} onOpenChange={open => { if (!open && !busy) dialog = null; }} title="撤回本次回答？" closeButton="none">
  <p class="text-base-content/70 text-sm">应用中的回答将永久删除。已导出副本请联系研究者处理。</p>
  {#snippet footer()}<button class="btn" disabled={busy} onclick={() => dialog = null}>保留</button><button class="btn btn-error" disabled={busy} onclick={withdraw}>撤回</button>{/snippet}
</Modal>
<Modal open={dialog === 'finish'} onOpenChange={open => { if (!open && !busy) dialog = null; }} title="结束这次访谈？" closeButton="none">
  <p class="text-base-content/70 text-sm">已回答的内容会保留。</p>
  {#snippet footer()}<button class="btn" disabled={busy} onclick={() => dialog = null}>继续访谈</button><button class="btn btn-primary" disabled={busy} onclick={() => act({ action: 'finish' })}>结束</button>{/snippet}
</Modal>
