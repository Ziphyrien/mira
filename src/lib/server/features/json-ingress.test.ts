import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Cookies, RequestEvent, RequestHandler } from "@sveltejs/kit";
import type { Profile, SpaceState } from "#lib/contracts/index.js";
import { handleKeyPost, handleOnboardPost, handleProfilePut } from "./account.js";
import { handleAdminSessionPost } from "./admin.js";

const rpc = vi.hoisted(() => ({
  directory: vi.fn(),
  has: vi.fn(),
  mint: vi.fn(),
  space: vi.fn(),
  onboard: vi.fn(),
  adminToken: vi.fn(),
}));
vi.mock("#lib/server/space.js", () => ({
  directory: rpc.directory,
  space: rpc.space,
  adminToken: rpc.adminToken,
}));

const profile: Profile = {
  name: "小明",
  focus: ["code"],
  style: "balanced",
  timezone: "Asia/Shanghai",
};
const account: SpaceState = {
  profile,
  speech: { voice: "冰糖", autoPlay: true },
  model: null,
  tts: false,
  messages: [],
  nextBefore: null,
  busy: false,
  generation: null,
};
const endpoints: {
  name: string;
  path: string;
  method: string;
  handler: RequestHandler;
  input: object;
  limit: number;
  uid: string | null;
  response: object;
  malformed: { status: number; body: { message: string } };
}[] = [
  {
    name: "key POST",
    path: "/api/key",
    method: "POST",
    handler: handleKeyPost,
    input: { key: "A".repeat(32) },
    limit: 1024,
    uid: null,
    response: { ok: true },
    malformed: { status: 400, body: { message: "密钥格式不正确" } },
  },
  {
    name: "onboard POST",
    path: "/api/onboard",
    method: "POST",
    handler: handleOnboardPost,
    input: profile,
    limit: 4096,
    uid: null,
    response: account,
    malformed: { status: 400, body: { message: "资料格式不正确" } },
  },
  {
    name: "profile PUT",
    path: "/api/profile",
    method: "PUT",
    handler: handleProfilePut,
    input: profile,
    limit: 4096,
    uid: "b".repeat(32),
    response: account,
    malformed: { status: 400, body: { message: "资料格式不正确" } },
  },
  {
    name: "admin session POST",
    path: "/api/admin/session",
    method: "POST",
    handler: handleAdminSessionPost,
    input: { token: "test-token" },
    limit: 2048,
    uid: null,
    response: { admin: true },
    malformed: { status: 401, body: { message: "令牌不正确" } },
  },
];

function event(endpoint: (typeof endpoints)[number], init: RequestInit): RequestEvent {
  const url = new URL(endpoint.path, "https://mira.test");
  const cookies = { set: vi.fn(), get: vi.fn(), delete: vi.fn() } as unknown as Cookies;
  return {
    url,
    cookies,
    request: new Request(url, { method: endpoint.method, ...init }),
    locals: { uid: endpoint.uid, key: null },
    getClientAddress: () => "192.0.2.1",
  } as RequestEvent;
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.directory.mockReturnValue({ has: rpc.has, mint: rpc.mint });
  rpc.has.mockResolvedValue(true);
  rpc.mint.mockResolvedValue(true);
  rpc.space.mockReturnValue({ onboard: rpc.onboard });
  rpc.onboard.mockResolvedValue(account);
  rpc.adminToken.mockReturnValue("test-token");
});

describe("bounded account and admin JSON ingress", () => {
  it.each(endpoints)(
    "rejects oversized Content-Length before body reads or side effects: $name",
    async (endpoint) => {
      const request = event(endpoint, {
        body: JSON.stringify(endpoint.input),
        headers: { "Content-Length": String(endpoint.limit + 1) },
      });
      try {
        await expect(endpoint.handler(request)).rejects.toMatchObject({ status: 413 });
        expect(request.request.bodyUsed).toBe(false);
        expect(rpc.directory).not.toHaveBeenCalled();
        expect(rpc.space).not.toHaveBeenCalled();
        expect(rpc.adminToken).not.toHaveBeenCalled();
        expect(request.cookies.set).not.toHaveBeenCalled();
      } finally {
        if (!request.request.body?.locked) await request.request.body?.cancel();
      }
    },
  );

  it.each(endpoints)(
    "cancels oversized streaming JSON before RPC, auth or quota side effects: $name",
    async (endpoint) => {
      // Valid JSON with an otherwise ignored field: the old handlers accepted it.
      const bytes = new TextEncoder().encode(
        JSON.stringify({ ...endpoint.input, padding: "x".repeat(endpoint.limit) }),
      );
      const chunks = [
        bytes.slice(0, endpoint.limit),
        bytes.slice(endpoint.limit, -1),
        bytes.slice(-1),
      ];
      let reads = 0;
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            controller.enqueue(chunks[reads++]);
            if (reads === chunks.length) controller.close();
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const init: RequestInit & { duplex: "half" } = { body, duplex: "half" };
      const request = event(endpoint, init);
      try {
        await expect(endpoint.handler(request)).rejects.toMatchObject({ status: 413 });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(reads).toBe(2);
        expect(rpc.directory).not.toHaveBeenCalled();
        expect(rpc.space).not.toHaveBeenCalled();
        expect(rpc.adminToken).not.toHaveBeenCalled();
        expect(request.cookies.set).not.toHaveBeenCalled();
      } finally {
        if (!request.request.body?.locked) await request.request.body?.cancel();
      }
    },
  );

  it.each(endpoints)("accepts valid small JSON: $name", async (endpoint) => {
    const response = await endpoint.handler(
      event(endpoint, { body: JSON.stringify(endpoint.input) }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(endpoint.response);
  });

  it.each(
    endpoints.flatMap((endpoint) => ["not JSON", "{}"].map((body) => ({ ...endpoint, body }))),
  )(
    "preserves malformed input behavior without persistence or cookies: $name ($body)",
    async (endpoint) => {
      const request = event(endpoint, { body: endpoint.body });
      await expect(endpoint.handler(request)).rejects.toMatchObject(endpoint.malformed);
      expect(rpc.directory).not.toHaveBeenCalled();
      expect(rpc.space).not.toHaveBeenCalled();
      expect(request.cookies.set).not.toHaveBeenCalled();
    },
  );
});
