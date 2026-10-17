import { createSubscriber } from "svelte/reactivity";

/** A minute-resolution clock that only ticks while something reads it. */
export const clock = (() => {
  const subscribe = createSubscriber((update) => {
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  });
  return {
    get now() {
      subscribe();
      return Date.now();
    },
  };
})();
