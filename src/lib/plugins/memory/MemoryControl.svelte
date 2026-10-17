<script lang="ts">
  import { getShell } from "#lib/app/shell-context.js";
  import { getMemory } from "#lib/plugins/memory/context.js";
  const shell = getShell();
  const memory = getMemory();
</script>

<button
  type="button"
  class={["btn btn-ghost btn-sm gap-1.5 ml-auto", shell.folded && "btn-active"]}
  onclick={shell.toggleMemory}
  onpointerenter={() => void memory.prefetch()}
  onfocus={() => void memory.prefetch()}
  aria-label={shell.folded ? "返回聊天视图" : "查看摘要视图"}
  aria-pressed={shell.folded}
>
  <span class="icon-[lucide--network] size-4"></span>
  <span class="hidden sm:inline">{shell.folded ? "聊天" : "摘要"}</span>
</button>
