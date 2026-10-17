import type { SpeechPreferences } from "#lib/contracts/index.js";
export class SpeechState {
  preferences = $state.raw<SpeechPreferences>();
  enabled = $state(false);
  dictating = $state(false);
  error = $state("");
  #disposed = false;
  report(error: string) {
    if (!this.#disposed) this.error = error;
  }
  run(work: Promise<unknown>) {
    void work.catch((error: unknown) =>
      this.report(error instanceof Error ? error.message : "暂时无法播放语音。"),
    );
  }
  dispose() {
    this.#disposed = true;
  }
  constructor(preferences: SpeechPreferences, enabled: boolean) {
    this.preferences = preferences;
    this.enabled = enabled;
  }
}
