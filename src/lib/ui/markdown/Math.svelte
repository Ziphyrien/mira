<script lang="ts">
  import katex from "katex";
  import "katex/dist/katex.min.css";

  let { content, class: className = "" }: { content: string; class?: string } = $props();
  const inline = $derived(className.split(" ").includes("inline"));
  const rendered = $derived.by(() => {
    try {
      return katex.renderToString(content, { displayMode: !inline, throwOnError: true, trust: false });
    } catch {
      return null;
    }
  });
</script>

<span class={inline ? "math-inline" : "math-block"}>
  {#if rendered}{@html rendered}{:else}<code>{content}</code>{/if}
</span>

<style>
  .math-block { display: block; overflow-x: auto; margin-block: 0.75em; }
</style>
