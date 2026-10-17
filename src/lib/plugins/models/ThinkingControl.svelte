<script lang="ts">
  import { THINKING } from "#lib/contracts/index.js";
  import { getModels } from "#lib/plugins/models/context.js";
  import { useSnapshot } from "#lib/app/adapter.svelte.js";
  import ThinkingPicker from "#lib/plugins/models/ThinkingPicker.svelte";
  const models = getModels();
  const model = useSnapshot(models.view!);
  const chat = useSnapshot(models.activity);
  const busy = $derived(!chat().matches("idle") || chat().serverBusy);
  const hasChoices = $derived(THINKING.some(option => model().model?.thinking.includes(option.id)));
</script>

{#if hasChoices}
  <ThinkingPicker
    value={model().thinking}
    levels={model().model?.thinking ?? []}
    disabled={busy || !model().model}
    onChange={(value) => models.setThinking(value)}
  />
{/if}
