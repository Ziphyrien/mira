<script lang="ts">
  import { Collapsible } from "bits-ui";
  import type { Snippet } from "svelte";
  import { prefersReducedMotion } from "svelte/motion";
  import { slide } from "svelte/transition";
  let { open = $bindable(false), trigger, children, class: className, triggerClass = "" }: {
    open?: boolean; trigger: Snippet<[boolean]>; children: Snippet; class?: string; triggerClass?: string;
  } = $props();
</script>

<Collapsible.Root bind:open class={className}>
  <Collapsible.Trigger class={["flex w-full items-center text-left", triggerClass]}>
    {@render trigger(open)}
  </Collapsible.Trigger>
  <Collapsible.Content forceMount>
    {#snippet child({ props, open })}
      {#if open}<div {...props} transition:slide={{ duration: prefersReducedMotion.current ? 0 : 200 }}>
        {@render children()}
      </div>{/if}
    {/snippet}
  </Collapsible.Content>
</Collapsible.Root>
