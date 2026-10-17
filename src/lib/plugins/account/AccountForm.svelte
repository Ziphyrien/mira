<script lang="ts">
  import { http } from "#lib/app/http.js";
  import ConfirmAction from "#lib/ui/ConfirmAction.svelte";
  import { onDestroy } from "svelte";
  const controller = new AbortController();
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => {
    controller.abort();
    clearTimeout(copyTimer);
  });

  let { onReset, flushDraft, clearDraft }: {
    onReset: () => void;
    flushDraft: () => Promise<void>;
    clearDraft: () => Promise<void>;
  } = $props();

  let key = $state("");
  let restore = $state("");
  let copied = $state(false);
  let message = $state("");
  function report(error: unknown) {
    if (!controller.signal.aborted)
      message = error instanceof Error ? error.message : "请求失败，请重试。";
  }
  async function reveal() {
    try {
      const value = await http<{ key: string }>("/api/key", {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) key = value.key;
    } catch (error) {
      report(error);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(key);
      if (controller.signal.aborted) return;
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    } catch (error) {
      report(error);
    }
  }
  async function useKey(event: SubmitEvent) {
    event.preventDefault();
    try {
      await flushDraft();
      if (controller.signal.aborted) return;
      await http("/api/key", {
        method: "POST",
        body: JSON.stringify({ key: restore }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) onReset();
    } catch (error) {
      report(error);
    }
  }
  async function wipe() {
    try {
      await flushDraft();
      if (controller.signal.aborted) return;
      await http("/api/me", { method: "DELETE", signal: controller.signal });
      await clearDraft();
      if (!controller.signal.aborted) onReset();
    } catch (error) {
      report(error);
    }
  }
</script>

<section class="space-y-3">
  <h3 class="font-medium">在其他设备上继续</h3>
  <p class="text-base-content/70 text-sm">
    你的对话和记忆保存在云端，与这把密钥对应。在新设备上输入它即可接着聊。请妥善保存。
  </p>
  {#if key}
    <div class="join w-full">
      <input
        class="input join-item w-full font-mono"
        readonly
        value={key}
        aria-label="你的密钥"
      />
      <button class="btn join-item" onclick={copy}>
        <span
          class={copied ? "icon-[lucide--check]" : "icon-[lucide--copy]"}
        ></span>
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  {:else}
    <button class="btn btn-sm" onclick={reveal}>
      <span class="icon-[lucide--key-round]"></span>
      显示密钥
    </button>
  {/if}
  <form class="join w-full" onsubmit={useKey}>
    <input
      class="input join-item w-full font-mono"
      placeholder="粘贴已有的密钥"
      bind:value={restore}
      aria-label="已有的密钥"
    />
    <button class="btn join-item">切换</button>
  </form>
</section>

<div class="divider"></div>
<section class="space-y-2">
  <h3 class="font-medium">数据</h3>
  <ConfirmAction label="删除全部数据" title="删除全部数据" description="将永久删除全部对话与记忆，此操作无法撤销。" onConfirm={wipe} />
</section>
{#if message}<p class="mt-3 text-sm" role="status">{message}</p>{/if}
