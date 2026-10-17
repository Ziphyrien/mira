import { createActor, toPromise, type ActorRefFrom, type SnapshotFrom } from "xstate";
import { abortable, requestSignal } from "#lib/app/cancellation.js";
import { playback } from "./playback.js";

/** Chord owns this player; each XState actor owns one complete playback. */
export class SpeechPlayer {
  private snapshot = $state.raw<SnapshotFrom<typeof playback>>();
  private actor?: ActorRefFrom<typeof playback>;
  private audio?: AudioContext;
  private lifetime = new AbortController();

  get active() {
    return this.snapshot?.status === "active";
  }
  get error() {
    if (this.snapshot?.status !== "error") return "";
    const error = this.snapshot.error;
    if (error instanceof Error) {
      return error.name === "NotAllowedError" ? "点击播放以启用声音。" : error.message;
    }
    return "暂时无法播放语音。";
  }

  async unlock(caller?: AbortSignal) {
    const signal = requestSignal(this.lifetime.signal, caller);
    signal.throwIfAborted();
    this.audio ??= new AudioContext({ sampleRate: 24000 });
    await abortable(this.audio.resume(), signal);
  }
  stop() {
    this.actor?.stop();
  }

  async play(markdown: string, caller?: AbortSignal) {
    if (this.lifetime.signal.aborted || caller?.aborted) return;
    this.stop();
    const actor = createActor(playback, {
      input: {
        markdown,
        openAudio: async (signal) => {
          await this.unlock(signal);
          return this.audio!;
        },
      },
    });
    this.actor = actor;
    const update = () => {
      this.snapshot = actor.getSnapshot();
    };
    actor.subscribe({ next: update, error: update, complete: update });
    const stop = () => actor.stop();
    caller?.addEventListener("abort", stop, { once: true });
    const done = toPromise(actor)
      .catch(() => {})
      .finally(() => caller?.removeEventListener("abort", stop));
    actor.start();
    await done;
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.stop();
    this.lifetime.abort();
    if (this.audio && this.audio.state !== "closed") void this.audio.close().catch(() => {});
  }
}
