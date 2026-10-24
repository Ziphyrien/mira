<script lang="ts">
  import { onMount } from "svelte";
  import MemoryTransfer from "./MemoryTransfer.svelte";
  import ReplyContent from "#lib/ui/ReplyContent.svelte";
  import { getMemory } from "#lib/plugins/memory/context.js";
  import type { MemoryTreeNode } from "#lib/contracts/index.js";

  const memory = getMemory();
  const kinds: Record<string, string> = {
    user: "用户",
    mira: "Mira",
    tool: "工具调用",
    echo: "工具结果",
    work: "后台任务",
    note: "资料",
  };
  const key = (node: MemoryTreeNode) => `${node.id}+${node.n}`;
  const hasExpanded = $derived(
    memory.root?.nodes.some((node) => memory.opened[key(node)]) ?? false,
  );
  function toggleLabel(node: MemoryTreeNode) {
    const id = key(node);
    if (!memory.opened[id]) return `展开摘要 ${id}`;
    if (node.n === 1) return `收起记录 ${id}`;
    return `收起摘要 ${id}`;
  }
  function prefetch(node: MemoryTreeNode) {
    return (element: HTMLButtonElement) => {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            memory.prefetchNode(node);
            observer.disconnect();
          }
        },
        { root: element.closest("main"), rootMargin: "320px" },
      );
      observer.observe(element);
      return () => observer.disconnect();
    };
  }
  onMount(() => {
    void memory.prefetch();
  });
</script>

