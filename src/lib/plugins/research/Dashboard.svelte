<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '#lib/ui/Modal.svelte';
  import type { StudyListing, StudySummary, ResearchPlanning, ResearchInspection } from '#lib/contracts/research.js';
  import { researchRequest } from './client';
  import StudyDetail from './StudyDetail.svelte';
  import StudyPreparation from './StudyPreparation.svelte';
  import CreateStudy from './CreateStudy.svelte';
  let { authenticated, initial }: { authenticated: boolean; initial: StudySummary[] } = $props();
  let studies = $state.raw(untrack(() => initial));
  let selected = $state.raw<ResearchInspection | null>(null);
  let creating = $state(false);
  let deleting = $state<StudyListing | null>(null);
  let removing = $state(false);
  let busy = $state(false);
  let refreshing = $state(false);
  let failure = $state('');
  const statuses: Record<StudySummary['status'], string> = {planning:'生成中',clarifying:'待补充',failed:'生成失败',draft:'待发布',published:'收集中',closed:'已结束',unavailable:'状态暂不可用'};
  let refreshList = () => {};
  $effect(() => {
    if (!authenticated || selected || creating) return;
    let active = true;
    let loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (!active || loading) return;
      clearTimeout(timer); loading = true; refreshing = true;
      try {
        const result = await researchRequest<StudySummary[]>('/api/research');
        if (active) { studies = result; failure = ''; }
      } catch (e) { if (active) failure = e instanceof Error ? e.message : '列表暂未刷新，请重试。'; }
      finally {
        loading = false;
        if (active) { refreshing = false; timer = setTimeout(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000); }
      }
    }
    refreshList = () => { void refresh(); };
    void refresh();
    return () => { active = false; clearTimeout(timer); refreshList = () => {}; refreshing = false; };
  });
  async function remove() {
    if (!deleting) return;
    removing = true; failure = '';
    try {
      const id = deleting.id;
      const current = await researchRequest<ResearchInspection>('/api/research/' + id);
      if (current.status === 'ready' && current.study.status === 'published') await researchRequest('/api/research/' + id, {action:'close'});
      await researchRequest('/api/research/' + id, undefined, 'DELETE');
      studies = studies.filter(s => s.id !== id); selected = null; deleting = null;
    } catch (e) { failure = e instanceof Error ? e.message : '请重试。'; }
    finally { removing = false; }
  }
  async function open(id: string) {
    busy = true; failure = '';
    try { selected = await researchRequest('/api/research/' + id); }
    catch (e) { failure = e instanceof Error ? e.message : '请重试。'; }
    finally { busy = false; }
  }
  function back() { selected = null; failure = ''; }
  function requestDelete() {
    if (!selected) return;
    deleting = selected.status === 'ready' ? {id:selected.study.id,topic:selected.study.plan.title,createdAt:selected.study.createdAt} : selected;
  }
  async function created(study: ResearchPlanning) {
    studies = [{id:study.id,topic:study.topic,createdAt:study.createdAt,status:study.status}, ...studies];
    await open(study.id);
  }
</script>

<svelte:window onfocus={() => refreshList()} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === 'visible') refreshList(); }} />
<svelte:head><title>研究 · Mira</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="mx-auto max-w-5xl p-5 sm:p-8">
  <header class="mb-8 flex items-center justify-between gap-4"><a href="/research" class="text-lg font-semibold">Mira <span class="text-base-content/40 font-normal">/ 研究</span></a><a href="/admin" class="btn btn-ghost btn-sm">管理后台<span class="icon-[lucide--arrow-up-right] size-4" aria-hidden="true"></span></a></header>
  {#if !authenticated}
    <div class="mx-auto max-w-sm space-y-5 py-24 text-center"><span class="icon-[lucide--lock-keyhole] text-base-content/35 mx-auto block size-9" aria-hidden="true"></span><h1 class="text-xl font-medium">登录研究工作台</h1><a href="/admin" class="btn btn-primary">管理员登录</a></div>
  {:else if selected}
    {#if selected.status === 'ready'}
      {#key selected.study.id}<StudyDetail onplanning={job=>selected=job} initial={selected.study} initialResults={selected.results} onback={back} ondelete={requestDelete} />{/key}
    {:else}
      {#key selected.id}<StudyPreparation initial={selected} onready={ready => selected = ready} onback={back} ondelete={requestDelete} />{/key}
    {/if}
  {:else}
    <div class="mb-6 flex items-center justify-between gap-3"><h1 class="text-2xl font-semibold">研究</h1><div class="flex items-center gap-2"><button class="btn btn-ghost btn-sm btn-circle" aria-label="刷新研究列表" disabled={refreshing} onclick={() => refreshList()}><span class={refreshing ? 'loading loading-spinner loading-xs' : 'icon-[lucide--refresh-cw] size-4'} aria-hidden="true"></span></button><button class="btn btn-primary btn-sm" disabled={busy} onclick={() => creating = true}><span class="icon-[lucide--plus] size-4" aria-hidden="true"></span>新建研究</button></div></div>
    {#if studies.length}
      <div class="divide-base-300 border-base-300 divide-y rounded-box border">
        {#each studies as study (study.id)}
          <button class="hover:bg-base-200 flex w-full items-center gap-4 p-5 text-left transition-colors disabled:opacity-50" disabled={busy} onclick={() => open(study.id)}><span class="icon-[lucide--clipboard-list] text-base-content/40 size-5 shrink-0" aria-hidden="true"></span><span class="min-w-0 flex-1"><span class="block truncate font-medium">{study.topic}</span><span class="text-base-content/50 mt-1 block text-xs">{new Date(study.createdAt).toLocaleDateString('zh-CN')}</span></span><span class={['badge badge-soft badge-sm shrink-0',study.status === 'failed' && 'badge-error',study.status === 'planning' && 'badge-info',study.status === 'published' && 'badge-success']}>{statuses[study.status]}</span><span class="icon-[lucide--chevron-right] text-base-content/40 size-4" aria-hidden="true"></span></button>
        {/each}
      </div>
    {:else}<div class="border-base-300 rounded-box border border-dashed py-20 text-center"><span class="icon-[lucide--clipboard-list] text-base-content/25 mx-auto mb-4 block size-10" aria-hidden="true"></span><p class="text-base-content/50 text-sm">还没有研究</p></div>{/if}
    {#if busy}<div class="mt-6 flex justify-center" role="status" aria-label="加载中"><span class="loading loading-spinner loading-sm"></span></div>{/if}
  {/if}
  {#if failure}<p class="text-error mt-4 text-sm" role="alert">{failure}</p>{/if}
</main>
<Modal open={deleting !== null} onOpenChange={open => { if (!open && !removing) deleting = null; }} title="删除研究？" closeButton="none">
  <p class="font-medium">{deleting?.topic}</p><p class="text-base-content/60 mt-3 text-sm">方案和已收集的回答将永久删除，正在生成的方案会取消，分享链接随即失效。</p>
  {#if failure}<p class="text-error mt-3 text-sm" role="alert">{failure}</p>{/if}
  {#snippet footer()}<button class="btn btn-ghost" disabled={removing} onclick={() => deleting = null}>取消</button><button class="btn btn-error" disabled={removing} onclick={remove}>删除</button>{/snippet}
</Modal>
{#if creating}<CreateStudy open={creating} onclose={() => creating = false} oncreated={created} />{/if}
