<script lang="ts">
  import { MarkdownDocument as MarkdownDocumentView } from "@comark/svelte";
  import type { MarkdownDocument, ComponentManifest } from "comark";
  import { createReplyParser } from "./markdown/parser.js";
  import Code from "./markdown/Code.svelte";
  import Resolver from "./markdown/Resolver.svelte";
  import {
    citationsFor,
    sourceDomain,
    setCitations,
    type Citation,
  } from "#lib/ui/citations.js";
  import type { SearchActivity } from "#lib/contracts/index.js";
  import CitationLink from "#lib/ui/CitationLink.svelte";
  import WebsiteIcon from "#lib/ui/WebsiteIcon.svelte";
  import Modal from "#lib/ui/Modal.svelte";

  let {
    text,
    searches = [],
    streaming = false,
    pending,
  }: {
    text: string;
    searches?: SearchActivity[];
    streaming?: boolean;
    pending?: string;
  } = $props();
  let document = $state.raw<MarkdownDocument>();
  let error = $state("");
  const parse = createReplyParser();
  const components = { ProseA: CitationLink, ProsePre: Code };
  const componentsManifest: ComponentManifest = (tag) => {
    if (tag === "math") return import("./markdown/Math.svelte");
    if (tag === "mermaid") return import("./markdown/Mermaid.svelte");
    return undefined;
  };
  const citations = $derived(citationsFor(document?.nodes ?? [], searches));
  let selected = $state.raw<Citation | null>(null);
  let previewOpen = $state(false);
  setCitations({
    sources: () => citations,
    open: (source) => {
      selected = source;
      previewOpen = true;
    },
  });

  $effect(() => {
    const source = text;
    const active = streaming;
    let current = true;
    const render = () => {
      void parse(source, { streaming: active }).then((parsed) => {
        if (current) { document = parsed; error = ""; }
      }).catch(() => {
        if (current) { document = undefined; error = "无法显示回复。"; }
      });
    };
    // Coalesce network updates within a frame; the final response is parsed immediately.
    const frame = active ? requestAnimationFrame(render) : undefined;
    if (!active) render();
    return () => {
      current = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });
</script>

{#if error}<p class="text-error text-sm" role="alert">{error}</p>
{:else if pending || document?.nodes.length}
  <div class="prose-mira">
    {#if document?.nodes.length}
      <MarkdownDocumentView value={document} {streaming} {components} {componentsManifest} resolver={Resolver} caret={streaming} />
    {:else if pending}
      <div class="text-base-content/60 flex h-[1lh] items-center gap-2" role="status" aria-label="回复状态">
        <span class="loading loading-dots size-5 shrink-0" aria-hidden="true"></span>
        <span class="text-sm">{pending}</span>
      </div>
    {/if}
  </div>
{/if}
{#if citations.length}
  <div class="mt-3 flex flex-wrap items-center gap-1.5" aria-label="引用来源">
    <span class="text-base-content/45 mr-1 text-[11px]">引用来源</span>
    {#each citations as source (source.id)}<button
        type="button"
        class="border-base-300 text-base-content/65 hover:bg-base-200 focus-visible:outline-primary inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors"
        title={source.title}
        aria-label={`查看来源 ${source.number}：${source.title}`}
        aria-haspopup="dialog"
        onclick={() => {
          selected = source;
          previewOpen = true;
        }}
      >
        <span class="text-base-content/40 text-[10px]">{source.number}</span>
        <WebsiteIcon url={source.url} favicon={source.favicon} class="size-3" />
        <span class="truncate">{sourceDomain(source.url)}</span>
      </button>{/each}
  </div>
{/if}
{#if citations.length}
  <Modal open={previewOpen} onOpenChange={(open) => (previewOpen = open)} title="引用来源详情" hideTitle placement="bottom" closeButton="icon" closeLabel="关闭来源详情">
      {#if selected}
        <p
          class="text-base-content/50 mb-2 flex items-center gap-1.5 pr-8 text-xs"
        >
          <WebsiteIcon
            url={selected.url}
            favicon={selected.favicon}
          />{sourceDomain(selected.url)}
        </p>
        <h3 class="pr-6 text-base font-semibold leading-snug">
          {selected.title}
        </h3>
        <blockquote
          class="border-base-300 text-base-content/70 my-4 border-l-2 pl-3 text-sm leading-relaxed wrap-anywhere"
        >
          {selected.excerpt}
        </blockquote>
        <a
          href={selected.url}
          target="_blank"
          rel="noopener noreferrer"
          class="text-base-content/45 mb-4 block truncate text-xs"
          title={selected.url}
        >
          {selected.url}
        </a>
        <a
          href={selected.url}
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-primary btn-sm"
        >
          打开原网页
          <span
            class="icon-[lucide--external-link] size-3.5"
            aria-hidden="true"
          ></span>
        </a>
      {/if}
  </Modal>
{/if}

<style>
  .prose-mira {
    --gap: 0.75em;
    line-height: 1.75;
    min-height: 1lh;
    display: flow-root;
    :global {
      p,
      ul,
      ol,
      pre,
      table,
      blockquote {
        margin-block: var(--gap);
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
        margin-block: 1.1em calc(var(--gap) * 0.6);
      }
      h1 {
        font-size: 1.25em;
      }
      h2 {
        font-size: 1.125em;
      }
      code {
        font-size: 0.875em;
        background: var(--color-base-200);
        border-radius: 0.375rem;
        padding: 0.1em 0.35em;
      }
      pre {
        background: var(--color-base-200);
        border-radius: 0.75rem;
        padding: 0.875em 1em;
        overflow-x: auto;
        code {
          background: none;
          padding: 0;
        }
      }
      a {
        color: var(--color-primary);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      blockquote {
        border-inline-start: 3px solid var(--color-base-300);
        padding-inline-start: 0.875em;
        color: color-mix(in oklab, currentColor 75%, transparent);
      }
      table {
        border-collapse: collapse;
        font-size: 0.9em;
        td,
        th {
          border: 1px solid var(--color-base-300);
          padding: 0.35em 0.6em;
        }
      }
      > .comark-content > :first-child {
        margin-top: 0;
      }
      > .comark-content > :last-child {
        margin-bottom: 0;
      }
    }
  }
</style>
