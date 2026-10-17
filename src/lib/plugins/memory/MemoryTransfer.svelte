<script lang="ts">
  import { AlertDialog } from "bits-ui";
  import { http } from "#lib/app/http.js";
  import { MemoryBackup, MAX_MEMORY_BACKUP_BYTES } from "#lib/contracts/memory-backup.js";
  let picker: HTMLInputElement;
  let selected = $state<{ name: string; text: string; messages: number; summaries: number; images: number } | null>(null);
  let open = $state(false);
  let busy = $state(false);
  let problem = $state("");
  async function select(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    problem = "";
    try {
      if (file.size > MAX_MEMORY_BACKUP_BYTES) throw new Error("请选择不超过 32 MB 的记忆备份。");
      const text = await file.text();
      const parsed = MemoryBackup.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error("请选择 Mira 导出的有效记忆备份。");
      selected = { name: file.name, text, messages: parsed.data.messages.length, summaries: parsed.data.summaries.length, images: Object.keys(parsed.data.images).length };
      open = true;
    } catch (error) {
      if (error instanceof SyntaxError) problem = "文件不是有效的 JSON 备份。";
      else problem = error instanceof Error ? error.message : "无法读取备份。";
    }
  }
  async function restore(event: MouseEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    busy = true; problem = "";
    try {
      await http("/api/memory/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: selected.text });
      window.location.reload();
    } catch (error) { problem = error instanceof Error ? error.message : "导入未完成，请重试。"; busy = false; }
  }
</script>

<a class="btn btn-ghost btn-sm text-xs" href="/api/memory/export" download>导出记忆</a>
<button type="button" class="btn btn-ghost btn-sm text-xs" onclick={() => picker.click()} disabled={busy}>导入记忆</button>
<input bind:this={picker} type="file" accept=".json,application/json" class="hidden" aria-label="选择记忆备份" onchange={select} />
{#if problem && !open}<p class="text-error text-xs" role="alert">{problem}</p>{/if}
<AlertDialog.Root bind:open>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-[1200] bg-black/40" />
    <AlertDialog.Content class="modal-box fixed top-1/2 left-1/2 z-[1201] -translate-x-1/2 -translate-y-1/2 outline-none">
      <AlertDialog.Title class="text-lg font-semibold">导入记忆</AlertDialog.Title>
      <AlertDialog.Description class="text-base-content/70 mt-3 text-sm">
        {selected?.name}：{selected?.messages} 条记录、{selected?.summaries} 条摘要、{selected?.images} 张图片。
        导入将替换当前对话和记忆，保留当前资料与模型设置。建议先导出当前记忆。
      </AlertDialog.Description>
      {#if problem}<p class="text-error mt-3 text-sm" role="alert">{problem}</p>{/if}
      <div class="modal-action">
        <AlertDialog.Cancel class="btn" disabled={busy}>取消</AlertDialog.Cancel>
        <AlertDialog.Action class="btn btn-primary" onclick={restore} disabled={busy}>{busy ? "正在导入…" : "确认导入"}</AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
