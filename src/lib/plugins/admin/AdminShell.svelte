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

<main class="mx-auto max-w-5xl p-5 sm:p-8">
  <header class="mb-8 flex items-center justify-between gap-4">
    <a href="/admin" class="text-lg font-semibold">
      Mira <span class="text-base-content/40 font-normal">/ 管理</span>
    </a>
    <div class="flex items-center gap-2">
      <a class="btn btn-ghost btn-sm" href="/research">
        研究工作台
        <span class="icon-[lucide--arrow-up-right] size-4" aria-hidden="true"></span>
      </a>
      {#if snap().admin}
        <button type="button" class="btn btn-ghost btn-sm" onclick={handleLogout}>
          <span class="icon-[lucide--log-out] size-4" aria-hidden="true"></span>
          退出
        </button>
      {/if}
    </div>
  </header>

  {#if snap().error}
    <div
      class="border-error/30 bg-error/5 mb-6 flex items-center justify-between gap-3 rounded-box border px-4 py-3"
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
    {#if !snap().error}
      <div class="flex justify-center py-24">
        <span class="loading loading-spinner" aria-label="加载管理后台"></span>
      </div>
    {/if}
  {:else if !snap().admin}
    <div class="mx-auto max-w-sm py-16 sm:py-24">
      <div class="mb-6 text-center">
        <span
          class="icon-[lucide--shield-check] text-base-content/35 mx-auto mb-3 block size-9"
          aria-hidden="true"
        ></span>
        <h1 class="text-xl font-semibold">管理员登录</h1>
        <p class="text-base-content/60 mt-1 text-sm">输入管理令牌以访问空间与模型设置</p>
      </div>
      <form
        class="border-base-300 space-y-4 rounded-box border p-5 sm:p-6"
        onsubmit={handleLogin}
      >
        <div class="space-y-1.5">
          <label class="label text-sm font-medium" for="token">管理令牌</label>
          <input
            id="token"
            class="input w-full"
            type="password"
            autocomplete="current-password"
            bind:value={token}
            required
          />
        </div>
        {#if snap().loginError}
          <p class="text-error text-sm" role="alert">{snap().loginError}</p>
        {/if}
        <button class="btn btn-primary w-full" disabled={snap().loading}>
          {snap().loading ? "登录中..." : "登录"}
        </button>
      </form>
    </div>
  {:else if snap().list}
    {@const list = snap().list!}
    <div class="space-y-8">
      <section aria-label="系统概览">
        <div
          class="divide-base-300 border-base-300 grid grid-cols-3 divide-x rounded-box border"
        >
          <div class="px-4 py-3.5 sm:px-6 sm:py-4">
            <div class="text-base-content/55 text-xs">空间</div>
            <div class="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
              {list.total}
            </div>
          </div>
          <div class="px-4 py-3.5 sm:px-6 sm:py-4">
            <div class="text-base-content/55 text-xs">消息</div>
            <div class="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
              {list.messages}
            </div>
          </div>
          <div class="px-4 py-3.5 sm:px-6 sm:py-4">
            <div class="text-base-content/55 text-xs">模型花费</div>
            <div class="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
              ${list.cost.toFixed(2)}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="spaces-heading" class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-baseline gap-2.5">
            <h1 id="spaces-heading" class="text-lg font-semibold">空间</h1>
            <span class="text-base-content/50 text-xs tabular-nums">
              {list.items.length} 项
            </span>
          </div>
          <form class="flex gap-2 sm:w-80" onsubmit={handleSearch}>
            <input
              class="input input-sm flex-1"
              placeholder="按称呼或 ID 搜索"
              bind:value={q}
              aria-label="搜索空间"
            />
            <button class="btn btn-sm" disabled={snap().loading}>
              <span class="icon-[lucide--search] size-4" aria-hidden="true"></span>
              搜索
            </button>
          </form>
        </div>

        {#if list.items.length}
          <div class="divide-base-300 border-base-300 divide-y rounded-box border">
            {#each list.items as s (s.id)}
              <button
                type="button"
                class="hover:bg-base-200 flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors sm:px-5"
                aria-label={`查看空间 ${s.name || s.id}`}
                onclick={() => admin.open(s.id)}
              >
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2.5">
                    <span class="truncate font-medium">
                      {s.name || "未命名空间"}
                    </span>
                    <span class="text-base-content/45 shrink-0 font-mono text-xs">
                      {s.id.slice(0, 12)}
                    </span>
                  </span>
                  <span class="text-base-content/50 mt-0.5 block text-xs sm:hidden">
                    {s.messages} 条消息 · {ago(s.seen)} · ${s.cost.toFixed(4)}
                  </span>
                </span>
                <span
                  class="text-base-content/65 hidden shrink-0 items-center gap-6 text-xs tabular-nums sm:flex"
                >
                  <span class="w-20 text-right">{s.messages} 条消息</span>
                  <span class="text-base-content/50 w-24 text-right">{ago(s.seen)}</span>
                  <span class="w-20 text-right font-mono">${s.cost.toFixed(4)}</span>
                </span>
                <span
                  class="icon-[lucide--chevron-right] text-base-content/35 size-4 shrink-0"
                  aria-hidden="true"
                ></span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="border-base-300 rounded-box border border-dashed py-16 text-center">
            <span
              class="icon-[lucide--inbox] text-base-content/25 mx-auto mb-3 block size-9"
              aria-hidden="true"
            ></span>
            <p class="text-base-content/50 text-sm">
              {snap().query ? "没有匹配的空间" : "还没有空间"}
            </p>
          </div>
        {/if}
      </section>

      {#each sections as section (section.key)}
        <section.component />
      {/each}
    </div>
  {/if}
</main>

<Modal
  open={!!snap().admin && snap().detailId !== null}
  onOpenChange={(open) => {
    if (!open) void admin.open(null);
  }}
  title={snap().detail ? (snap().detail!.profile?.name ?? "未完成引导") : "空间详情"}
  class="max-w-4xl"
>
  {#snippet titleExtra()}
    <span class="text-base-content/50 ml-2 font-mono text-xs">
      {snap().detail?.id ?? ""}
    </span>
  {/snippet}
  {#if detailLoading}
    <p class="flex items-center gap-2 py-6" role="status">
      <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
      正在加载空间详情…
    </p>
  {:else if snap().detailError}
    <p class="text-error py-6" role="alert">{snap().detailError}</p>
  {:else if snap().detail}
    {@const d = snap().detail!}
    <div class="text-base-content/65 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
      <span>{d.stats.messages} 条消息</span>
      <span>{d.stats.summaries} 条摘要</span>
      <span>视图 {d.stats.viewLines} 行</span>
      <span>待整理 {d.stats.pending}</span>
      <span class="font-mono">${d.cost.toFixed(4)}</span>
    </div>
    <Tabs.Root value="conversation" class="mt-4">
      <Tabs.List class="tabs tabs-border" aria-label="空间详情">
        <Tabs.Trigger value="conversation" class="tab">对话</Tabs.Trigger>
        <Tabs.Trigger value="memory" class="tab">记忆视图</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="conversation" class="max-h-[60vh] overflow-y-auto pt-3">
        {#if d.messages.length}
          <div class="divide-base-300 divide-y">
            {#each d.messages as m (m.i)}
              <div class="py-3 text-sm first:pt-1 last:pb-1">
                <div class="flex items-center gap-2">
                  <span
                    class={[
                      "badge badge-xs",
                      m.kind === "user" ? "badge-neutral" : "badge-primary badge-soft",
                    ]}
                  >
                    {m.kind === "user" ? "用户" : "Mira"}
                  </span>
                  <span class="text-base-content/45 text-xs">{ago(m.at)}</span>
                </div>
                <p class="mt-1.5 leading-relaxed whitespace-pre-wrap">{m.text}</p>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-base-content/50 py-10 text-center text-sm">暂无对话记录</p>
        {/if}
      </Tabs.Content>
      <Tabs.Content value="memory" class="max-h-[60vh] overflow-y-auto pt-3">
        {#if d.view.trim()}
          <pre
            class="border-base-300 bg-base-200/50 rounded-box border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap"
          >{d.view}</pre>
        {:else}
          <p class="text-base-content/50 py-10 text-center text-sm">暂无记忆视图</p>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  {/if}
  {#snippet footer()}
    {#if snap().detailError}
      <button class="btn btn-primary" onclick={() => admin.open(snap().detailId)}>
        重试
      </button>
    {:else if snap().detail}
      <ConfirmAction
        label="删除空间"
        title="删除空间"
        description="将永久删除这个空间的全部对话和记忆，此操作无法撤销。"
        class="btn btn-error btn-outline"
        onConfirm={() => admin.delete(snap().detail!.id)}
      />
    {/if}
  {/snippet}
</Modal>
