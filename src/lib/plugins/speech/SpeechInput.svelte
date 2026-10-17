<script lang="ts">
  import { onDestroy } from "svelte";
  import { getSpeech } from "./context.js";
  import { useSnapshot } from "#lib/app/adapter.svelte.js";
  import { DictationSession } from "./dictation.svelte.js";
  const speech = getSpeech();
  const chat = useSnapshot(speech.activity);
  const images = useSnapshot(speech.images);
  const session = new DictationSession(speech.editor, value => speech.view!.run(speech.dictating(value)));
  const meterProfile = [0.18, 0.32, 0.52, 0.78, 1, 0.78, 0.52, 0.32, 0.18];
  const meterBars = $derived.by(() => {
    const peak = Math.max(...session.levels.map(bar => bar.level));
    return meterProfile.map((weight, position) => {
      const band = session.levels[Math.round(position * (session.levels.length - 1) / (meterProfile.length - 1))]!;
      return { position, level: weight * (peak * 0.85 + band.level * 0.15) };
    });
  });
  const active = $derived(session.phase !== "idle");
  const expanded = $derived(session.phase === "recording" || session.phase === "finishing");
  const disabled = $derived(!chat().matches("idle") || chat().serverBusy || images().uploading || images().preparing);
  onDestroy(() => session.dispose());
</script>

<svelte:window onkeydown={(event) => { if (active && event.key === "Escape") { event.preventDefault(); session.cancel(); } }} />
<div class={["flex min-w-0 items-center gap-2", expanded && "bg-primary/5 rounded-l-xl rounded-r-(--radius-field) pl-1"]}>
  {#if expanded}
    <button type="button" class="btn btn-ghost btn-square btn-sm shrink-0" aria-label="取消语音输入" onclick={() => session.cancel()}>
      <span class="icon-[lucide--x] size-4" aria-hidden="true"></span>
    </button>
    <div class="flex items-center gap-2 whitespace-nowrap" role="status" aria-live="polite">
      {#if session.phase === "recording"}
        <span class="text-primary flex h-6 w-10 shrink-0 items-center justify-between" aria-hidden="true">
          {#each meterBars as bar (bar.position)}
            <span class="w-[3px] rounded-full bg-current"
              style:height={`${3 + bar.level * 19}px`} style:opacity={0.65 + bar.level * 0.35}></span>
          {/each}
        </span>
        <span class="sr-only">正在录音，最长一分钟</span>
        <span class="text-base-content/50 ml-auto font-mono text-xs tabular-nums" aria-hidden="true">00:{String(session.elapsed).padStart(2, "0")}</span>
      {:else}
        <span class="loading loading-spinner loading-xs text-primary" aria-hidden="true"></span>
        <span class="text-base-content/65 text-xs">转写中…</span>
      {/if}
    </div>
  {:else if session.message}
    <span class="text-error max-w-52 text-xs" role="alert">{session.message}</span>
  {/if}
  <button type="button" class={["btn btn-square shrink-0", expanded ? "btn-primary" : "btn-ghost"]}
    aria-label={expanded ? "完成语音输入" : "语音输入"} aria-pressed={expanded}
    disabled={active ? session.phase !== "recording" : disabled}
    onclick={() => active ? session.finish() : void session.start()}>
    <span class={[expanded ? "icon-[lucide--check]" : "icon-[lucide--mic]", "size-5"]} aria-hidden="true"></span>
  </button>
</div>
