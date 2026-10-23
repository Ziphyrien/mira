<script lang="ts">
  import { untrack } from 'svelte';
  import {page} from '$app/state';
  import {goto} from '$app/navigation';
  import { Tabs, Checkbox } from 'bits-ui';
  import Modal from '#lib/ui/Modal.svelte';
  import Disclosure from '#lib/ui/Disclosure.svelte';
  import CollectionNotes from './CollectionNotes.svelte';
  import AnalysisPanel from './AnalysisPanel.svelte';
  import type { ResearchStudy, ResearchPlan, StudyResults, ResearchPlanning } from '#lib/contracts/research.js';
  import { researchRequest } from './client';
  let { initial, initialResults, onback, ondelete, onplanning }: { initial: ResearchStudy; initialResults: StudyResults; onback?: () => void; ondelete: () => void; onplanning:(job:ResearchPlanning)=>void } = $props();
  let study = $state.raw(untrack(() => initial));
  let results = $state.raw(untrack(() => initialResults));
  const currentUrl=$derived(page.shallow?.url??page.url);
  const tab=$derived(['plan','data','analysis'].includes(currentUrl.searchParams.get('tab')??'')?currentUrl.searchParams.get('tab')!:'plan');
  function selectTab(value:string){const url=new URL(currentUrl.href);url.searchParams.set('tab',value);return goto(url,{shallow:true,replace:true,state:page.state});}
  const liveStudy=$derived(tab==='data'&&study.status==='published'?study.id:null);
  $effect(()=>{
    const id=liveStudy;if(!id)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,inFlight=false;
    async function update(){
      if(timer!==undefined)clearTimeout(timer);
      if(inFlight||controller.signal.aborted)return;
      if(document.visibilityState==='visible'&&!untrack(()=>busy)){
        inFlight=true;
        try{const data=await researchRequest<{results:StudyResults}>('/api/research/'+id,undefined,'GET',AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));if(!controller.signal.aborted)results=data.results;}
        catch{/* Keep the last timestamped snapshot until the connection recovers. */}
        finally{inFlight=false;}
      }
      if(!controller.signal.aborted)timer=setTimeout(update,20000);
    }
    void update();document.addEventListener('visibilitychange',update);
    return ()=>{controller.abort();if(timer!==undefined)clearTimeout(timer);document.removeEventListener('visibilitychange',update);};
  });
  let reviewed = $state(false);
  let busy = $state(false);
  let failure = $state('');
  let copied = $state(false);
  let sharePath = $state('');
  async function share() { busy=true; failure='';try {const data=await researchRequest<{path:string}>('/api/research/'+study.id,{action:'share'});sharePath=data.path;copied=false;dialog='share';}catch(e){failure=e instanceof Error?e.message:'请重试。';}finally{busy=false;} }
  let title = $state('');
  let dialog = $state<'publish' | 'share' | 'close' | 'rename' | 'refine' | null>(null);
  async function rename(event: SubmitEvent) { event.preventDefault(); busy = true; failure = ''; try { study = await researchRequest<ResearchStudy>('/api/research/' + study.id, { action: 'rename', title }); dialog = null; } catch (e) { failure = e instanceof Error ? e.message : '请重试。'; } finally { busy = false; } }
  let instruction=$state('');
  let participation=$state({population:'',purpose:'',contact:'',eligibility:'',retentionDays:undefined as number|undefined});
  function openPublication(){participation={population:study.brief.population||study.plan.participationProposal.population,purpose:study.brief.purpose||study.plan.participationProposal.purpose,contact:study.brief.contact,eligibility:study.brief.eligibility||study.plan.participationProposal.eligibility,retentionDays:study.brief.retentionDays??undefined};reviewed=false;dialog='publish';}
  async function refine(event:SubmitEvent){event.preventDefault();busy=true;failure='';try{const job=await researchRequest<ResearchPlanning>('/api/research/'+study.id,{action:'refine',instruction});dialog=null;onplanning(job);}catch(e){failure=e instanceof Error?e.message:'请重试。';}finally{busy=false;}}
  let editor = $state<{ questionId?: string } | null>(null);
  const names = { text: '文字', single: '单选', multiple: '多选', select: '下拉', rating: '评分', slider: '滑块', number: '数字' };
  const statusNames = { draft: '草稿', published: '收集中', closed: '已结束' };
  function fmt(n: number | null) { return n === null ? '—' : n.toFixed(2); }
  async function refresh() { busy = true; failure = ''; try { const data = await researchRequest<{ study: ResearchStudy; results: StudyResults }>('/api/research/' + study.id); study = data.study; results = data.results; } catch (e) { failure = e instanceof Error ? e.message : '请重试。'; } finally { busy = false; } }
  async function save(plan: ResearchPlan) { study = await researchRequest<ResearchStudy>('/api/research/' + study.id, { action: 'save', plan }); reviewed = false; }
  async function act(action: 'publish' | 'close' | 'reopen') { busy = true; failure = ''; try { study = await researchRequest<ResearchStudy>('/api/research/' + study.id, { action, reviewed, ...(action==='publish'?{participation}:{}) }); dialog = null;if(action==='close')await selectTab('analysis');if(action==='publish')await share();else await refresh(); } catch (e) { failure = e instanceof Error ? e.message : '请重试。'; } finally { busy = false; } }
  async function copy() { try { await navigator.clipboard.writeText(location.origin + sharePath); copied = true; } catch { failure = '请打开参与页面，从地址栏复制链接。'; } }
