<script lang="ts">
  import type { SearchActivity } from "#lib/contracts/index.js";
  import { sourceDomain } from "#lib/ui/citations.js";
  import WebsiteIcon from "#lib/ui/WebsiteIcon.svelte";
  import Disclosure from "#lib/ui/Disclosure.svelte";
  let { search }: { search: SearchActivity } = $props();
  const label = $derived.by(() => {
    if (search.status === "running") return "正在搜索网页";
    if (search.status === "error") return "搜索未完成";
    if (search.sources.length) return `找到 ${search.sources.length} 个来源`;
    return "未找到相关结果";
  });
</script>

<Disclosure class="bg-base-200/40 border-base-300 mb-3 rounded-xl border" triggerClass="text-base-content/65 hover:text-base-content gap-2 px-3 py-3 text-sm transition-colors select-none">
  {#snippet trigger(open)}
    {#if search.status === "running"}<span
        class="loading loading-spinner size-3.5 shrink-0"
        aria-hidden="true"
      ></span>{:else}<span
        class={search.status === "error"
          ? "icon-[lucide--circle-alert] size-3.5 shrink-0"
          : "icon-[lucide--search] size-3.5 shrink-0"}
        aria-hidden="true"
      ></span>{/if}
    <span class="shrink-0" role="status" aria-live="polite">{label}</span>
    <span
      class={["text-base-content/45 min-w-0 flex-1 truncate text-xs", open && "invisible"]}
      title={search.query}
    >
      {search.query}
    </span>
    <span
      class={["icon-[lucide--chevron-right] size-3.5 shrink-0 transition-transform", open && "rotate-90"]}
      aria-hidden="true"
    ></span>
  {/snippet}
  <div class="px-3 pb-3">
    <p class="text-base-content/55 mb-1 text-xs leading-relaxed wrap-anywhere">
      {search.query}
    </p>
    {#if search.error}<p
        class="text-base-content/65 py-2 text-xs"
        role="status"
      >
        {search.error}
      </p>{/if}
    <ul class="divide-base-300/60 divide-y" aria-label="搜索来源">
      {#each search.sources as source (source.url)}
        <li>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            class="group/source block py-2.5"
            title={source.url}
          >
            <div
              class="text-base-content/45 mb-1 flex items-center gap-1.5 text-[11px]"
            >
              <WebsiteIcon url={source.url} favicon={source.favicon} />
              <span class="min-w-0 flex-1 truncate">
                {sourceDomain(source.url)}
              </span>
              <span
                class="icon-[lucide--arrow-up-right] size-3"
                aria-hidden="true"
              ></span>
            </div>
            <p
              class="text-base-content/85 group-hover/source:underline line-clamp-2 text-sm font-medium leading-snug"
            >
              {source.title}
            </p>
            <p
              class="text-base-content/55 mt-1 line-clamp-2 text-xs leading-relaxed"
            >
              {source.excerpt}
            </p>
          </a>
        </li>
      {/each}
    </ul>
    {#if search.status === "running"}<p
        class="text-base-content/45 py-2 text-xs"
      >
        正在检索相关网页…
      </p>{/if}
  </div>
</Disclosure>
