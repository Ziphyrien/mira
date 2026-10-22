<script lang="ts">
  import {onMount,type Snippet} from 'svelte';
  let {children}:{children:Snippet}=$props();
  let ready=$state(false);
  onMount(()=>{ready=true;});
</script>
<div inert={!ready} aria-busy={!ready}>{@render children()}</div>
{#if !ready}
  <div class="fixed inset-0 z-[1100] grid place-items-center bg-base-100/65 backdrop-blur-[1px]" role="status" aria-label="正在加载">
    <span class="loading loading-spinner text-primary size-7" aria-hidden="true"></span>
    <noscript><p class="px-6 text-sm">此页面需要启用 JavaScript 才能作答。</p></noscript>
  </div>
{/if}
