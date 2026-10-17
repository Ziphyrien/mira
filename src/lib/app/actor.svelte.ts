import { onMount } from "svelte";
import { createActor, type AnyActorLogic, type SnapshotFrom } from "xstate";

/** The component owns the actor; work starts only after mounting in the browser. */
export function useActor<T extends AnyActorLogic>(logic: T) {
  const actor = createActor(logic);
  let snapshot = $state.raw(actor.getSnapshot() as SnapshotFrom<T>);
  onMount(() => {
    const sub = actor.subscribe((value) => {
      snapshot = value as SnapshotFrom<T>;
    });
    actor.start();
    return () => {
      sub.unsubscribe();
      actor.stop();
    };
  });
  return {
    get snapshot() {
      return snapshot;
    },
    send: actor.send.bind(actor),
  };
}
