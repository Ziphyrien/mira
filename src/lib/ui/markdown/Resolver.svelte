<script lang="ts">
  import type { Component, Snippet } from "svelte";
  let { promise, props = {}, children }: {
    promise: Promise<Component<Record<string, unknown>>>;
    props?: Record<string, unknown>;
    children?: Snippet;
  } = $props();
</script>

{#await promise}
  <span class="whitespace-pre-wrap">{typeof props.content === "string" ? props.content : ""}</span>
{:then Content}
  <Content {...props}>{@render children?.()}</Content>
{:catch}
  <code class="whitespace-pre-wrap">{typeof props.content === "string" ? props.content : ""}</code>
{/await}
