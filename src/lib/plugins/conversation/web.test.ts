import { createHost } from "@earendil-works/chord";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChatInput, Profile, SpaceState } from "#lib/contracts/index.js";
import { AppLifetime } from "#lib/app/lifecycle.js";
import { Conversation } from "./api.js";
import { conversationWeb } from "./web.js";
import { historyWeb } from "#lib/plugins/history/web.js";
import { imagesWeb } from "#lib/plugins/images/web.js";
import { modelsWeb } from "#lib/plugins/models/web.js";
import { speechWeb } from "#lib/plugins/speech/web.js";
import { accountWeb } from "#lib/plugins/account/web.js";
import { draftsWeb } from "#lib/plugins/drafts/web.js";

// The host exercises production facets/resources; registered UI is never mounted here.
vi.mock("#lib/plugins/conversation/Composer.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/models/ThinkingControl.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/speech/SpeechInput.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/speech/SpeechControl.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/speech/SpeechSettings.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/account/SettingsControl.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/account/AccountSettings.svelte", () => ({ default: () => {} }));
vi.mock("#lib/app/SettingsDialog.svelte", () => ({ default: () => {} }));

afterEach(() => vi.unstubAllGlobals());

const profile: Profile = { name: "Test", focus: [], style: "balanced", timezone: "UTC" };
const input: ChatInput = {
  prompt: { kind: "message", text: "continue" },
  requestId: "resume-request-12345",
  thinking: "high",
  model: { provider: "radius", modelId: "balanced" },
};
const idle: Extract<SpaceState, { profile: Profile }> = {
  profile,
  speech: { voice: "冰糖", autoPlay: false },
  tts: false,
  busy: false,
  generation: null,
  messages: [],
  nextBefore: null,
  model: {
    ...input.model,
    name: "Test",
    thinking: ["high"],
    highest: "high",
    supportsImages: true,
  },
};

async function createApp() {
  const lifetime = new AppLifetime();
  const host = createHost({ name: "test.conversation.web", self: null });
  await host.load([
    draftsWeb,
    historyWeb(idle),
    imagesWeb(idle.model),
    modelsWeb(idle.model),
    speechWeb(idle.speech, false),
    accountWeb(profile, () => {}),
    conversationWeb({ initial: idle, lifetime, showChat: () => {} }),
  ]);
  const conversation = await host.get(Conversation, {});
  return { host, lifetime, conversation };
}

describe("conversation facet reload", () => {
  it("resumes a running server generation with its request identity, permits Stop, and restores failed/idle state", async () => {
    let state: SpaceState = { ...idle, busy: true, generation: { status: "running", input } };
    const requests: ChatInput[] = [];
    const cancellations: unknown[] = [];
    let streamCancelled = false;
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      if (path === "/api/me") return Response.json(state);
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
      if (path === "/api/chat") {
        requests.push(JSON.parse(init.body) as ChatInput);
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              streamCancelled = true;
            },
          }),
        );
      }
      if (path === "/api/chat/cancel") {
        cancellations.push(JSON.parse(init.body));
        return Response.json({ messages: [] });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const app = await createApp();
    try {
      await app.conversation.reload(null);
      expect(app.conversation.view!.snapshot.matches("streaming")).toBe(true);
      await vi.waitFor(() => expect(requests).toEqual([input]));
      await app.conversation.stop(null);
      expect(cancellations).toEqual([{ requestId: input.requestId }]);
      expect(app.conversation.view!.snapshot.matches("idle")).toBe(true);
      expect(app.conversation.view!.snapshot.serverBusy).toBe(false);
      expect(streamCancelled).toBe(true);
      state = { ...idle, generation: { status: "failed", input, error: "retry this generation" } };
      await app.conversation.reload(null);
      expect(app.conversation.view!.snapshot.matches("failed")).toBe(true);
      expect(app.conversation.view!.snapshot.context.request?.requestId).toBe(input.requestId);
      expect(app.conversation.view!.snapshot.context.error).toBe("retry this generation");
      state = idle;
      await app.conversation.reload(null);
      expect(app.conversation.view!.snapshot.matches("idle")).toBe(true);
      expect(app.conversation.view!.snapshot.context.request).toBeNull();
      expect(requests).toHaveLength(1);
    } finally {
      app.lifetime.dispose();
      await app.host.close();
    }
  });
});
