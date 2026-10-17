<script lang="ts">
  import { renderMermaidSVG } from "beautiful-mermaid";

  let { content }: { content: string } = $props();
  const svg = $derived.by(() => {
    try {
      return renderMermaidSVG(content, {
        bg: "var(--color-base-100)",
        fg: "var(--color-base-content)",
        accent: "var(--color-primary)",
        transparent: true,
      });
    } catch {
      return null;
    }
  });
</script>

{#if svg}
  <figure class="diagram" aria-label="Mermaid 图表">{@html svg}</figure>
{:else}
  <pre aria-label="图表源码"><code>{content}</code></pre>
{/if}

<style>
  .diagram { overflow-x: auto; margin-block: 0.75em; }
  .diagram :global(svg) { display: block; max-width: 100%; height: auto; margin-inline: auto; }
</style>
