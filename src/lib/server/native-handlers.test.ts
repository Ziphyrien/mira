import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { RequestEvent } from "@sveltejs/kit";
import { GET as me } from "../../routes/api/me/+server.js";
import { POST as chat } from "../../routes/api/chat/+server.js";
import { POST as stop } from "../../routes/api/chat/cancel/+server.js";
import { GET as memoryTree } from "../../routes/api/memory/tree/+server.js";
import { getSpaceState } from "./features/account.js";

const rpc = vi.hoisted(() => ({
  state: vi.fn(),
  chat: vi.fn(),
  stop: vi.fn(),
  memoryTree: vi.fn(),
  space: vi.fn(),
}));
vi.mock("#lib/server/space.js", () => ({
  space: rpc.space,
  directory: () => {
    throw new Error("Unexpected directory access");
  },
}));

function event<T extends RequestEvent>(path: string, uid: string | null, init?: RequestInit): T {
  const url = new URL(path, "https://mira.test");
  return { url, request: new Request(url, init), locals: { uid, key: null } } as T;
}

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.space.mockImplementation((uid: string) => {
    if (!uid) throw new Error("Anonymous requests must not access a space");
    return rpc;
  });
});

describe("native account reads", () => {
  it("returns complete anonymous state without persistence or shared mutable state", async () => {
    const response = await me(event("/api/me", null));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profile: null,
      model: null,
      speech: null,
      tts: false,
      messages: [],
      nextBefore: null,
      busy: false,
      generation: null,
    });
    const first = await getSpaceState(null);
    first.messages.push({ i: 1, kind: "user", text: "private", at: 1 });
    expect((await getSpaceState(null)).messages).toEqual([]);
    expect(rpc.space).not.toHaveBeenCalled();
  });

  it("reads the current request's space for both native loads and GET /api/me", async () => {
    rpc.state.mockImplementation(async (uid: string) => ({ owner: uid, generation: null }));
    const [loaded, response] = await Promise.all([
      getSpaceState("alice"),
      me(event("/api/me", "bob")),
    ]);
    expect(loaded).toEqual({ owner: "alice", generation: null });
    expect(await response.json()).toEqual({ owner: "bob", generation: null });
    expect(rpc.space.mock.calls).toEqual([["alice"], ["bob"]]);
  });
});

describe("native conversation transport", () => {
  const input = {
    prompt: { kind: "reply", replyId: 2 },
    requestId: "request_123",
    thinking: "high",
    model: { provider: "radius", modelId: "balanced" },
  };

  it("forwards a validated regeneration to its space and preserves streamed bytes and cancellation", async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode('{"type":"delta","text":"你好"}\n');
    rpc.chat.mockResolvedValue(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
        },
        cancel,
      }),
    );
    const response = await chat(event("/api/chat", "alice", post(input)));
    expect(rpc.space).toHaveBeenCalledWith("alice");
    expect(rpc.chat).toHaveBeenCalledWith("alice", input);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(bytes);
    await reader.cancel("disconnected");
    expect(cancel).toHaveBeenCalledWith("disconnected");
  });

  it("authenticates before reading the request body or accessing persistence", async () => {
    await expect(
      chat(event("/api/chat", null, { method: "POST", body: "not JSON" })),
    ).rejects.toMatchObject({ status: 401 });
    expect(rpc.space).not.toHaveBeenCalled();
  });

  it.each([
    "not JSON",
    JSON.stringify({ ...input, model: { ...input.model, name: "display metadata" } }),
    JSON.stringify({ ...input, unexpected: true }),
  ])("rejects malformed or non-wire chat data before RPC: %s", async (body) => {
    await expect(chat(event("/api/chat", "alice", { method: "POST", body }))).rejects.toMatchObject(
      { status: 400 },
    );
    expect(rpc.space).not.toHaveBeenCalled();
  });

  it("enforces the chat byte limit even without Content-Length", async () => {
    const body = JSON.stringify({ ...input, prompt: { kind: "message", text: "x".repeat(32768) } });
    await expect(chat(event("/api/chat", "alice", { method: "POST", body }))).rejects.toMatchObject(
      { status: 413 },
    );
    expect(rpc.space).not.toHaveBeenCalled();
  });

  it("forwards cancellation's requestId and returns the updated account state", async () => {
    rpc.stop.mockResolvedValue({ messages: [], busy: false, generation: null });
    const response = await stop(
      event("/api/chat/cancel", "alice", post({ requestId: "request_123" })),
    );
    expect(rpc.space).toHaveBeenCalledWith("alice");
    expect(rpc.stop).toHaveBeenCalledWith("request_123");
    expect(await response.json()).toEqual({ messages: [], busy: false, generation: null });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("native memory queries", () => {
  it.each(["id=&n=1", "id=0&n=1e2", "id=0x10&n=1", "id=0&n=9007199254740992"])(
    "rejects coercible or unsafe tree coordinates: %s",
    async (query) => {
      await expect(memoryTree(event(`/api/memory/tree?${query}`, "alice"))).rejects.toMatchObject({
        status: 404,
      });
      expect(rpc.space).not.toHaveBeenCalled();
    },
  );

  it("requires paired coordinates and preserves a valid zero-based coordinate", async () => {
    await expect(memoryTree(event("/api/memory/tree?id=0", "alice"))).rejects.toMatchObject({
      status: 400,
    });
    const tree = { total: 1, nodes: [], original: { kind: "user", text: "hello", at: 1 } };
    rpc.memoryTree.mockResolvedValue(tree);
    const response = await memoryTree(event("/api/memory/tree?id=0&n=1", "alice"));
    expect(rpc.memoryTree).toHaveBeenCalledWith(0, 1);
    expect(await response.json()).toEqual(tree);
  });
});
