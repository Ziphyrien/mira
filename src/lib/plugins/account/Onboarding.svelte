<script lang="ts">
  import { fly } from "svelte/transition";
  import { Checkbox, RadioGroup } from "bits-ui";
  import { onDestroy, onMount } from "svelte";
  const controller = new AbortController();
  onDestroy(() => controller.abort());
  import { http as api } from "#lib/app/http.js";
  import { useActor } from "#lib/app/actor.svelte.js";
  import { onboardingMachine } from "#lib/plugins/account/machine.js";
  import {
    FOCUS,
    STYLES,
    type Profile,
    type SpaceState,
  } from "#lib/contracts/index.js";
  import Backdrop from "#lib/app/Backdrop.svelte";

  let { onDone }: { onDone: (s: SpaceState) => void } = $props();

  const flow = useActor(onboardingMachine);
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
  const step = $derived(String(flow.snapshot.value));
  const steps = ["name", "focus", "style"];
  const progress = $derived(
    Math.max(0, steps.indexOf(step === "saving" ? "style" : step) + 1),
  );

  let name = $state("");
  let focus = $state<string[]>([]);
  let style = $state<Profile["style"]>("balanced");
  let error = $state("");
  let key = $state("");
  const restoring = $derived(step === "restoring");

  async function restore(event: SubmitEvent) {
    event.preventDefault();
    if (!key.trim() || restoring) return;
    error = "";
    flow.send({ type: "NEXT" });
    try {
      await api("/api/key", {
        method: "POST",
        body: JSON.stringify({ key: key.trim() }),
        signal: controller.signal,
      });
      const state = await api<SpaceState>("/api/me", {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!state.profile) throw new Error("无法读取账户资料，请重新输入密钥。");
      flow.send({ type: "SAVED" });
      onDone(state);
    } catch (failure) {
      if (controller.signal.aborted) return;
      error = failure instanceof Error ? failure.message : "无法恢复账户";
      flow.send({ type: "FAIL" });
    }
  }

  async function finish() {
    error = "";
    flow.send({ type: "NEXT" });
    try {
      const s = await api<SpaceState>("/api/onboard", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          focus,
          style,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });
      flow.send({ type: "SAVED" });
      if (!controller.signal.aborted) onDone(s);
    } catch (e) {
      if (controller.signal.aborted) return;
      error = e instanceof Error ? e.message : "无法创建账户";
      flow.send({ type: "FAIL" });
    }
  }
</script>