</script>

<div class="mb-6 flex items-start gap-3">{#if onback}<button class="btn btn-ghost btn-sm btn-circle shrink-0" aria-label="返回研究列表" onclick={onback}><span class="icon-[lucide--arrow-left] size-4" aria-hidden="true"></span></button>{/if}<div class="min-w-0 flex-1"><div class="flex items-start gap-2"><h1 class="text-xl font-semibold sm:text-2xl">{study.plan.title}</h1><button class="btn btn-ghost btn-xs btn-circle shrink-0" aria-label="修改展示标题" disabled={busy} onclick={() => { title = study.plan.title; failure = ''; dialog = 'rename'; }}><span class="icon-[lucide--pencil] size-3.5" aria-hidden="true"></span></button></div><span class="badge badge-soft badge-sm mt-2">{statusNames[study.status]}</span></div>{#if study.status === 'draft'}<button class="btn btn-primary btn-sm shrink-0" onclick={openPublication}>发布</button>{:else}<button class="btn btn-primary btn-sm shrink-0" disabled={busy} onclick={share}><span class="icon-[lucide--link] size-4" aria-hidden="true"></span>分享</button>{/if}<button class="btn btn-ghost btn-sm btn-circle shrink-0" aria-label="删除研究" onclick={ondelete}><span class="icon-[lucide--trash-2] size-4" aria-hidden="true"></span></button></div>
{#if failure}<p class="text-error mb-4 text-sm" role="alert">{failure}</p>{/if}
<Tabs.Root value={tab} onValueChange={selectTab}>
  <Tabs.List class="tabs tabs-border mb-6" aria-label="研究详情"><Tabs.Trigger value="plan" class="tab data-[state=active]:tab-active">方案</Tabs.Trigger><Tabs.Trigger value="analysis" class="tab data-[state=active]:tab-active">分析</Tabs.Trigger><Tabs.Trigger value="data" class="tab data-[state=active]:tab-active">数据<span class="badge badge-ghost badge-sm ml-2">{results.sessions}</span></Tabs.Trigger></Tabs.List>
  <Tabs.Content value="plan" class="space-y-6">
    {#if study.status==='draft'}<button class="btn btn-outline btn-sm" onclick={()=>dialog='refine'}><span class="icon-[lucide--message-square] size-4" aria-hidden="true"></span>让助手调整方案</button>{/if}
    <section class="card border-base-300 border"><div class="card-body gap-4 p-5 sm:p-6"><div class="flex items-start justify-between gap-3"><p class="text-lg leading-relaxed">{study.plan.question}</p>{#if study.status === 'draft'}<button class="btn btn-ghost btn-sm btn-circle shrink-0" aria-label="编辑研究方案" onclick={() => editor = {}}><span class="icon-[lucide--pencil] size-4" aria-hidden="true"></span></button>{/if}</div><p class="text-base-content/60 text-sm">{study.brief.population}</p><div class="text-base-content/50 flex flex-wrap gap-4 text-xs"><span class="flex items-center gap-1.5"><span class="icon-[lucide--clock-3] size-3.5" aria-hidden="true"></span>{study.plan.estimatedMinutes} 分钟</span><span>{study.brief.retentionDays} 天保存</span></div>
      <Disclosure triggerClass="text-base-content/60 text-xs pt-2">{#snippet trigger(open)}<span>课题调整</span><span class={['icon-[lucide--chevron-down] ml-2 size-3', open && 'rotate-180']} aria-hidden="true"></span>{/snippet}<div class="mt-3 space-y-2 text-sm"><p class="text-base-content/50">{study.brief.topic}</p><p>{study.plan.topicReview}</p></div></Disclosure>
    </div></section>
    <section><h2 class="mb-3 flex items-center gap-2 font-medium">问题<span class="badge badge-ghost badge-sm">{study.plan.questions.length}</span></h2><ol class="divide-base-300 border-base-300 divide-y rounded-box border">{#each study.plan.questions as q, index (q.id)}<li><button class="hover:bg-base-200 flex w-full items-start gap-3 p-4 text-left" onclick={() => editor = { questionId: q.id }}><span class="text-base-content/35 w-5 shrink-0 text-sm tabular-nums">{index + 1}</span><span class="flex-1 text-sm leading-relaxed">{q.prompt}</span><span class="badge badge-ghost badge-sm shrink-0">{names[q.kind]}</span><span class="icon-[lucide--chevron-right] text-base-content/35 mt-1 size-3 shrink-0" aria-hidden="true"></span></button></li>{/each}</ol></section>
    <div class="divide-base-300 border-base-300 divide-y border-y">
      <Disclosure triggerClass="py-4 font-medium text-sm">{#snippet trigger(open)}<span>研究方法</span><span class={['icon-[lucide--chevron-down] ml-auto size-4', open && 'rotate-180']} aria-hidden="true"></span>{/snippet}<dl class="space-y-4 pb-5 text-sm">{#each ([['设计', study.plan.methodology.design], ['对象范围评估', study.plan.population], ['分析单位', study.plan.methodology.unitOfAnalysis], ['估计目标', study.plan.methodology.estimand], ['样本量', study.plan.methodology.sampleSizeRationale], ['抽样与招募', study.plan.sampling + ' ' + study.plan.recruitment], ['偏差处理', study.plan.methodology.biasControls], ['补充追问', (study.plan.followupPolicy.enabled ? '启用。' : '不启用。') + study.plan.followupPolicy.rationale], ['预试', study.plan.pilot], ['测量验证', study.plan.methodology.validationPlan]] as const) as [label, text] (label)}<div><dt class="text-base-content/50 mb-1 text-xs">{label}</dt><dd class="leading-relaxed">{text}</dd></div>{/each}</dl></Disclosure>
      <Disclosure triggerClass="py-4 font-medium text-sm">{#snippet trigger(open)}<span>测量维度</span><span class={['icon-[lucide--chevron-down] ml-auto size-4', open && 'rotate-180']} aria-hidden="true"></span>{/snippet}<div class="space-y-5 pb-5">{#each study.plan.constructs as c (c.id)}<div class="space-y-2 text-sm"><h3 class="font-medium">{c.name}<span class="badge badge-ghost badge-sm ml-2">{c.scoring === 'exploratory_mean' ? '探索性均值' : '逐题描述'}</span></h3><p>{c.definition}</p><p class="text-base-content/60">{c.evidence}</p><p class="text-base-content/60">{c.interpretation}</p></div>{/each}</div></Disclosure>
      <Disclosure triggerClass="py-4 font-medium text-sm">{#snippet trigger(open)}<span>参考资料</span><span class="badge badge-ghost badge-sm ml-2">{study.sources.length}</span><span class={['icon-[lucide--chevron-down] ml-auto size-4', open && 'rotate-180']} aria-hidden="true"></span>{/snippet}<ul class="space-y-4 pb-5">{#each study.sources as source (source.url)}<li class="space-y-1 text-sm"><a class="link link-hover text-primary" href={source.url} target="_blank" rel="noreferrer">{source.title}<span class="icon-[lucide--arrow-up-right] ml-1 size-3" aria-hidden="true"></span></a><p class="text-base-content/50 text-xs">{source.access === 'page_extract' ? '网页摘录' : '检索摘要'}</p><Disclosure triggerClass="text-base-content/50 text-xs py-1">{#snippet trigger(open)}<span>{open ? '收起摘录' : '查看摘录'}</span>{/snippet}<p class="text-base-content/60 mt-2 whitespace-pre-wrap leading-relaxed">{source.excerpt}</p></Disclosure></li>{/each}</ul></Disclosure>
    </div>
  </Tabs.Content>
  <Tabs.Content value="data" class="space-y-6">
    {#if study.status!=='draft'}<CollectionNotes {study} onupdate={next=>study=next} />{/if}
    <div class="flex items-center justify-between gap-3"><div class="flex flex-wrap gap-3"><a class="btn btn-outline btn-sm" href={'/api/research/' + study.id + '/export?format=csv'} download><span class="icon-[lucide--download] size-4" aria-hidden="true"></span>CSV</a><a class="btn btn-ghost btn-sm" href={'/api/research/' + study.id + '/export?format=json'} download>完整数据</a></div><button class="btn btn-ghost btn-sm btn-circle" aria-label="刷新数据" disabled={busy} onclick={refresh}><span class={busy ? 'loading loading-spinner loading-xs' : 'icon-[lucide--refresh-cw] size-4'} aria-hidden="true"></span></button></div>
    <div class="stats border-base-300 w-full border"><div class="stat min-w-0 px-4"><div class="stat-title text-xs">已开始</div><div class="stat-value text-2xl">{results.sessions}</div></div><div class="stat min-w-0 px-4"><div class="stat-title text-xs">已结束</div><div class="stat-value text-2xl">{results.completed}</div></div><div class="stat min-w-0 px-4"><div class="stat-title text-xs">作答中</div><div class="stat-value text-2xl">{results.ongoing}</div></div><div class="stat min-w-0 px-4"><div class="stat-title text-xs">已暂停</div><div class="stat-value text-2xl">{results.paused}</div></div></div>
    <p class="text-base-content/50 text-xs">统计截至 {new Date(results.observedAt).toLocaleString()}</p>
    <Disclosure triggerClass="text-base-content/60 py-2 text-sm">{#snippet trigger(open)}<span>作答状态与完整度</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',open&&'rotate-180']}></span>{/snippet}
      <div class="mt-3 space-y-3 text-sm"><p>按流程结束 {results.endings.protocol} · 主动结束 {results.endings.participant} · 按所选路径结束 {results.endings.plan}</p><p>超期未续答 {results.windowElapsed} · 收集截止仍未结束 {results.unresolvedAtClose}</p>
      {#if study.plan.progressPolicy}<p class="text-base-content/60 text-xs">续答期限：最近一次作答操作后 {study.plan.progressPolicy.returnWindowHours} 小时。{study.plan.progressPolicy.rationale} 超期后本次作答记为已结束，收集开放时仍可回来继续。</p>{:else}<p class="text-base-content/60 text-xs">本方案未设独立的续答观察窗口；暂停后仍可在收集开放期间续答，等待时长随导出保留。</p>{/if}
      {#if study.plan.responseCriteria}<p class="text-base-content/60 text-xs">{study.plan.responseCriteria.rationale}</p><p>按方案达到完整要求 {results.dispositions.complete} · 达到部分资料要求 {results.dispositions.partial} · 低于要求 {results.dispositions.below_criteria} · 待观察 {results.dispositions.pending} · 尚未分类 {results.dispositions.unclassified}</p>{/if}
      <p class="text-base-content/60 text-xs">未到达的题目包含仍可续答的记录。导出包含每份记录的观察状态、时间、覆盖比例分子分母和逐题分状态描述。</p></div>
    </Disclosure>
    <p class="text-base-content/60 text-sm">有实质回答 {results.withResponses} 份 · 无实质回答 {results.noResponses} 份</p>
    {#if results.sessions === 0}<div class="py-10 text-center"><span class="icon-[lucide--chart-no-axes-column] text-base-content/25 mx-auto mb-3 block size-9" aria-hidden="true"></span><p class="text-base-content/50 text-sm">等待第一份回答</p></div>
    {:else}
      {#if study.plan.constructs.some(c => c.scoring === 'exploratory_mean')}<section><h2 class="mb-3 text-sm font-medium">探索性指标</h2><div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>维度</th><th>完整样本</th><th>均值 / 100</th><th>标准差</th></tr></thead><tbody>{#each results.constructs.filter(c => study.plan.constructs.find(p => p.id === c.id)?.scoring === 'exploratory_mean') as c (c.id)}<tr><td>{c.name}</td><td>{c.summary.n}</td><td class="tabular-nums">{fmt(c.summary.mean)}</td><td>{fmt(c.summary.sd)}</td></tr>{/each}</tbody></table></div></section>{/if}
      <section><h2 class="mb-3 text-sm font-medium">逐题结果</h2><div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>问题</th><th>有效</th><th>主动未答</th><th>不适用</th><th>前置资料缺失</th><th>未到达</th><th>结果</th></tr></thead><tbody>{#each results.items as item (item.id)}<tr><td class="min-w-48 max-w-sm whitespace-normal">{item.prompt}</td><td>{item.n}</td><td>{item.skipped}{#each item.nonresponses.filter(n=>n.count>0) as reason (reason.id)}<div class="text-base-content/50 text-xs">{reason.label}：{reason.count}</div>{/each}</td><td>{item.notApplicable}</td><td>{item.prerequisiteMissing}</td><td>{item.notAsked}</td><td>{#if item.numeric}{fmt(item.numeric.mean)}{:else if item.choices.length}{#each item.choices as choice (choice.id)}<div class="whitespace-nowrap">{choice.label} <span class="text-base-content/50">{choice.count}</span></div>{/each}{:else}<span class="text-base-content/50">见导出</span>{/if}</td></tr>{/each}</tbody></table></div></section>
    {/if}
    <Disclosure triggerClass="text-base-content/50 text-xs py-2">{#snippet trigger(open)}<span class="icon-[lucide--info] mr-1.5 size-3.5" aria-hidden="true"></span><span>统计说明</span><span class={['icon-[lucide--chevron-down] ml-2 size-3', open && 'rotate-180']} aria-hidden="true"></span>{/snippet}<div class="text-base-content/60 mt-3 space-y-3 text-xs leading-relaxed">{#each results.limitations as text (text)}<p>{text}</p>{/each}{#each study.plan.limitations as text (text)}<p>{text}</p>{/each}</div></Disclosure>

  </Tabs.Content>
  <Tabs.Content value="analysis" class="space-y-6"><AnalysisPanel {study}/></Tabs.Content>
</Tabs.Root>
<div class="mt-6 border-t border-base-300 pt-5">
    {#if study.status === 'published'}<button class="btn btn-ghost btn-sm text-base-content/50" onclick={() => dialog = 'close'}>结束收集</button>{:else if study.status==='closed'&&study.expiresAt&&Date.now()<study.expiresAt}<button class="btn btn-outline btn-sm" disabled={busy} onclick={()=>act('reopen')}>继续收集</button>{/if}
</div>

<Modal open={dialog === 'rename'} onOpenChange={open => { if (!open && !busy) dialog = null; }} title="修改展示标题" closeButton="none">
  <form class="space-y-5" onsubmit={rename}>
    <div class="fieldset"><label class="fieldset-legend" for="display-title">参与者看到的标题</label><input id="display-title" class="input w-full" bind:value={title} maxlength="100" required /><p class="text-base-content/60 text-xs">用简短、自然的话说明访谈主题。</p></div>
    {#if failure}<p class="text-error text-sm" role="alert">{failure}</p>{/if}
    <div class="modal-action"><button type="button" class="btn btn-ghost" disabled={busy} onclick={() => dialog = null}>取消</button><button type="submit" class="btn btn-primary" disabled={busy || !title.trim()}>保存</button></div>
  </form>
</Modal>
{#if editor}{#await import('./PlanEditor.svelte')}<div class="fixed inset-0 z-50 grid place-items-center bg-base-100/60" role="status" aria-label="打开编辑器"><span class="loading loading-spinner text-primary" aria-hidden="true"></span></div>{:then module}<module.default initial={study.plan} questionId={editor.questionId} readonly={study.status !== 'draft'} onsave={save} onclose={() => editor = null} />{:catch}<p role="alert" class="text-error text-sm">编辑器暂未打开，请关闭后重试。</p><button class="btn btn-ghost btn-sm" onclick={()=>editor=null}>关闭</button>{/await}{/if}
<Modal open={dialog === 'publish'} onOpenChange={open => { if (!open && !busy) dialog = null; }} title="发布研究？" closeButton="none">
  <p class="text-base-content/70 text-sm">确认参与者将看到的说明和实际安排，发布后即可分享。</p>
  <fieldset class="mt-4 space-y-3" disabled={busy}>
    <label class="fieldset"><span class="fieldset-legend">邀请谁参与？</span><textarea class="textarea w-full" bind:value={participation.population} maxlength="400" required></textarea></label>
    <label class="fieldset"><span class="fieldset-legend">研究用途</span><textarea class="textarea w-full" bind:value={participation.purpose} maxlength="1000" required></textarea><span class="text-base-content/60 text-xs">说明结果用来做什么，以及回答由谁查看、如何使用。</span></label>
    <label class="fieldset"><span class="fieldset-legend">研究者联系方式</span><input class="input w-full" bind:value={participation.contact} maxlength="300" required /></label>
    <label class="fieldset"><span class="fieldset-legend">回答保存多少天？</span><input class="input w-full" type="number" min="1" step="1" bind:value={participation.retentionDays} required /></label>
    <Disclosure triggerClass="text-base-content/60 text-sm py-2">{#snippet trigger(expanded)}<span>参与条件（如有）</span><span class={['icon-[lucide--chevron-down] ml-auto size-4',expanded&&'rotate-180']}></span>{/snippet}<textarea class="textarea w-full" aria-label="参与条件" bind:value={participation.eligibility} maxlength="400"></textarea></Disclosure>
  </fieldset><label class="mt-5 flex items-start gap-3 text-sm"><Checkbox.Root class="checkbox checkbox-sm mt-0.5 shrink-0" bind:checked={reviewed} aria-label="已审阅方案与参与说明，完成发布准备" /><span>已审阅方案与参与说明，完成发布准备</span></label>
  {#snippet footer()}<button class="btn btn-ghost" disabled={busy} onclick={() => dialog = null}>取消</button><button class="btn btn-primary" disabled={!reviewed || busy} onclick={() => act('publish')}>发布</button>{/snippet}
</Modal>
<Modal open={dialog==='refine'} onOpenChange={open=>{if(!open&&!busy)dialog=null;}} title="调整研究方案" closeButton="none">
  <form class="space-y-4" onsubmit={refine}><label class="fieldset"><span class="fieldset-legend">希望怎样调整？</span><textarea class="textarea min-h-40 w-full" bind:value={instruction} maxlength="12000" required disabled={busy}></textarea></label><p class="text-base-content/60 text-xs">调整后可重新审阅，原方案会保留到新方案准备完成。</p>{#if failure}<p class="text-error text-sm" role="alert">{failure}</p>{/if}<div class="modal-action"><button type="button" class="btn btn-ghost" disabled={busy} onclick={()=>dialog=null}>取消</button><button type="submit" class="btn btn-primary" disabled={busy}>调整方案</button></div></form>
</Modal>
<Modal open={dialog === 'share'} onOpenChange={open => { if (!open) dialog = null; }} title="邀请参与" closeButton="icon">
  <div class="space-y-5"><div class="bg-base-200 rounded-box p-4"><p class="text-sm font-medium">{study.plan.title}</p><p class="text-base-content/50 mt-2 text-xs">约 {study.plan.estimatedMinutes} 分钟</p></div><div class="flex gap-3"><button class="btn btn-primary flex-1" onclick={copy}><span class={copied ? 'icon-[lucide--check] size-4' : 'icon-[lucide--copy] size-4'} aria-hidden="true"></span>{copied ? '已复制' : '复制链接'}</button><a class="btn btn-outline" href={sharePath} target="_blank" rel="noreferrer">打开参与页面<span class="icon-[lucide--arrow-up-right] size-4" aria-hidden="true"></span></a></div></div>
</Modal>
<Modal open={dialog === 'close'} onOpenChange={open => { if (!open && !busy) dialog = null; }} title="结束收集？" closeButton="none">
  <p class="text-base-content/70 text-sm">停止接收新回答，并根据本轮数据生成分析。保存期限内可以继续收集，已有分析保留对应的截止时间。</p>{#snippet footer()}<button class="btn btn-ghost" disabled={busy} onclick={() => dialog = null}>取消</button><button class="btn btn-primary" disabled={busy} onclick={() => act('close')}>结束收集</button>{/snippet}
</Modal>
