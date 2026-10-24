<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { Virtualizer, type VirtualizerHandle } from "virtua/svelte";
  import { getHistory } from "#lib/plugins/history/context.js";
  import type { HistorySnapshot } from "#lib/plugins/history/ports.js";
  import { getShell } from "#lib/app/shell-context.js";
  import { useSnapshot } from "#lib/app/adapter.svelte.js";
  import { dayLabel, sameDay } from "#lib/app/time.js";
  import { FOCUS, type Row } from "#lib/contracts/index.js";
  import Backdrop from "#lib/app/Backdrop.svelte";
  import Message from "#lib/ui/Message.svelte";
  const owner = getHistory();
  const shell = getShell();
  const history = useSnapshot<HistorySnapshot>(owner.view!);
  const chat = useSnapshot(owner.activity);
  const models = useSnapshot(owner.models);
  const images = useSnapshot(owner.images);
  const voice = owner.voice;
  const profile = owner.profile;
  const busy = $derived(!chat().matches("idle") || chat().serverBusy);
  const pending = $derived.by(() => {
    if (chat().context.searches.some((search) => search.status === "running")) return "正在搜索网页";
    if (chat().context.phase === "recall") return "正在回顾之前的对话";
    return "正在想";
  });
  const suggestions = $derived(
    (profile.profile.focus.length
      ? FOCUS.filter((item) => profile.profile.focus.includes(item.id))
      : FOCUS.slice(0, 3)
    )
      .flatMap((item) => item.prompts)
      .slice(0, 4),
  );
  const greeting = $derived.by(() => {
    const hour = new Date().getHours();
    if (hour < 6) return "夜深了";
    if (hour < 12) return "早上好";
    if (hour < 18) return "下午好";
    return "晚上好";
  });
  let list = $state.raw<HTMLElement>();
  let virtual = $state.raw<VirtualizerHandle>();
  let prepending = $state(false);
  let pinned = true;
  let navigating = $state(false);
  let navigation: AbortController | undefined;
  let writtenTop: number | undefined;
  let wasBusy = false;
  let settling = false;
  let settleFrame: number | undefined;
  $effect.pre(() => {
    const active = busy;
    if (wasBusy && !active) untrack(() => {
      if (!list || pinned || shell.folded || navigating) return;
      const node = list;
      const top = node.scrollTop;
      settling = true;
      // The live tail is replaced by a virtual history row. Preserve the reader's
      // position across the brief height contraction until the row is measured.
      settleFrame = requestAnimationFrame(() => {
        settleFrame = requestAnimationFrame(() => {
          if (!disposed && list === node && !shell.folded) setTop(node, top);
          settling = false;
          settleFrame = undefined;
        });
      });
    });
    wasBusy = active;
  });
  function setTop(node: HTMLElement, top: number) {
    node.scrollTop = top;
    writtenTop = node.scrollTop;
  }
  async function followGrowth() {
    // Wait for virtua's measured sizes and offset corrections to reach the DOM.
    // A pending index scroll would keep retargeting the tail after a reader scrolls up.
    await tick();
    if (disposed || !list || prepending || navigating || settling || shell.folded) return;
    if (pinned) setTop(list, list.scrollHeight);
  }
  function observeContent(node: HTMLElement) {
    const observer = new ResizeObserver(followGrowth);
    observer.observe(node);
    if (list) observer.observe(list);
    void followGrowth();
    return () => observer.disconnect();
  }
  let disposed = false;
  let navigationRevision = 0;
  let navigationError = $state("");
  function run(work: Promise<unknown>) {
    void work.catch((error: unknown) => {
      if (!disposed) navigationError = error instanceof Error ? error.message : "无法读取更早消息";
    });
  }
  async function scrollDown(force = false) {
    await tick();
    if (disposed || !list || prepending || navigating || settling || shell.folded) return;
    if (force) pinned = true;
    if (pinned) {
      setTop(list, list.scrollHeight);
    }
  }
  async function prepend() {
    if (!list || prepending || !history().prefetched || disposed) return;
    prepending = true;
    try {
      await owner.prepend(null);
      await tick();
    } finally {
      prepending = false;
    }
  }
  function scrolled() {
    if (list && !shell.folded && !prepending && !navigating && !settling) {
      if (writtenTop === undefined || Math.abs(list.scrollTop - writtenTop) > 1) {
        pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      }
      writtenTop = undefined;
    }
    if (
      disposed ||
      navigating ||
      settling ||
      shell.folded ||
      !list ||
      list.scrollTop > 800 ||
      history().nextBefore === null
    )
      return;
    run(
      owner.prefetch(null).then(() => {
        if (!disposed && !navigating && list && !shell.folded && list.scrollTop <= 120)
          return prepend();
      }),
    );
  }
  function attach(node: HTMLElement) {
    list = node;
    return () => {
      if (list === node) list = undefined;
    };
  }
  async function jump(row: Row, caller?: AbortSignal): Promise<boolean> {
    navigation?.abort();
    const request = new AbortController();
    navigation = request;
    const signal = caller ? AbortSignal.any([request.signal, caller]) : request.signal;
    const revision = ++navigationRevision;
    pinned = false;
    navigating = true;
    try {
      signal.throwIfAborted();
      shell.showChat();
      await tick();
      signal.throwIfAborted();
      if (disposed || revision !== navigationRevision) return false;
      const found = await owner.loadUntil(row.i, signal);
      signal.throwIfAborted();
      if (!found) {
        if (history().error) throw new Error(history().error!);
        return false;
      }
      await tick();
      signal.throwIfAborted();
      if (disposed || revision !== navigationRevision || shell.folded) return false;
      const index = history().rows.findIndex((item) => item.i === row.i);
      if (index < 0 || !virtual) return false;
      virtual.scrollToIndex(index, { align: "center" });
      const deadline = performance.now() + 2000;
      let node: HTMLElement | null | undefined;
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        signal.throwIfAborted();
        if (disposed || revision !== navigationRevision || shell.folded) return false;
        node = list?.querySelector<HTMLElement>(`[id="m-${row.i}"]`);
      } while (!node && performance.now() < deadline);
      if (!node) return false;
      if (list) writtenTop = list.scrollTop;
      node.animate(
        [
          { backgroundColor: "var(--tint-primary)" },
          { backgroundColor: "transparent" },
        ],
        1600,
      );
      return true;
    } finally {
      if (navigation === request) {
        navigating = false;
        navigation = undefined;
      }
    }
  }
  const detach = owner.navigation!.attach({ scrollDown, jump });
  onDestroy(() => {
    disposed = true;
    ++navigationRevision;
    navigation?.abort();
    if (settleFrame !== undefined) cancelAnimationFrame(settleFrame);
    detach();
  });
