<script lang="ts">
  import { THINKING, type AiModelInfo, type ChatInput } from "#lib/contracts/index.js";
  import Dropdown from "#lib/ui/Dropdown.svelte";

  let {
    value,
    levels,
    disabled = false,
    onChange,
  }: {
    value: ChatInput["thinking"];
    levels: AiModelInfo["thinking"];
    disabled?: boolean;
    onChange: (value: ChatInput["thinking"]) => void;
  } = $props();
  const choices = $derived(THINKING.filter(option => levels.includes(option.id)));
</script>

{#if choices.length}
  <Dropdown
    {value}
    {disabled}
    {onChange}
    options={choices}
    label="思考档位"
    prefix="思考"
    variant="compact"
    placement="top"
  />
{/if}
