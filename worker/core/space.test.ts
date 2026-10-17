import { describe, it, expect, vi } from "vite-plus/test";
import { createModelRegistry, describeModel } from "../plugins/models/catalog";
import { SpaceScope, type DirectoryPort } from "./storage";
import { openSpace } from "./space";
import { createTestScopePlatform } from "../testing/node-sqlite";
import { DEFAULT_SPEECH } from "../../src/lib/contracts";

function createMockDirectory(): DirectoryPort {
  return {
    aiConfiguration: async () => ({ keys: {}, chat: null, memory: null }),
    chatModel: async () => null,
    touch: async () => {},
    remove: async () => {},
  };
}

const validProfileAlice = {
  name: "Alice",
  focus: ["code" as const],
  style: "balanced" as const,
  timezone: "UTC",
};

const validProfileBob = {
  name: "Bob",
  focus: ["code" as const],
  style: "balanced" as const,
  timezone: "UTC",
};

describe("openSpace composition and lifecycle", () => {
  it("initializes space, manages speech and account state, and queries history", async () => {
    const platform = createTestScopePlatform();
    const directory = createMockDirectory();
    const scope = new SpaceScope(platform, directory);

    const runtime = await openSpace(scope, () => {});
    try {
      // Speech preferences null before profile is configured
      expect(await runtime.speech.get(null)).toBeNull();

      // Configure account
      const configuredState = await runtime.account.configure({
        uid: "user-1",
        input: validProfileAlice,
      });
      expect(configuredState.profile?.name).toBe("Alice");

      // Speech preferences now resolve with default speech
      const initialSpeech = await runtime.speech.get(null);
      expect(initialSpeech).toEqual(DEFAULT_SPEECH);

      // Update speech preferences
      const updatedSpeech = await runtime.speech.set({ voice: "Mia", autoPlay: true });
      expect(updatedSpeech.voice).toBe("Mia");
      expect(updatedSpeech.autoPlay).toBe(true);

      // Verify history queries on empty log
      const hist = await runtime.history.page({});
      expect(hist.messages).toHaveLength(0);
      const tree = await runtime.history.tree({});
      expect(tree).not.toBeNull();
      expect(tree?.total).toBe(1);
    } finally {
      await runtime.close();
    }
  });

  it("proves profile, speech, and table continuity across space reopen", async () => {
    const platform = createTestScopePlatform();
    const directory = createMockDirectory();

    // First session: configure state
    const scope1 = new SpaceScope(platform, directory);
    const runtime1 = await openSpace(scope1, () => {});
    await runtime1.account.configure({
      uid: "user-persist",
      input: validProfileBob,
    });
    await runtime1.speech.set({ voice: "Chloe", autoPlay: false });
    await runtime1.close();

    // Second session on same underlying SQLite DB
    const scope2 = new SpaceScope(platform, directory);
    const runtime2 = await openSpace(scope2, () => {});
    try {
      const state = await runtime2.account.state("user-persist");
      expect(state.profile?.name).toBe("Bob");
      expect(state.profile?.style).toBe("balanced");
      expect(state.profile?.timezone).toBe("UTC");

      const speech = await runtime2.speech.get(null);
      expect(speech?.voice).toBe("Chloe");
      expect(speech?.autoPlay).toBe(false);
    } finally {
      await runtime2.close();
    }
  });

  it("handles chat with no model keys cleanly without appending input to history", async () => {
    const platform = createTestScopePlatform();
    const directory = createMockDirectory();
    const scope = new SpaceScope(platform, directory);

    const runtime = await openSpace(scope, () => {});
    try {
      await runtime.account.configure({
        uid: "user-1",
        input: validProfileAlice,
      });

      const stream = await runtime.conversation.chat({
        uid: "user-1",
        input: {
          requestId: "req-unconfigured",
          prompt: { kind: "message", text: "Hello" },
          thinking: "off",
          model: { provider: "deepseek", modelId: "deepseek-chat" },
        },
      });

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const events: Record<string, unknown>[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            events.push(JSON.parse(trimmed) as Record<string, unknown>);
          }
        }
      }
      if (buffer.trim()) {
        events.push(JSON.parse(buffer.trim()) as Record<string, unknown>);
      }

      expect(events).toContainEqual({ type: "error", message: "暂时无法对话，请稍后再试。" });

      const history = await runtime.history.page({});
      expect(history.messages).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  });

  it("fences resources after runtime.close so late SQL cannot recreate state", async () => {
    const platform = createTestScopePlatform();
    const directory = createMockDirectory();
    const scope = new SpaceScope(platform, directory);

    const runtime = await openSpace(scope, () => {});
    await runtime.close();

    expect(scope.alive).toBe(false);
    expect(() => scope.assert()).toThrow("Space runtime was replaced");
    expect(() => scope.storage.sql.exec("SELECT 1")).toThrow("Space runtime was replaced");
    expect(() => scope.storage.transactionSync(() => {})).toThrow("Space runtime was replaced");
  });

  it("cleans opened dependencies and prevents stale writes when directory config rejects", async () => {
    const platform = createTestScopePlatform();
    const rejectingDirectory: DirectoryPort = {
      aiConfiguration: async () => {
        throw new Error("Directory configuration unreachable");
      },
      chatModel: async () => null,
      touch: async () => {},
      remove: async () => {},
    };
    const scope = new SpaceScope(platform, rejectingDirectory);

    await expect(openSpace(scope, () => {})).rejects.toThrow("Directory configuration unreachable");
    expect(scope.alive).toBe(false);
    expect(() => scope.assert()).toThrow("Space runtime was replaced");
  });

  it("persists cancel marker before admission and prevents extra history", async () => {
    const platform = createTestScopePlatform();
    const choice = { provider: "deepseek" as const, modelId: "deepseek-flash" };
    const info = describeModel(createModelRegistry({ deepseek: "synthetic-key" }), choice);
    const provider = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Cancelled input reached provider"));
    const directory: DirectoryPort = {
      ...createMockDirectory(),
      aiConfiguration: async () => ({
        keys: { deepseek: "synthetic-key" },
        chat: choice,
        memory: null,
      }),
      chatModel: async () => info,
    };
    const scope = new SpaceScope(platform, directory);

    const runtime = await openSpace(scope, () => {});
    try {
      await runtime.account.configure({
        uid: "user-cancel",
        input: validProfileAlice,
      });

      const requestId = "req-cancelled-1";
      await runtime.conversation.stop(requestId);

      // The cancel marker is recorded
      expect(
        platform.storage.sql
          .exec<{ v: string }>(
            "SELECT v FROM mira_kv WHERE k = ?",
            `cancelled-request:${requestId}`,
          )
          .one().v,
      ).toBe("1");

      // Follow stop with the same VALID chat input
      const stream = await runtime.conversation.chat({
        uid: "user-cancel",
        input: {
          requestId,
          prompt: { kind: "message", text: "Hello after stop" },
          thinking: "off",
          model: choice,
        },
      });

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const events: Record<string, unknown>[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            events.push(JSON.parse(trimmed) as Record<string, unknown>);
          }
        }
      }
      if (buffer.trim()) {
        events.push(JSON.parse(buffer.trim()) as Record<string, unknown>);
      }

      expect(events.filter((event) => event.type === "stopped")).toHaveLength(1);
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(events.some((event) => event.type === "model")).toBe(false);

      // Cancellation wins with a valid model: no provider request or history admission.
      expect(provider).not.toHaveBeenCalled();
      const hist = await runtime.history.page({});
      expect(hist.messages).toHaveLength(0);
    } finally {
      await runtime.close();
      provider.mockRestore();
      platform.db.close();
    }
  });
});
