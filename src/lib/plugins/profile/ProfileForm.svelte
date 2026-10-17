<script lang="ts">
  import {
    FOCUS,
    STYLES,
    type Profile,
    type SpaceState,
  } from "#lib/contracts/index.js";
  import { http } from "#lib/app/http.js";
  import { Checkbox, RadioGroup } from "bits-ui";
  import { onDestroy } from "svelte";
  const controller = new AbortController();
  onDestroy(() => controller.abort());

  let {
    profile,
    onSaved,
  }: { profile: Profile; onSaved: (s: SpaceState) => void | Promise<void> } =
    $props();

  let name = $derived(profile.name);
  let focus: string[] = $derived([...profile.focus]);
  let style = $derived(profile.style);
  let message = $state("");
  let saving = $state(false);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (saving || controller.signal.aborted) return;
    saving = true;
    try {
      const state = await http<SpaceState>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ ...profile, name, focus, style }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await onSaved(state);
      if (!controller.signal.aborted) message = "已保存";
    } catch (err) {
      if (!controller.signal.aborted)
        message = err instanceof Error ? err.message : "保存失败";
    } finally {
      if (!controller.signal.aborted) saving = false;
    }
  }
</script>

<form class="space-y-3" onsubmit={save}>
  <label class="block text-sm font-medium" for="set-name">称呼</label>
  <input
    id="set-name"
    class="input w-full"
    bind:value={name}
    maxlength="40"
    required
  />
  <fieldset>
    <legend class="mb-2 text-sm font-medium">关注</legend>
    <Checkbox.Group bind:value={focus} class="flex flex-wrap gap-2" aria-label="关注">
      {#each FOCUS as f (f.id)}
        <Checkbox.Root value={f.id}
          class={[
            "btn btn-sm",
            focus.includes(f.id) ? "btn-primary" : "btn-outline",
          ]}
        >
          {f.label}
        </Checkbox.Root>
      {/each}
    </Checkbox.Group>
  </fieldset>
  <fieldset>
    <legend class="mb-2 text-sm font-medium">回答风格</legend>
    <RadioGroup.Root value={style} onValueChange={(value) => { const selected = STYLES.find(item => item.id === value); if (selected) style = selected.id; }} class="join" orientation="horizontal" aria-label="回答风格">
      {#each STYLES as s (s.id)}
        <RadioGroup.Item class={["join-item btn btn-sm", style === s.id && "btn-primary"]} value={s.id}>{s.label}</RadioGroup.Item>
      {/each}
    </RadioGroup.Root>
  </fieldset>
  <button class="btn btn-primary btn-sm">保存资料</button>
  {#if message}<p class="text-sm" role="status">{message}</p>{/if}
</form>
