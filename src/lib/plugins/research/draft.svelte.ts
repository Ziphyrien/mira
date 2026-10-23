import { onMount } from "svelte";
import { ResearchDraft, type DraftOptions } from "./drafts";

/** Bind a form's local state to a durable draft without making IndexedDB part of its input path. */
export function persistResearchDraft<T extends Record<string, unknown>>(
  options: DraftOptions<T> & { read: () => T; enabled?: () => boolean },
) {
  let buffer: ResearchDraft<T> | undefined;
  let restored = $state(false);
  const initial = $state.snapshot(options.initial) as T;
  const settings = {
    ...options,
    initial,
    restore: (value: T) => {
      restored = true;
      options.restore(value);
    },
  };
  onMount(() => {
    if (options.enabled?.() !== false) buffer = new ResearchDraft(settings);
    return () => buffer?.dispose();
  });
  $effect(() => {
    const value = $state.snapshot(options.read()) as T;
    const enabled = options.enabled?.() ?? true;
    if (enabled) buffer?.update(value);
  });
  return {
    get restored() {
      return restored;
    },
    clear: () => buffer?.clear() ?? Promise.resolve(),
    flush: () => buffer?.flush() ?? Promise.resolve(),
    discard: () => {
      void buffer?.clear();
      buffer?.dispose();
      options.restore(structuredClone(initial));
      restored = false;
      buffer = new ResearchDraft(settings);
    },
  };
}