{#snippet tree(nodes: MemoryTreeNode[])}
  {#each nodes as node (key(node))}
    {@const id = key(node)}
    <div>
      <button
        id={`memory-toggle-${id}`}
        {@attach prefetch(node)}
        type="button"
        class={[
          "memory-control w-full text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
          memory.opened[id]
            ? "text-base-content/60 hover:text-base-content flex items-center gap-1.5 rounded-md py-2 pr-2 text-xs"
            : "border-base-300 hover:bg-base-200/50 rounded-xl border px-3 py-3",
        ]}
        disabled={memory.loading}
        onclick={() => memory.toggle(node)}
        onpointerenter={() => void memory.load(node)}
        onfocus={() => void memory.load(node)}
        aria-expanded={Boolean(memory.opened[id])}
        aria-controls={memory.opened[id] ? `memory-${id}` : undefined}
        aria-label={toggleLabel(node)}
      >
        {#if memory.opened[id]}
          <span
            class="icon-[lucide--chevron-down] size-3.5 shrink-0"
            aria-hidden="true"
          ></span>
          <span class="text-base-content/75 font-medium">
            {node.n === 1 ? "原文" : `${node.n} 条记忆`}
          </span>
          <span class="text-base-content/45 ml-auto">收起</span>
        {:else}
          <span
            class="text-base-content/45 mb-1.5 flex items-center gap-1.5 text-xs"
          >
            <span
              class="icon-[lucide--chevron-right] size-3.5"
              aria-hidden="true"
            ></span>
            {node.n === 1 ? "一条记忆" : `${node.n} 条记忆的摘要`}
          </span>
          <span
            class="text-base-content/80 block text-sm leading-relaxed wrap-anywhere"
          >
            {node.ready ? node.text : "摘要正在生成，点击查看内容。"}
          </span>
        {/if}
      </button>
      {#if memory.opened[id]}
        <div
          id={`memory-${id}`}
          class={[
            "space-y-2",
            node.n > 1 ? "memory-children" : "memory-original",
          ]}
          role="group"
          aria-labelledby={`memory-toggle-${id}`}
        >
          {#if memory.pending[id]}<p
              class="text-base-content/55 flex items-center gap-2 px-3 py-3 text-sm"
              role="status"
            >
              <span
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              ></span>
              正在展开
            </p>
          {:else if memory.failures[id]}<div class="px-3 py-3">
              <p class="text-error text-sm" role="alert">{memory.failures[id]}</p>
              <button
                type="button"
                class="btn btn-ghost btn-xs mt-2"
                onclick={() => memory.load(node)}
              >
                重试
              </button>
            </div>
          {:else if memory.cache[id]?.original}
            {@const original = memory.cache[id].original!}
            <article class="py-3">
              {#if original.image}
                <a href={`/api/images/${original.image.id}`} target="_blank" rel="noreferrer">
                  <img src={`/api/images/${original.image.id}`} alt="原消息附图"
                    width={original.image.width} height={original.image.height}
                    loading="lazy" class="mb-3 max-h-80 rounded-lg object-contain" />
                </a>
              {/if}
              <p class="text-base-content/45 mb-2 text-xs">
                {kinds[original.kind] ?? original.kind} · {new Date(
                  original.at,
                ).toLocaleString()}
              </p>
              {#if original.kind === "mira"}<div class="memory-prose text-sm">
                  <ReplyContent
                    text={original.text}
                    searches={original.searches}
                  />
                </div>{:else}<div
                  class="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere"
                >
                  {original.text}
                </div>{/if}
            </article>
          {:else if memory.cache[id]}{@render tree(memory.cache[id].nodes)}{/if}
        </div>
      {/if}
    </div>
  {/each}
{/snippet}
<section class="mx-auto max-w-3xl px-4 py-6" aria-label="记忆摘要树">
  <header class="mb-5 flex items-start justify-between gap-3">
    <div>
      <h2 class="font-semibold">摘要视图</h2>
      <p class="text-base-content/55 mt-1 text-xs">
        展开查看内容，收起恢复摘要。
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <MemoryTransfer />
      {#if hasExpanded}<button
          type="button"
          class="btn btn-ghost btn-sm text-xs"
          onclick={() => memory.collapse()}
        >
          全部折叠
        </button>{/if}
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square"
        aria-label="刷新摘要视图"
        onclick={() => memory.refresh()}
        disabled={memory.loading}
      >
        <span
          class="icon-[lucide--refresh-cw] size-4"
          aria-hidden="true"
        ></span>
      </button>
    </div>
  </header>
  {#if memory.loading && !memory.root}<p
      class="text-base-content/55 flex items-center gap-2 text-sm"
      role="status"
    >
      <span
        class="loading loading-spinner loading-sm"
        aria-hidden="true"
      ></span>
      正在读取摘要
    </p>
  {:else}
    {#if memory.error}<div class="mb-4">
      <p class="text-error text-sm" role="alert">{memory.error}</p>
      <button type="button" class="btn btn-ghost btn-sm mt-2" onclick={() => memory.refresh()}>
        重试
      </button>
    </div>{/if}
    {#if memory.root?.nodes.length}<div class="space-y-3" aria-busy={memory.loading}>
      {@render tree(memory.root.nodes)}
    </div>
    {:else if !memory.error}<p class="text-base-content/55 text-sm">还没有可浏览的记忆。</p>{/if}
  {/if}
</section>

<style>
  .memory-children {
    margin-inline-start: 6px;
    border-inline-start: 1px solid var(--color-base-300);
    padding-inline-start: 8px;
    padding-block: 0.25rem;
  }
  .memory-control:hover + .memory-children {
    border-inline-start-color: var(--tint-content-30);
  }
  .memory-original {
    margin-top: 0.25rem;
  }
  .memory-prose :global {
    p,
    ul,
    ol,
    pre,
    blockquote {
      margin-block: 0.65em;
    }
    ul {
      list-style: disc;
      padding-inline-start: 1.25em;
    }
    ol {
      list-style: decimal;
      padding-inline-start: 1.25em;
    }
    h1,
    h2,
    h3 {
      font-weight: 600;
      margin-block: 0.75em;
    }
    code {
      background: var(--color-base-200);
      padding: 0.1em 0.3em;
      border-radius: 0.3rem;
    }
    pre {
      overflow-x: auto;
      padding: 0.75em;
      background: var(--color-base-200);
      border-radius: 0.5rem;
    }
    a {
      color: var(--color-primary);
      text-decoration: underline;
    }
    > :first-child {
      margin-top: 0;
    }
    > :last-child {
      margin-bottom: 0;
    }
  }
</style>
