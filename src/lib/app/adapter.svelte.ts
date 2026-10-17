import { onDestroy } from "svelte";

export interface Observable<T> {
  readonly snapshot: T;
  subscribe(callback: (val: T) => void): () => void;
}

/**
 * Svelte 5 rune bridge for readonly observable snapshots.
 * SSR-safe, subscribes on mount/call, unsubscribes on onDestroy.
 */
export function useSnapshot<T>(observable: Observable<T>): () => T {
  let current = $state.raw<T>(observable.snapshot);
  const unsubscribe = observable.subscribe((next) => {
    current = next;
  });
  onDestroy(() => {
    unsubscribe();
  });
  return () => current;
}
