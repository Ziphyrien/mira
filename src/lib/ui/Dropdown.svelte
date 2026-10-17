<script lang="ts" generics="Value extends string">
  import { Select } from "bits-ui";
  import { prefersReducedMotion } from "svelte/motion";
  import { scale } from "svelte/transition";

  type Option = { id: Value; label: string; group?: string; disabled?: boolean };
  const generatedId = $props.id();
  let {
    id = generatedId, label, value, options, onChange, disabled = false, required = false,
    placeholder = "请选择", prefix, variant = "field", placement = "bottom",
  }: {
    id?: string; label: string; value: Value; options: readonly Option[];
    onChange: (value: Value) => void; disabled?: boolean; required?: boolean;
    placeholder?: string; prefix?: string; variant?: "field" | "compact"; placement?: "top" | "bottom";
  } = $props();
  const items = $derived(options.map(option => ({ value: option.id, label: option.label, disabled: option.disabled })));
  const groups = $derived.by(() => {
    const result = new Map<string, Option[]>();
    for (const option of options) {
      const group = option.group ?? "";
      const entries = result.get(group) ?? [];
      entries.push(option);
      result.set(group, entries);
    }
    return [...result].map(([label, items]) => ({ label, items }));
  });
  function change(next: string) {
    const option = options.find(option => option.id === next);
    if (option) onChange(option.id);
  }
</script>

<Select.Root type="single" {value} onValueChange={change} {items} {disabled} {required} allowDeselect={false} loop>
  <Select.Trigger
    {id}
    class={["flex items-center text-left", variant === "compact" ? "btn btn-ghost btn-sm gap-1.5" : "select w-full justify-between gap-3 bg-none"]}
    aria-label={label}
    role="combobox"
    aria-controls={`${id}-options`}
  >
    {#if prefix}<span class="text-base-content/55 font-normal">{prefix}</span>{/if}
    <Select.Value class="truncate" {placeholder} />
    <span class="icon-[lucide--chevron-down] text-base-content/45 size-3.5 shrink-0" aria-hidden="true"></span>
  </Select.Trigger>
  <Select.Portal>
    <Select.Content id={`${id}-options`} forceMount side={placement} align="start" sideOffset={8} collisionPadding={8} aria-label={`${label}选项`}>
      {#snippet child({ props, wrapperProps, open })}
        {#if open}
          <!-- Bits UI copies the content z-index onto its positioning wrapper. -->
          <div {...wrapperProps}>
            <div
              {...props}
              class="z-[1100] border-base-300 bg-base-100 rounded-box overflow-y-auto overscroll-contain border p-1 shadow-lg outline-none"
              style:min-width={variant === "compact" ? "11rem" : "var(--bits-select-anchor-width)"}
              style:max-width="var(--bits-select-content-available-width)"
              style:max-height="min(20rem, var(--bits-select-content-available-height))"
              style:transform-origin="var(--bits-select-content-transform-origin)"
              transition:scale={{ duration: prefersReducedMotion.current ? 0 : 200, start: 0.95 }}
            >
              {#each groups as group (group.label)}
                <Select.Group aria-label={group.label || undefined}>
                  {#if group.label}<Select.GroupHeading class="menu-title px-3 py-2">{group.label}</Select.GroupHeading>{/if}
                  <ul class={["menu w-full flex-nowrap p-0", variant === "compact" && "menu-sm"]} role="presentation">
                    {#each group.items as option (option.id)}
                      <li role="presentation">
                        <Select.Item value={option.id} label={option.label} disabled={option.disabled}
                          class="flex items-center gap-3 data-highlighted:menu-focus aria-selected:menu-active">
                          {#snippet children({ selected })}
                            <span class="min-w-0 whitespace-normal text-left">{option.label}</span>
                            {#if selected}<span class="icon-[lucide--check] ml-auto size-4 shrink-0" aria-hidden="true"></span>{/if}
                          {/snippet}
                        </Select.Item>
                      </li>
                    {/each}
                  </ul>
                </Select.Group>
              {/each}
            </div>
          </div>
        {/if}
      {/snippet}
    </Select.Content>
  </Select.Portal>
</Select.Root>
