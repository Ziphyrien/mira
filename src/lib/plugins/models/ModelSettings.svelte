<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { http as api } from "#lib/app/http.js";
  import Dropdown from "#lib/ui/Dropdown.svelte";
  import { Checkbox } from "bits-ui";
  import {
    AI_PROVIDERS,
    KEY_PROVIDERS,
    THINKING,
    type AiAdminState,
    type KeyProvider,
    type ModelChoice,
  } from "#lib/contracts/index.js";

  let config = $state.raw<AiAdminState | null>(null);
  let chat = $state("");
  let memory = $state("");
  let keys = $state({ radius: "", deepseek: "", mimo: "", tavily: "" });
  let clear = $state({
    radius: false,
    deepseek: false,
    mimo: false,
    tavily: false,
  });
  let saving = $state(false);
  let notice = $state("");
  let failed = $state(false);

  let destroyed = false;
  let activeCtrl: AbortController | null = null;
  let epoch = 0;

  const modelKey = (choice: ModelChoice | null) =>
    choice ? `${choice.provider}/${choice.modelId}` : "";
  const choices = $derived([
    { id: "chat", label: "日常聊天模型", value: chat },
    { id: "memory", label: "记忆压缩模型", value: memory },
  ]);

  const modelOptions = $derived(AI_PROVIDERS.flatMap(provider =>
    (config?.catalog ?? []).filter(model => model.provider === provider.id).map(model => ({
      id: modelKey(model), label: `${model.name} · ${model.modelId}`, group: provider.name,
    }))
  ));

  function apply(value: AiAdminState) {
    config = value;
    chat = modelKey(value.chat);
    memory = modelKey(value.memory);
    keys = { radius: "", deepseek: "", mimo: "", tavily: "" };
    clear = { radius: false, deepseek: false, mimo: false, tavily: false };
  }

  async function load() {
    if (destroyed) return;
    activeCtrl?.abort();
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    const currentEpoch = ++epoch;
    notice = "";
    failed = false;

    try {
      const data = await api<AiAdminState>("/api/admin/models", {
        signal: ctrl.signal,
      });
      if (destroyed || currentEpoch !== epoch) return;
      apply(data);
    } catch (error) {
      if (destroyed || currentEpoch !== epoch || ctrl.signal.aborted) return;
      failed = true;
      notice = (error as Error).message;
    } finally {
      if (activeCtrl === ctrl) activeCtrl = null;
    }
  }

  onMount(load);

  onDestroy(() => {
    destroyed = true;
    activeCtrl?.abort();
    activeCtrl = null;
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !config || destroyed) return;
    const chatModel = config.catalog.find((model) => modelKey(model) === chat);
    const memoryModel = config.catalog.find(
      (model) => modelKey(model) === memory,
    );
    if (!chatModel || !memoryModel) return;

    activeCtrl?.abort();
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    const currentEpoch = ++epoch;

    saving = true;
    notice = "";
    failed = false;

    try {
      const updates: Partial<Record<KeyProvider, string | null>> = {};
      for (const provider of KEY_PROVIDERS) {
        const value = keys[provider.id].trim();
        if (clear[provider.id]) updates[provider.id] = null;
        else if (value) updates[provider.id] = value;
      }
      const data = await api<AiAdminState>("/api/admin/models", {
        method: "PUT",
        body: JSON.stringify({
          chat: { provider: chatModel.provider, modelId: chatModel.modelId },
          memory: {
            provider: memoryModel.provider,
            modelId: memoryModel.modelId,
          },
          keys: updates,
        }),
        signal: ctrl.signal,
      });
      if (destroyed || currentEpoch !== epoch) return;
      apply(data);
      notice = "模型设置已保存";
    } catch (error) {
      if (destroyed || currentEpoch !== epoch || ctrl.signal.aborted) return;
      failed = true;
      notice = (error as Error).message;
    } finally {
      if (activeCtrl === ctrl) activeCtrl = null;
      if (!destroyed && currentEpoch === epoch) {
        saving = false;
      }
    }
  }
</script>

<section
  class="card border-base-300 mb-6 border"
  aria-labelledby="model-settings-title"
>
  <form class="card-body gap-5" onsubmit={save}>
    <div class="flex items-center justify-between gap-3">
      <h2 id="model-settings-title" class="text-lg font-semibold">模型设置</h2>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={load}
        disabled={saving}
      >
        刷新列表
      </button>
    </div>
    {#if config}
      <div class="grid gap-4 sm:grid-cols-2">
        {#each KEY_PROVIDERS as provider (provider.id)}
          <div>
            <label class="label" for={`key-${provider.id}`}>
              {provider.name} API Key
            </label>
            <input
              id={`key-${provider.id}`}
              class="input w-full"
              type="password"
              autocomplete="off"
              spellcheck="false"
              bind:value={keys[provider.id]}
              disabled={saving || clear[provider.id]}
              placeholder={config.keys[provider.id]
                ? "已设置，留空保留"
                : "尚未设置"}
            />
            {#if config.keys[provider.id]}
              <label class="label mt-2 justify-start gap-2 text-sm">
                <Checkbox.Root class="checkbox checkbox-xs" bind:checked={clear[provider.id]} disabled={saving} aria-label={"删除已保存的 " + provider.name + " Key"} />
                删除已保存的 Key
              </label>
            {/if}
          </div>
        {/each}
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        {#each choices as choice (choice.id)}
          {@const selected = config.catalog.find(
            (model) => modelKey(model) === choice.value,
          )}
          <div>
            <label class="label" for={`model-${choice.id}`}>
              {choice.label}
            </label>
            <Dropdown
              id={`model-${choice.id}`}
              label={choice.label}
              value={choice.value}
              options={modelOptions}
              placeholder="选择模型"
              onChange={(value) => {
                if (choice.id === "chat") chat = value;
                else memory = value;
              }}
              disabled={saving}
              required
            />
            {#if selected}<p class="text-base-content/60 mt-2 text-xs">
                默认思考：{THINKING.find(
                  (level) => level.id === selected.highest,
                )?.label}
              </p>{/if}
          </div>
        {/each}
      </div>
      <div class="flex items-center gap-3">
        <button
          class="btn btn-primary btn-sm"
          disabled={saving || !chat || !memory}
        >
          {saving ? "保存中" : "保存设置"}
        </button>
        {#if notice}<p
            class={["text-sm", failed ? "text-error" : "text-success"]}
            role="status"
          >
            {notice}
          </p>{/if}
      </div>
    {:else if notice}
      <p class="text-error text-sm" role="alert">{notice}</p>
      <button
        type="button"
        class="btn btn-ghost btn-sm mt-2"
        aria-label="重新加载模型设置"
        onclick={load}
      >
        重试
      </button>
    {:else}
      <span
        class="loading loading-spinner loading-sm"
        aria-label="加载模型设置"
      ></span>
    {/if}
  </form>
</section>
