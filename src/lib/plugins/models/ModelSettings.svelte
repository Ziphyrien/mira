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
  let unlocked = $state({
    radius: false,
    deepseek: false,
    mimo: false,
    tavily: false,
  });
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

  const modelOptions = $derived(
    AI_PROVIDERS.flatMap((provider) =>
      (config?.catalog ?? [])
        .filter((model) => model.provider === provider.id)
        .map((model) => ({
          id: modelKey(model),
          label: `${model.name} · ${model.modelId}`,
          group: provider.name,
        })),
    ),
  );

  function apply(value: AiAdminState) {
    config = value;
    chat = modelKey(value.chat);
    memory = modelKey(value.memory);
    keys = { radius: "", deepseek: "", mimo: "", tavily: "" };
    unlocked = { radius: false, deepseek: false, mimo: false, tavily: false };
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

<section aria-labelledby="model-settings-title" class="space-y-4">
  <div class="flex items-center justify-between gap-3">
    <h2 id="model-settings-title" class="text-lg font-semibold">模型设置</h2>
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      onclick={load}
      disabled={saving}
    >
      <span class="icon-[lucide--refresh-cw] size-3.5" aria-hidden="true"></span>
      刷新列表
    </button>
  </div>

  <form
    class="border-base-300 space-y-6 rounded-box border p-5 sm:p-6"
    onsubmit={save}
  >
    {#if config}
      <div class="grid gap-4 sm:grid-cols-2">
        {#each choices as choice (choice.id)}
          {@const selected = config.catalog.find(
            (model) => modelKey(model) === choice.value,
          )}
          <div class="space-y-1.5">
            <label class="label text-sm font-medium" for={`model-${choice.id}`}>
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
            {#if selected}
              <p class="text-base-content/55 text-xs">
                默认思考：{THINKING.find(
                  (level) => level.id === selected.highest,
                )?.label}
              </p>
            {/if}
          </div>
        {/each}
      </div>

      <div class="border-base-300 border-t pt-5">
        <div class="mb-3 text-xs font-medium text-base-content/60">
          服务商密钥
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          {#each KEY_PROVIDERS as provider (provider.id)}
            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-2">
                <label class="label text-sm font-medium" for={`key-${provider.id}`}>
                  {provider.name} API Key
                </label>
                {#if config.keys[provider.id]}
                  <label class="text-base-content/60 flex cursor-pointer items-center gap-1.5 text-xs">
                    <Checkbox.Root
                      class="checkbox checkbox-xs"
                      bind:checked={clear[provider.id]}
                      disabled={saving}
                      aria-label={"删除已保存的 " + provider.name + " Key"}
                    />
                    删除已保存的 Key
                  </label>
                {/if}
              </div>
              <input
                id={`key-${provider.id}`}
                name={`api-key-${provider.id}`}
                class="input w-full"
                type="password"
                autocomplete="new-password"
                 spellcheck="false"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                readonly={!unlocked[provider.id]}
                onfocus={() => {
                  unlocked[provider.id] = true;
                }}
                bind:value={keys[provider.id]}
                disabled={saving || clear[provider.id]}
                placeholder={config.keys[provider.id]
                  ? "已设置，留空保留"
                  : "尚未设置"}
              />
            </div>
          {/each}
        </div>
      </div>

      <div class="border-base-300 flex items-center justify-between gap-3 border-t pt-4">
        <div>
          {#if notice}
            <p
              class={["text-sm", failed ? "text-error" : "text-success"]}
              role="status"
            >
              {notice}
            </p>
          {/if}
        </div>
        <button
          class="btn btn-primary btn-sm"
          disabled={saving || !chat || !memory}
        >
          {saving ? "保存中" : "保存设置"}
        </button>
      </div>
    {:else if notice}
      <div class="flex items-center justify-between gap-3">
        <p class="text-error text-sm" role="alert">{notice}</p>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          aria-label="重新加载模型设置"
          onclick={load}
        >
          重试
        </button>
      </div>
    {:else}
      <div class="flex justify-center py-6">
        <span
          class="loading loading-spinner loading-sm"
          aria-label="加载模型设置"
        ></span>
      </div>
    {/if}
  </form>
</section>
