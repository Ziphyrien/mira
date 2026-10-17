<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { Snippet } from "svelte";
  import { prefersReducedMotion } from "svelte/motion";
  import { fade, scale } from "svelte/transition";
  let {
    open, onOpenChange, title, children, footer, titleExtra, hideTitle = false,
    class: className = "max-w-lg", placement = "center", closeButton = "footer", closeLabel = "关闭",
  }: {
    open: boolean; onOpenChange: (open: boolean) => void; title: string; children: Snippet;
    footer?: Snippet; titleExtra?: Snippet; hideTitle?: boolean; class?: string;
    placement?: "center" | "top" | "bottom"; closeButton?: "footer" | "icon" | "none"; closeLabel?: string;
  } = $props();
  const duration = $derived(prefersReducedMotion.current ? 0 : 200);
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}<div {...props} class="fixed inset-0 z-[1000] bg-black/40" transition:fade={{ duration }}></div>{/if}
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content forceMount aria-describedby={undefined}>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props}
            class={["modal-box fixed left-1/2 z-[1001] max-h-[calc(100dvh-5rem)] -translate-x-1/2 scale-100 opacity-100 outline-none transition-none",
              placement === "center" ? "top-1/2 -translate-y-1/2" : placement === "bottom" ? "bottom-0 w-full rounded-b-none sm:bottom-auto sm:top-1/2 sm:w-11/12 sm:-translate-y-1/2 sm:rounded-box" : "top-0 w-full rounded-t-none sm:top-1/2 sm:w-11/12 sm:-translate-y-1/2 sm:rounded-box",
              className]}
            transition:scale={{ duration, start: 0.96 }}>
            <Dialog.Title class={hideTitle ? "sr-only" : "mb-4 text-lg font-semibold"}>
              {title}{@render titleExtra?.()}
            </Dialog.Title>
            {#if closeButton === "icon"}
              <Dialog.Close class="btn btn-ghost btn-sm btn-circle absolute top-3 right-3" aria-label={closeLabel}>
                <span class="icon-[lucide--x] size-4" aria-hidden="true"></span>
              </Dialog.Close>
            {/if}
            {@render children()}
            {#if footer || closeButton === "footer"}<div class="modal-action">
              {@render footer?.()}
              {#if closeButton === "footer"}<Dialog.Close class="btn">{closeLabel}</Dialog.Close>{/if}
            </div>{/if}
          </div>
        {/if}
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
