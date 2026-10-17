<script lang="ts">
  import { MarkdownDocument as MarkdownDocumentView } from "@comark/svelte";
  import type { MarkdownDocument } from "comark";
  import { onDestroy } from "svelte";

  let { source = "", language = "text" }: { source?: string; language?: string } = $props();
  let highlighted = $state.raw<{ source: string; language: string; document: MarkdownDocument }>();
  const document = $derived(highlighted?.source === source && highlighted.language === language
    ? highlighted.document : undefined);
  let copied = $state(false);
  let copyError = $state("");
  let copyTimer: ReturnType<typeof setTimeout>;
  onDestroy(() => clearTimeout(copyTimer));

  $effect(() => {
    const code = source;
    const lang = language;
    let current = true;
    const timer = setTimeout(() => {
      void import("./highlight.js").then(({ highlight }) => highlight(code, lang)).then((document) => {
        if (current) highlighted = { source: code, language: lang, document };
      }).catch(() => {
        // The original code remains readable when a grammar or chunk cannot load.
      });
    }, 100);
    return () => { current = false; clearTimeout(timer); };
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      copied = true;
      copyError = "";
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copied = false; }, 1600);
    } catch {
      copyError = "暂时无法复制，请允许剪贴板访问。";
    }
  }
</script>

<div class="code-block">
  <div class="text-base-content/55 flex items-center justify-between gap-3 text-xs">
    <span>{language}</span>
    <button type="button" class="btn btn-ghost btn-xs" onclick={copy} aria-label={copied ? "代码已复制" : "复制代码"}>
      {copied ? "已复制" : "复制代码"}
    </button>
  </div>
  {#if document}<MarkdownDocumentView value={document} />
  {:else}<pre><code>{source}</code></pre>{/if}
  {#if copyError}<p class="text-error text-xs" role="alert">{copyError}</p>{/if}
</div>

<style>
  .code-block { margin-block: 0.75em; }
  @media (prefers-color-scheme: dark) {
    .code-block :global(.shiki span) {
      color: var(--shiki-dark) !important;
      font-style: var(--shiki-dark-font-style) !important;
      font-weight: var(--shiki-dark-font-weight) !important;
      text-decoration: var(--shiki-dark-text-decoration) !important;
    }
  }
</style>