<main class="relative grid min-h-dvh place-items-center p-4">
  <Backdrop />
  <div
    class="card bg-base-100/85 border-base-300 relative w-full max-w-md border shadow-xl backdrop-blur-xl"
  >
    <div class="card-body gap-5">
      {#if steps.includes(step) || step === "saving"}
        <div class="flex items-center gap-3">
          <button
            class="btn btn-ghost btn-sm btn-circle"
            aria-label="上一步"
            onclick={() => flow.send({ type: "BACK" })}
            disabled={step === "saving"}
          >
            <span class="icon-[lucide--arrow-left]"></span>
          </button>
          <progress
            class="progress progress-primary w-full"
            value={progress}
            max="3"
            aria-label="进度"
          ></progress>
        </div>
      {:else if step === "restore" || restoring}
        <button
          type="button"
          class="btn btn-ghost btn-sm self-start"
          disabled={restoring}
          onclick={() => {
            error = "";
            flow.send({ type: "BACK" });
          }}
        >
          返回
        </button>
      {/if}

      {#key step}
        <div in:fly={{ y: 8, duration: 200 }} class="space-y-4">
          {#if step === "welcome"}
            <h1 class="text-2xl font-semibold">你好，我是 Mira</h1>
            <p class="text-base-content/70">
              一个会记住你们每次对话的个人助理。先花半分钟让我了解你，之后的回答会更合你心意。
            </p>
            <button
              class="btn btn-primary w-full"
              disabled={!mounted}
              onclick={() => flow.send({ type: "NEXT" })}
            >
              开始
            </button>
            <button
              type="button"
              class="text-primary block w-full text-center text-sm hover:underline"
              disabled={!mounted}
              onclick={() => {
                error = "";
                flow.send({ type: "EXISTING" });
              }}
            >
              已有账户点我
            </button>
          {:else if step === "restore" || restoring}
            <form class="space-y-4" onsubmit={restore}>
              <h1 class="text-2xl font-semibold">继续之前的对话</h1>
              <label class="block text-sm font-medium" for="ob-key">
                账户密钥
              </label>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                id="ob-key"
                class="input w-full font-mono"
                bind:value={key}
                maxlength="64"
                placeholder="粘贴你的密钥"
                autocomplete="off"
                spellcheck="false"
                disabled={restoring}
                autofocus
              />
              {#if error}<p class="text-error text-sm" role="alert">
                  {error}
                </p>{/if}
              <button
                class="btn btn-primary w-full"
                disabled={!key.trim() || restoring}
              >
                {#if restoring}<span
                    class="loading loading-spinner loading-sm"
                  ></span>{/if}
                继续聊天
              </button>
            </form>
          {:else if step === "name"}
            <form
              class="space-y-4"
              onsubmit={(e) => (
                e.preventDefault(),
                name.trim() && flow.send({ type: "NEXT" })
              )}
            >
              <label class="block text-xl font-semibold" for="ob-name">
                我该怎么称呼你？
              </label>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                id="ob-name"
                class="input input-lg w-full"
                bind:value={name}
                maxlength="40"
                placeholder="名字或昵称"
                autocomplete="nickname"
                autofocus
              />
              <button class="btn btn-primary w-full" disabled={!name.trim()}>
                继续
              </button>
            </form>
          {:else if step === "focus"}
            <fieldset class="space-y-4">
              <legend class="text-xl font-semibold">
                想让我在哪些事上帮你？
              </legend>
              <p class="text-base-content/60 -mt-2 text-sm">
                可以多选，之后随时改。
              </p>
              <Checkbox.Group bind:value={focus} class="grid grid-cols-2 gap-2" aria-label="关注">
                {#each FOCUS as f (f.id)}
                  <Checkbox.Root value={f.id}
                    class={[
                      "btn h-auto justify-start py-3 font-normal",
                      focus.includes(f.id)
                        ? "btn-primary"
                        : "btn-outline border-base-300",
                    ]}
                  >
                    <span class={f.icon}></span>
                    {f.label}
                  </Checkbox.Root>
                {/each}
              </Checkbox.Group>
              <button
                class="btn btn-primary w-full"
                onclick={() => flow.send({ type: "NEXT" })}
              >
                {focus.length ? "继续" : "跳过"}
              </button>
            </fieldset>
          {:else}
            <fieldset class="space-y-4">
              <legend class="text-xl font-semibold">你喜欢怎样的回答？</legend>
              <RadioGroup.Root value={style} onValueChange={(value) => { const selected = STYLES.find(item => item.id === value); if (selected) style = selected.id; }} class="space-y-2" aria-label="回答风格">
                {#each STYLES as s (s.id)}
                  <label
                    class={[
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-3",
                      style === s.id
                        ? "border-primary bg-primary/5"
                        : "border-base-300",
                    ]}
                  >
                    <RadioGroup.Item class="radio radio-primary radio-sm" value={s.id} aria-label={s.label} />
                    <span>
                      <span class="font-medium">{s.label}</span>
                      <span class="text-base-content/60 text-sm">
                        · {s.hint}
                      </span>
                    </span>
                  </label>
                {/each}
              </RadioGroup.Root>
              {#if error}<p class="text-error text-sm" role="alert">
                  {error}
                </p>{/if}
              <button
                class="btn btn-primary w-full"
                onclick={finish}
                disabled={step === "saving"}
              >
                {#if step === "saving"}<span
                    class="loading loading-spinner loading-sm"
                  ></span>{/if}开始聊天
              </button>
            </fieldset>
          {/if}
        </div>
      {/key}
    </div>
  </div>
</main>
