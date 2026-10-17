<script lang="ts">
  import { getSpeech } from "#lib/plugins/speech/context.js";
  import { useSnapshot } from "#lib/app/adapter.svelte.js";
  const speech = getSpeech();
  const voice = speech.view!;
  const history = useSnapshot(speech.history);
  const chat = useSnapshot(speech.activity);
  const busy = $derived(!chat().matches("idle") || chat().serverBusy);
  const lastReply = $derived(
    history().rows.findLast((row) => row.kind === "mira")?.text ?? "",
  );
</script>

{#if voice.active}<button
    type="button"
    class="btn btn-ghost btn-sm"
    onclick={() => voice.run(speech.stop(null))}
    aria-label="停止播报"
  >
    <span class="icon-[lucide--square-stop] size-4"></span>
  </button>
{:else}<button
    type="button"
    class="btn btn-ghost btn-sm"
    onclick={() => voice.run(speech.play(lastReply))}
    disabled={!voice.enabled || !lastReply || busy || voice.dictating}
    aria-label="播放回复"
  >
    <span class="icon-[lucide--volume-2] size-4"></span>
  </button>{/if}
