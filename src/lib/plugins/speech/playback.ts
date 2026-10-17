import { fromPromise } from "xstate";
import { abortable } from "#lib/app/cancellation.js";
import { speechText } from "#lib/shared/speech.js";

type PlaybackInput = {
  markdown: string;
  openAudio(signal: AbortSignal): Promise<AudioContext>;
};

/** One actor owns synthesis, queued PCM and cleanup until the last sample has played. */
export const playback = fromPromise<void, PlaybackInput>(async ({ input, signal }) => {
  const sources = new Set<AudioBufferSourceNode>();
  let requestId: string | undefined;
  let next = 0;
  let drained: (() => void) | undefined;
  const cleanup = () => {
    if (requestId) {
      void fetch("/api/speech/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
        keepalive: true,
      }).catch(() => {});
      requestId = undefined;
    }
    for (const source of sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  try {
    const text = await abortable(speechText(input.markdown), signal);
    if (!text) throw new Error("这条消息没有可播报的正文。");
    const audio = await input.openAudio(signal);
    signal.throwIfAborted();
    for (const chunk of text.match(/[\s\S]{1,500}/gu) ?? []) {
      signal.throwIfAborted();
      requestId = crypto.randomUUID();
      const response = await abortable(
        fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, text: chunk }),
          signal,
        }),
        signal,
        (late) => {
          void late.body?.cancel().catch(() => {});
        },
      );
      if (!response.ok || !response.body) {
        await abortable(response.body?.cancel() ?? Promise.resolve(), signal).catch(() => {});
        throw new Error("暂时无法播放语音，请稍后再试。");
      }
      const reader = response.body.getReader();
      let carry: number | undefined;
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await abortable(reader.read(), signal);
          signal.throwIfAborted();
          if (done) break;
          let bytes = value;
          if (carry !== undefined) {
            bytes = new Uint8Array(value.length + 1);
            bytes[0] = carry;
            bytes.set(value, 1);
          }
          carry = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
          const length = Math.floor(bytes.length / 2);
          if (!length) continue;
          const buffer = audio.createBuffer(1, length, 24000);
          const samples = buffer.getChannelData(0);
          const view = new DataView(bytes.buffer, bytes.byteOffset, length * 2);
          for (let i = 0; i < length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
          const source = audio.createBufferSource();
          source.buffer = buffer;
          source.connect(audio.destination);
          source.onended = () => {
            source.disconnect();
            sources.delete(source);
            if (!sources.size) drained?.();
          };
          next = Math.max(next, audio.currentTime + 0.04);
          source.start(next);
          sources.add(source);
          next += buffer.duration;
        }
        if (carry !== undefined) throw new Error("语音数据不完整，请重新播放。");
      } finally {
        await abortable(reader.cancel(), signal).catch(() => {});
        reader.releaseLock();
      }
      requestId = undefined;
    }
    if (sources.size)
      await abortable(
        new Promise<void>((resolve) => {
          drained = resolve;
        }),
        signal,
      );
  } finally {
    signal.removeEventListener("abort", cleanup);
    cleanup();
  }
});
