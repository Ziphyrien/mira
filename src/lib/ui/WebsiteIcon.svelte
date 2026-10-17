<script lang="ts">
  let {
    url,
    favicon,
    class: className = "size-3.5",
  }: { url: string; favicon?: string; class?: string } = $props();
  let failed = $state("");
  const src = $derived(
    favicon && URL.canParse(favicon) && /^https?:\/\//i.test(favicon)
      ? favicon
      : `https://favicon.im/${new URL(url).hostname}?larger=true`,
  );
</script>

{#if failed === src}
  <span
    class={["icon-[lucide--globe] shrink-0", className]}
    aria-hidden="true"
  ></span>
{:else}
  <img
    {src}
    class={["shrink-0 object-contain", className]}
    alt=""
    decoding="async"
    referrerpolicy="no-referrer"
    onerror={() => {
      failed = src;
    }}
  />
{/if}
