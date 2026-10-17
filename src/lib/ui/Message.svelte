<script lang="ts">
  import ReplyContent from "#lib/ui/ReplyContent.svelte";
  import SearchActivity from "#lib/ui/SearchActivity.svelte";
  import Disclosure from "#lib/ui/Disclosure.svelte";
  import { onDestroy } from "svelte";
  import { clock } from "#lib/app/clock.svelte.js";
  import { ago } from "#lib/app/time.js";
  import type { Row } from "#lib/contracts/index.js";
  import { IMAGE_ONLY_TEXT } from "#lib/shared/images.js";

  let {
    row,
    streaming = false,
    onSpeak,
    onRegenerate,
    speechDisabled = false,
    regenerateDisabled = false,
  }: {
    row: Pick<
      Row,
      "kind" | "text" | "image" | "thinking" | "searches" | "stopped" | "at"
    > & { i: number };
    streaming?: boolean;
    onSpeak?: () => void;
    onRegenerate?: () => void;
    speechDisabled?: boolean;
    regenerateDisabled?: boolean;
  } = $props();
  let thoughtOpen = $derived(streaming);
  let copied = $state(false);
  let copyError = $state("");
  let timer: ReturnType<typeof setTimeout>;
  onDestroy(() => clearTimeout(timer));
  async function copy() {
    try {
      await navigator.clipboard.writeText(row.text);
      copied = true;
      copyError = "";
      clearTimeout(timer);
      timer = setTimeout(() => {
        copied = false;
      }, 1600);
    } catch {
      copyError = "暂时无法复制，请允许剪贴板访问。";
    }
  }
</script>

<article
  id={`m-${row.i}`}
  class={["group flex", row.kind === "user" ? "justify-end" : "justify-start"]}
>
  {#if row.kind === "user"}
    <div class="bg-base-200 max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5">
      {#if row.image}
        <a
          href={`/api/images/${row.image.id}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="查看上传的图片"
        >
          <img
            src={`/api/images/${row.image.id}`}
            width={row.image.width}
            height={row.image.height}
            alt="上传的图片"
            loading="lazy"
            class="max-h-80 max-w-full rounded-lg object-contain"
          />
        </a>
      {/if}
      {#if !row.image || row.text !== IMAGE_ONLY_TEXT}<p
          class={["whitespace-pre-wrap", row.image && "mt-2"]}
        >
          {row.text}
        </p>{/if}
    </div>
  {:else}
    <div class="w-full">
      {#each row.searches ?? [] as search (search.id)}<SearchActivity
          {search}
        />{/each}
      {#if row.thinking}
        <Disclosure class="bg-base-200/40 border-base-300 mb-3 rounded-xl border" bind:open={thoughtOpen} triggerClass="text-base-content/60 gap-2 px-3 py-2 text-sm select-none">
          {#snippet trigger(open)}
            <span
              class={["icon-[lucide--chevron-right] size-3.5 transition-transform", open && "rotate-90"]}
              aria-hidden="true"
            ></span>
            思考过程
          {/snippet}
          <div
            class="text-base-content/65 px-3 pb-3 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere"
          >
            {row.thinking}
          </div>
        </Disclosure>
      {/if}
      <ReplyContent text={row.text} searches={row.searches} {streaming} />
    </div>
  {/if}
</article>
{#if !streaming}
  <div
    class={[
      "text-base-content/50 mt-1 flex items-center gap-1",
      row.kind === "user" && "justify-end",
    ]}
  >
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square"
      aria-label={copied ? "已复制" : "复制消息"}
      title={copied ? "已复制" : "复制"}
      onclick={copy}
    >
      <span
        class={copied
          ? "icon-[lucide--check] size-3.5"
          : "icon-[lucide--copy] size-3.5"}
      ></span>
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square"
      aria-label="播报消息"
      title="播报"
      onclick={onSpeak}
      disabled={speechDisabled || !onSpeak}
    >
      <span class="icon-[lucide--volume-2] size-3.5"></span>
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square"
      aria-label="重新生成"
      title="重新生成"
      onclick={onRegenerate}
      disabled={regenerateDisabled || !onRegenerate}
    >
      <span class="icon-[lucide--rotate-cw] size-3.5"></span>
    </button>
    {#if row.stopped}<span class="ml-1 text-xs">已停止</span>{/if}
    <span class="ml-1 text-xs">{clock.now && ago(row.at)}</span>
  </div>
  {#if copyError}<p class="text-error mt-1 text-xs" role="alert">
      {copyError}
    </p>{/if}
{/if}
