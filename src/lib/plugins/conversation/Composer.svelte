<script lang="ts">
  import { untrack } from "svelte";
  import { getConversation } from "#lib/plugins/conversation/context.js";
  import { MAX_DRAFT_LENGTH } from "#lib/plugins/conversation/composer.svelte.js";
  import { useSnapshot } from "#lib/app/adapter.svelte.js";
  const conversation = getConversation();
  const composer = conversation.composer!;
  const image = conversation.images;
  const chat = useSnapshot(conversation.view!);
  const models = useSnapshot(conversation.models);
  const images = useSnapshot(image.view!);
  const voice = conversation.voice;
  const busy = $derived(!chat().matches("idle") || chat().serverBusy);
  const dictating = $derived(voice.dictating || composer.composing);
  let input = $state<HTMLInputElement>();
  function choose(node: HTMLInputElement) {
    const file = node.files?.[0];
    node.value = "";
    if (file) composer.run(image.prepare(file));
  }
  function send() {
    if (!dictating) composer.run(conversation.send(composer.draft));
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  }
  function autosize(node: HTMLTextAreaElement) {
    node.style.height = composer.draft ? "auto" : "";
    if (composer.draft) node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }
  function restoreFocus(node: HTMLTextAreaElement) {
    if (composer.focusRequest) untrack(() => {
      node.focus();
      node.setSelectionRange(composer.selection.start, composer.selection.end);
    });
  }
  function select(node: HTMLTextAreaElement) { composer.select(node.selectionStart, node.selectionEnd); }
</script>

{#if chat().stopError || composer.error}<p class="text-error mx-auto mb-2 max-w-3xl text-xs" role="alert">{chat().stopError || composer.error}</p>{/if}
{#if chat().context.stopped}<p class="text-base-content/55 mx-auto mb-2 max-w-3xl text-xs" role="status">已停止生成，可以继续发送消息。</p>{/if}
{#if voice.error}<p class="text-error mx-auto mb-2 max-w-3xl text-xs" role="alert">{voice.error}</p>{/if}
{#if images().error}<p class="text-error mx-auto mb-2 max-w-3xl text-xs" role="alert">{images().error}</p>{/if}
<form class={["border-base-300 bg-base-100 focus-within:border-primary mx-auto max-w-3xl rounded-2xl border p-2 shadow-sm", dictating && "border-primary/60"]}
  onsubmit={(event) => { event.preventDefault(); send(); }}>
  {#if images().url}<div class="w-full px-1 pt-1" aria-label="待发送图片">
    <div class="relative w-fit">
      <img src={images().url ?? ""} alt="待发送图片预览" class="h-20 max-w-40 rounded-lg object-contain" />
      <button type="button" class="btn btn-neutral btn-circle btn-xs absolute -top-1 -right-1" onclick={() => composer.run(image.clear(null))} disabled={dictating || images().uploading || images().preparing} aria-label="移除图片">
        <span class="icon-[lucide--x] size-3.5" aria-hidden="true"></span>
      </button>
    </div>
  </div>{/if}
  <textarea class="block max-h-[200px] min-h-10 w-full resize-none bg-transparent px-2 py-2 outline-none" rows="1"
    placeholder="给 Mira 发消息" aria-label="消息" maxlength={MAX_DRAFT_LENGTH} readonly={composer.composing}
    value={composer.draft}
    oninput={(event) => { composer.setDraft(event.currentTarget.value); select(event.currentTarget); }}
    onselect={(event) => select(event.currentTarget)} onblur={(event) => select(event.currentTarget)}
    onkeydown={keydown} {@attach autosize} {@attach restoreFocus}></textarea>
  <div class="flex min-h-11 items-center gap-2">
    {#if models().model?.supportsImages}
      <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp" bind:this={input} onchange={(event) => choose(event.currentTarget)} aria-label="选择图片文件" />
      <button type="button" class="btn btn-ghost btn-square shrink-0" disabled={dictating || busy || images().uploading || images().preparing} onclick={() => input?.click()} aria-label="上传图片" title="上传图片">
        {#if images().preparing}<span class="loading loading-spinner size-5" aria-hidden="true"></span>{:else}<span class="icon-[lucide--image-plus] size-5" aria-hidden="true"></span>{/if}
      </button>
    {/if}
    <div class="flex min-w-0 flex-1 items-center justify-end gap-2">
      {#each conversation.actions as action (action.key)}<action.component />{/each}
    </div>
    {#if chat().matches("streaming") || chat().serverBusy}
      <button type="button" class="btn btn-primary btn-square" onclick={() => composer.run(conversation.stop(null))} disabled={chat().stopping || !chat().context.request} aria-label={chat().stopping ? "停止中" : "停止生成"} title="停止生成">
        {#if chat().stopping}<span class="loading loading-spinner size-4" aria-hidden="true"></span>{:else}<span class="icon-[lucide--square] size-4" aria-hidden="true"></span>{/if}
      </button>
    {:else}
      <button class="btn btn-primary btn-square" disabled={dictating || (!composer.draft.trim() && !images().blob) || busy || images().uploading || images().preparing || !models().model} aria-label="发送">
        {#if images().uploading}<span class="loading loading-spinner size-5" aria-hidden="true"></span>{:else}<span class="icon-[lucide--arrow-up] size-5" aria-hidden="true"></span>{/if}
      </button>
    {/if}
  </div>
</form>
