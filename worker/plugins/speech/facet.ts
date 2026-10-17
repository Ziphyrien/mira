import { defineFacet, type Facet } from "@earendil-works/chord";
import { speechText } from "../../../src/lib/shared/speech";
import type { SpaceScope } from "../../core/storage";
import { SpeechSettings } from "../profile/api";
import { SpeechSynthesis, type SpeechResult } from "./api";
import { createSpeechStream } from "./stream";

export function speechFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.speech",
    ...defineFacet(
      (api) => {
        api.serve(SpeechSynthesis, (_input, _principal, self) => {
          const settings = self.get(SpeechSettings, {});
          const active = new Map<string, AbortController>();
          // Keep a bounded receipt when cancellation arrives before synthesis setup finishes.
          const cancelled = new Map<string, number>();
          const prune = () => {
            for (const [id, at] of cancelled) if (Date.now() - at > 120_000) cancelled.delete(id);
          };
          return {
            synthesize: async ({ requestId, text: input }, ctx): Promise<SpeechResult> => {
              const preferences = await settings.get(null, ctx);
              if (!preferences) return { ok: false, status: 401, message: "请先进入你的账户" };
              const text = await speechText(input);
              if (!text) return { ok: false, status: 400, message: "这条消息没有可播报的正文。" };
              const key = (await scope.directory.aiConfiguration()).keys.mimo;
              scope.assert();
              if (!key) return { ok: false, status: 503, message: "语音播报暂时不可用" };
              prune();
              if (cancelled.has(requestId) || active.has(requestId))
                return { ok: false, status: 409, message: "这段语音请求已停止或正在处理。" };
              const controller = new AbortController();
              active.set(requestId, controller);
              const { audio, completion } = createSpeechStream(
                text,
                preferences.voice,
                key,
                AbortSignal.any([scope.signal, controller.signal]),
              );
              scope.background(
                completion.finally(() => active.delete(requestId)),
                "speech.stream",
              );
              return { ok: true, audio };
            },
            cancel: (requestId) => {
              prune();
              cancelled.delete(requestId);
              if (cancelled.size >= 128) cancelled.delete(cancelled.keys().next().value!);
              cancelled.set(requestId, Date.now());
              active.get(requestId)?.abort();
            },
          };
        });
      },
      { uses: [SpeechSettings] },
    ),
  };
}
