<script lang="ts">
  import { untrack } from "svelte";
  import { Tabs } from "bits-ui";
  import Modal from "#lib/ui/Modal.svelte";
  import ConfirmAction from "#lib/ui/ConfirmAction.svelte";
  import { useSnapshot } from "#lib/app/adapter.svelte.js";
  import { ago } from "#lib/app/time.js";
  import type { AdminAppHost } from "#lib/app/admin-host.js";

  let { host }: { host: AdminAppHost } = $props();
  const admin = untrack(() => host.admin);
  const snap = useSnapshot(admin.view!);
  const sections = $derived(host.getSections());

  let token = $state("");
  let q = $state("");
  const detailLoading = $derived(!snap().detail && !snap().detailError);

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    await admin.login(token);
    token = "";
  }

  async function handleLogout() {
    await admin.logout(null);
  }

  async function handleSearch(e: SubmitEvent) {
    e.preventDefault();
    await admin.list(q);
  }

</script>

<main class="mx-auto max-w-6xl p-6">
  <header class="mb-6 flex items-center justify-between">
    <h1 class="text-xl font-semibold">Mira 管理后台</h1>
    {#if snap().admin}<button class="btn btn-ghost btn-sm" onclick={handleLogout}>
        <span class="icon-[lucide--log-out]"></span>
        退出
      </button>{/if}
  </header>

  {#if snap().error}
    <div
      class="border-error/30 bg-error/5 mb-4 flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
      role="alert"
    >
      <p class="text-error text-sm">{snap().error}</p>
      <button
        type="button"
        class="btn btn-ghost btn-sm shrink-0"
        aria-label="重新加载管理后台"
        onclick={() => admin.initialize(null)}
      >
        重新加载
      </button>
    </div>
  {/if}
  {#if snap().admin === null}
    {#if !snap().error}<span class="loading loading-spinner" aria-label="加载管理后台"></span>{/if}
  {:else if !snap().admin}
    <form class="card bg-base-200 mx-auto max-w-sm" onsubmit={handleLogin}>
      <div class="card-body gap-3">
        <label class="label" for="token">管理令牌</label>
        <input
          id="token"
          class="input w-full"
          type="password"
          autocomplete="current-password"
          bind:value={token}
          required
        />
        {#if snap().loginError}<p class="text-error text-sm" role="alert">
            {snap().loginError}
          </p>{/if}
        <button class="btn btn-primary" disabled={snap().loading}>
          {snap().loading ? "登录中..." : "登录"}
        </button>
      </div>
    </form>
  {:else if snap().list}
    {#each sections as section (section.key)}
      <section.component />
    {/each}
    <div class="stats bg-base-200 mb-6 w-full">
      <div class="stat">
        <div class="stat-title">空间</div>
        <div class="stat-value">{snap().list!.total}</div>
      </div>
      <div class="stat">
        <div class="stat-title">消息</div>
        <div class="stat-value">{snap().list!.messages}</div>
      </div>
      <div class="stat">
        <div class="stat-title">模型花费</div>
        <div class="stat-value">${snap().list!.cost.toFixed(2)}</div>
      </div>
    </div>
    <form class="mb-4 flex gap-2" onsubmit={handleSearch}>
      <input
        class="input w-full max-w-sm"
        placeholder="按称呼或 ID 搜索"
        bind:value={q}
        aria-label="搜索空间"
      />
      <button class="btn" disabled={snap().loading}>
        <span class="icon-[lucide--search]"></span>
        搜索
      </button>
    </form>
    <div class="overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>称呼</th>
            <th>ID</th>
            <th>消息</th>
            <th>最近活动</th>
            <th>花费</th>
          </tr>
        </thead>
        <tbody>
          {#each snap().list!.items as s (s.id)}
            <tr class="hover:bg-base-200">
              <td>
                <button
                  type="button"
                  class="link link-hover"
                  aria-label={`查看空间 ${s.name || s.id}`}
                  onclick={() => admin.open(s.id)}
                  >{s.name || "未命名空间"}</button
                >
              </td>
              <td class="font-mono text-xs">{s.id.slice(0, 12)}</td>
              <td>{s.messages}</td>
              <td>{ago(s.seen)}</td>
              <td>${s.cost.toFixed(4)}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="text-base-content/60">还没有空间</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</main>

<Modal open={!!snap().admin && snap().detailId !== null} onOpenChange={(open) => { if (!open) void admin.open(null); }} title={snap().detail ? (snap().detail!.profile?.name ?? "未完成引导") : "空间详情"} class="max-w-4xl">
  {#snippet titleExtra()}<span class="text-base-content/50 ml-2 font-mono text-xs">{snap().detail?.id ?? ""}</span>{/snippet}
    {#if detailLoading}
      <p class="flex items-center gap-2 py-6" role="status">
        <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
        正在加载空间详情…
      </p>
    {:else if snap().detailError}
      <p class="text-error py-6" role="alert">{snap().detailError}</p>
    {:else if snap().detail}
      {@const d = snap().detail!}
      <p class="text-base-content/70 mt-1 text-sm">
        {d.stats.messages} 条消息 · {d.stats.summaries} 条摘要 · 视图 {d.stats.viewLines} 行 · 待整理
        {d.stats.pending} · ${d.cost.toFixed(4)}
      </p>
      <Tabs.Root value="conversation" class="mt-4">
        <Tabs.List class="tabs tabs-border" aria-label="空间详情">
          <Tabs.Trigger value="conversation" class="tab">对话</Tabs.Trigger>
          <Tabs.Trigger value="memory" class="tab">记忆视图</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="conversation" class="max-h-[60vh] overflow-y-auto pt-3">
          {#each d.messages as m (m.i)}
            <div class="border-base-300 border-b py-2 text-sm">
              <span class="badge badge-sm mr-2">
                {m.kind === "user" ? "用户" : "Mira"}
              </span>
              <span class="text-base-content/50 text-xs">{ago(m.at)}</span>
              <p class="mt-1 whitespace-pre-wrap">{m.text}</p>
            </div>
          {/each}
        </Tabs.Content>
        <Tabs.Content value="memory" class="max-h-[60vh] overflow-y-auto pt-3">
          <pre class="text-xs whitespace-pre-wrap">{d.view}</pre>
        </Tabs.Content>
      </Tabs.Root>
    {/if}
    {#snippet footer()}
      {#if snap().detailError}
        <button class="btn btn-primary" onclick={() => admin.open(snap().detailId)}>重试</button>
      {:else if snap().detail}
        <ConfirmAction label="删除空间" title="删除空间" description="将永久删除这个空间的全部对话和记忆，此操作无法撤销。" class="btn btn-error btn-outline" onConfirm={() => admin.delete(snap().detail!.id)} />
      {/if}
    {/snippet}
</Modal>
