<script lang="ts">
  import { AlertDialog } from "bits-ui";
  import { prefersReducedMotion } from "svelte/motion";
  import { fade, scale } from "svelte/transition";
  let { label, title, description, onConfirm, class: className = "btn btn-error btn-outline btn-sm" }: {
    label: string; title: string; description: string; onConfirm: () => void | Promise<void>; class?: string;
  } = $props();
  let cancelButton = $state<HTMLButtonElement | null>(null);
  const duration = $derived(prefersReducedMotion.current ? 0 : 200);
</script>

<AlertDialog.Root>
  <AlertDialog.Trigger class={className}>{label}</AlertDialog.Trigger>
  <AlertDialog.Portal>
    <AlertDialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}<div {...props} class="fixed inset-0 z-[1200] bg-black/40" transition:fade={{ duration }}></div>{/if}
      {/snippet}
    </AlertDialog.Overlay>
    <AlertDialog.Content forceMount onOpenAutoFocus={(event) => { event.preventDefault(); cancelButton?.focus(); }}>
      {#snippet child({ props, open })}
        {#if open}<div {...props} class="modal-box fixed top-1/2 left-1/2 z-[1201] -translate-x-1/2 -translate-y-1/2 scale-100 opacity-100 outline-none transition-none" transition:scale={{ duration, start: 0.96 }}>
          <AlertDialog.Title class="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description class="text-base-content/70 mt-3 text-sm">{description}</AlertDialog.Description>
          <div class="modal-action">
            <AlertDialog.Cancel class="btn" bind:ref={cancelButton}>取消</AlertDialog.Cancel>
            <AlertDialog.Action class="btn btn-error" onclick={onConfirm}>确认删除</AlertDialog.Action>
          </div>
        </div>{/if}
      {/snippet}
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
