<script lang="ts">
  import { VOICES, type SpeechPreferences } from "#lib/contracts/index.js";
  import { http } from "#lib/app/http.js";
  import Dropdown from "#lib/ui/Dropdown.svelte";
  import { Switch } from "bits-ui";
  import { onDestroy } from "svelte";
  const controller = new AbortController();
  onDestroy(() => controller.abort());

  let {
    speech,
    onSpeechSaved,
  }: {
    speech: SpeechPreferences;
    onSpeechSaved: (s: SpeechPreferences) => void | Promise<void>;
  } = $props();

  let voice = $derived(speech.voice);
  let autoPlay = $derived(speech.autoPlay);
  let savingSpeech = $state(false);
  let message = $state("");

  async function saveSpeech(event: SubmitEvent) {
    event.preventDefault();
    if (savingSpeech) return;
    savingSpeech = true;
    message = "";
    try {
      const preferences = await http<SpeechPreferences>(
        "/api/speech/settings",
        {
          method: "PUT",
          body: JSON.stringify({ voice, autoPlay }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      await onSpeechSaved(preferences);
      if (!controller.signal.aborted) message = "语音设置已保存";
    } catch (error) {
      if (!controller.signal.aborted)
        message = error instanceof Error ? error.message : "保存失败";
    } finally {
      if (!controller.signal.aborted) savingSpeech = false;
    }
  }
</script>

<form class="space-y-3" onsubmit={saveSpeech}>
  <h3 class="font-medium">语音播报</h3>
  <label class="label" for="set-voice">音色</label>
  <Dropdown
    id="set-voice"
    label="音色"
    value={voice}
    options={VOICES}
    onChange={(value) => (voice = value)}
    disabled={savingSpeech}
  />
  <label class="label justify-start gap-3">
    <Switch.Root class="toggle toggle-primary toggle-sm" bind:checked={autoPlay} disabled={savingSpeech} aria-label="回复后自动播放" />
    回复后自动播放
  </label>
  <div>
    <button class="btn btn-primary btn-sm" disabled={savingSpeech}>
      {savingSpeech ? "保存中" : "保存语音设置"}
    </button>
  </div>
  {#if message}<p class="text-sm" role="status">{message}</p>{/if}
</form>
