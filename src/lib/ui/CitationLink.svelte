<script lang="ts">
  import type { Snippet } from "svelte";
  import WebsiteIcon from "#lib/ui/WebsiteIcon.svelte";
  import { citationId } from "#lib/shared/citations.js";
  import { getCitations, sourceDomain } from "#lib/ui/citations.js";
  let {
    href = "",
    title,
    children,
  }: { href?: string; title?: string; children?: Snippet } = $props();
  const context = getCitations();
  const citation = $derived(
    context.sources().find((source) => source.id === citationId(href)),
  );
  const external = $derived(/^https?:\/\//i.test(href));
  const safe = $derived(!/^(?:javascript|data|vbscript|cite):/i.test(href));
</script>

{#if citation}
  <button
    type="button"
    class="bg-base-200 text-base-content/75 hover:bg-base-300 focus-visible:outline-primary mx-0.5 inline-flex min-h-6 min-w-6 translate-y-[-1px] items-center justify-center gap-1 rounded-md px-1.5 align-middle text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    aria-label={`查看引用 ${citation.number}：${citation.title}`}
    aria-haspopup="dialog"
    title={`${citation.title} · ${sourceDomain(citation.url)}`}
    onclick={() => context.open(citation)}
  >
    <WebsiteIcon
      url={citation.url}
      favicon={citation.favicon}
      class="size-3"
    />{citation.number}
  </button>
{:else if safe && href}
  <a
    {href}
    {title}
    target={external ? "_blank" : undefined}
    rel={external ? "noopener noreferrer" : undefined}
  >
    {@render children?.()}
  </a>
{:else}
  <span>{@render children?.()}</span>
{/if}
