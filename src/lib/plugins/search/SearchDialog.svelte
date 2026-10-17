<script lang="ts">
  import { getSearch } from "#lib/plugins/search/context.js";
  import { ago } from "#lib/app/time.js";
  import Modal from "#lib/ui/Modal.svelte";
  const search = getSearch();
</script>

<Modal open={search.opened} onOpenChange={(open) => { if (!open) search.close(); }} title="搜索对话" hideTitle placement="top" class="max-w-xl" closeButton="none">
    <label class="input w-full">
      <span class="icon-[lucide--search] opacity-60"></span>
      <input
        type="search"
        placeholder="搜索聊过的内容"
        bind:value={() => search.query, (value) => search.setQuery(value)}
        aria-label="搜索内容"
      />
    </label>
    {#if search.error}<p class="text-error mt-3 text-sm" role="alert">
        {search.error}
        <button type="button" class="link ml-2" onclick={() => search.retry()}>重新搜索</button>
      </p>{/if}
    {#if search.loading}<p class="text-base-content/60 mt-3 text-sm" role="status">
        已搜索 {search.indexed} 条消息，正在读取更早记录…
      </p>{/if}
    <ul class="mt-3 max-h-[60vh] overflow-y-auto">
      {#each search.results as row (row.i)}
        <li>
          <button
            class="hover:bg-base-200 w-full rounded-lg p-3 text-left"
            onclick={() => search.pick(row)}
          >
            <span class="text-base-content/50 text-xs">
              {row.kind === "user" ? "你" : "Mira"} · {ago(row.at)}
            </span>
            <p class="line-clamp-2 text-sm">{row.text}</p>
          </button>
        </li>
      {:else}
        {#if search.query.trim()}<li class="text-base-content/60 p-3 text-sm">
            {search.loading ? "加载中…" : "没有找到"}
          </li>{/if}
      {/each}
    </ul>
</Modal>
