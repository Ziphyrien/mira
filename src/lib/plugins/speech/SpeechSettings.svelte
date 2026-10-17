<script lang="ts">
  import { getSpeech } from "#lib/plugins/speech/context.js";
  import SpeechForm from "#lib/plugins/speech/SpeechForm.svelte";
  const speech = getSpeech();
</script>

<SpeechForm
  speech={speech.view!.preferences}
  onSpeechSaved={(preferences) => speech.preferences({ preferences })}
/>
