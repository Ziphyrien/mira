<script lang="ts">
  import { getShell } from "#lib/app/shell-context.js";
  import Modal from "#lib/ui/Modal.svelte";
  const shell = getShell();
</script>

<Modal open={shell.settings} onOpenChange={(open) => { if (!open) shell.closeSettings(); }} title="设置" placement="bottom">
  {#each shell.settingsSections as entry, index (entry.key)}
    {@const Section = entry.component}
    {#if index}<div class="divider"></div>{/if}
    <Section />
  {/each}
  <p class="text-base-content/50 mt-6 text-xs">背景照片：David Marcu，CC0，经 Wikimedia Commons；已调色。</p>
</Modal>
