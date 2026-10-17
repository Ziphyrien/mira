<script lang="ts">
  import { getShell } from "#lib/app/shell-context.js";
  const shell = getShell();
</script>

<button
  type="button"
  class="btn btn-ghost btn-sm gap-1.5"
  onclick={shell.openSettings}
  aria-label="设置"
>
  <span class="icon-[lucide--sliders-horizontal] size-4"></span>
  <span class="hidden sm:inline">设置</span>
</button>