</script>

<main
  {@attach attach}
  onscroll={scrolled}
  class="relative flex-1 overflow-y-auto"
  aria-live="polite"
  style:overflow-anchor="none"
>
  {#if shell.folded}{#each shell.mainViews as entry (entry.key)}{@const View = entry.component}<View
      />{/each}
  {:else if history().rows.length === 0 && !busy}<section
      class="relative grid min-h-full place-items-center p-6"
    >
      <Backdrop class="opacity-70" />
      <div class="relative w-full max-w-xl text-center">
        <h1 class="text-3xl font-semibold">
          {greeting}，{profile.profile.name}
        </h1>
        <p class="text-base-content/60 mt-2">从任何事情聊起都可以。</p>
        <div class="mt-8 grid gap-2 sm:grid-cols-2">
          {#each suggestions as suggestion (suggestion)}<button
              class="btn bg-base-100/80 border-base-300 h-auto justify-start py-3 text-left font-normal backdrop-blur"
              onclick={() => owner.send(suggestion)}
            >
              {suggestion}
            </button>{/each}
        </div>
      </div>
    </section>
  {:else}<div {@attach observeContent} class="mx-auto max-w-3xl px-4 py-6">
      <div class="h-8">
      {#if history().loading}<p
          class="text-base-content/50 flex items-center justify-center gap-2 text-xs"
          role="status"
        >
          <span class="loading loading-spinner loading-xs"></span>
          正在读取更早消息
        </p>{:else if history().error || navigationError}<p
          class="text-error text-center text-xs"
          role="alert"
        >
          {history().error || navigationError}
          <button type="button" class="link" onclick={() => run(owner.retry(null).then(scrolled))}>
            重试
          </button>
        </p>{/if}
      </div>
      {#if list}
      <Virtualizer
        bind:this={virtual}
        data={history().rows}
        getKey={(row) => row.i}
        scrollRef={list}
        startMargin={56}
        shift={prepending || navigating}
        onresize={followGrowth}
        onscrollend={followGrowth}
      >
        {#snippet children(row, index)}
        <div class="pb-5">
          {#if index === 0 || !sameDay(history().rows[index - 1].at, row.at)}
            <div class="divider text-base-content/40 text-xs">{dayLabel(row.at)}</div>
          {/if}
          <Message
            {row}
            onSpeak={() => owner.speak(row.text)}
            onRegenerate={() => owner.regenerate(row)}
            speechDisabled={!voice.enabled || voice.dictating}
            regenerateDisabled={busy ||
              voice.dictating ||
              images().uploading ||
              images().preparing ||
              !models().model ||
              row.i < 0}
          />
        </div>
        {/snippet}
      </Virtualizer>
      {/if}
      <div class="space-y-5">
      {#if busy}
        {#if chat().matches("streaming") || (chat().serverBusy && !chat().matches("failed"))}<Message
            row={{
              i: -999999,
              kind: "mira",
              text: chat().context.text,
              thinking: chat().context.thinkingText,
              searches: chat().context.searches,
              at: Date.now(),
            }}
            {pending}
            streaming
          />{/if}
        {#if chat().matches("failed")}<div role="alert" class="alert alert-soft alert-warning">
            <span class="icon-[lucide--circle-alert]"></span>
            <span>{chat().context.error}</span>
            <div class="flex gap-1">
              <button class="btn btn-sm" onclick={() => owner.retryReply()}> 重试 </button>
              <button class="btn btn-ghost btn-sm" onclick={() => owner.reload()}> 刷新 </button>
            </div>
          </div>{/if}{/if}
      </div>
    </div>{/if}
</main>
