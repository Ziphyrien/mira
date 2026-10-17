import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Cookies, RequestEvent } from "@sveltejs/kit";
import { handle } from "./hooks.server.js";
import { KEY_COOKIE, uidOf } from "#lib/server/identity.js";
import { normalizeKey } from "#lib/shared/identity.js";
import type { Profile, SpaceState } from "#lib/contracts/index.js";
import {
  getSpaceState,
  handleMeGet,
  handleOnboardPost,
  handleProfilePut,
} from "#lib/server/features/account.js";

const rpc = vi.hoisted(() => ({
  has: vi.fn(),
  mint: vi.fn(),
  space: vi.fn(),
  onboard: vi.fn(),
  state: vi.fn(),
}));
vi.mock("#lib/server/space.js", () => ({
  directory: () => ({ has: rpc.has, mint: rpc.mint }),
  space: rpc.space,
}));
const registeredKey = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const forgedKey = "A".repeat(32);
const profile: Profile = { name: "Alice", focus: ["code"], style: "balanced", timezone: "UTC" };
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

beforeEach(async () => {
  vi.resetAllMocks();
  const uid = await uidOf(registeredKey);
  rpc.has.mockImplementation(async (id: string) => id === uid);
  rpc.mint.mockResolvedValue(false);
  rpc.space.mockReturnValue({ onboard: rpc.onboard, state: rpc.state });
  rpc.onboard.mockResolvedValue(account);
  rpc.state.mockResolvedValue(account);
});

function event(path: string, key?: string, init?: RequestInit): RequestEvent {
  const url = new URL(path, "https://mira.test");
  const cookies = {
    get: (name: string) => (name === KEY_COOKIE ? key : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  } as unknown as Cookies;
  return {
    url,
    request: new Request(url, init),
    cookies,
    locals: { key: null, uid: null },
    getClientAddress: () => "192.0.2.1",
  } as RequestEvent;
}

describe("account admission through the native hook", () => {
  const identities = [
    { identity: "anonymous", key: undefined },
    { identity: "forged", key: forgedKey },
    { identity: "registered", key: registeredKey },
  ];
  const mutations = [
    { method: "POST", path: "/api/onboard", handler: handleOnboardPost },
    { method: "PUT", path: "/api/profile", handler: handleProfilePut },
  ];
  it.each(
    identities.flatMap((identity) =>
      mutations.flatMap((mutation) =>
        [false, true].map((mint) => ({ ...identity, ...mutation, mint })),
      ),
    ),
  )(
    "enforces admission for $identity $method $path with mint=$mint",
    async ({ identity, key, method, path, handler, mint }) => {
      rpc.mint.mockResolvedValue(mint);
      const request = event(path, key, { method, body: JSON.stringify(profile) });
      const pending = handle({ event: request, resolve: async (current) => handler(current) });
      const known = identity === "registered";
      let status = 200;
      if (!known && method === "PUT") status = 401;
      else if (!known && !mint) status = 429;
      if (status === 200) {
        const response = await pending;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(account);
        let uid = await uidOf(registeredKey);
        if (!known) {
          expect(request.cookies.set).toHaveBeenCalledTimes(1);
          const [name, issued] = vi.mocked(request.cookies.set).mock.calls[0];
          expect(name).toBe(KEY_COOKIE);
          expect(normalizeKey(issued)).toBe(issued);
          expect(issued).not.toBe(forgedKey);
          uid = await uidOf(issued);
        } else {
          expect(request.cookies.set).not.toHaveBeenCalled();
        }
        expect(rpc.space).toHaveBeenCalledExactlyOnceWith(uid);
        expect(rpc.onboard).toHaveBeenCalledExactlyOnceWith(uid, profile);
      } else {
        await expect(pending).rejects.toMatchObject({ status });
        expect(rpc.space).not.toHaveBeenCalled();
        expect(rpc.onboard).not.toHaveBeenCalled();
        expect(request.cookies.set).not.toHaveBeenCalled();
      }
      expect(rpc.mint).toHaveBeenCalledTimes(!known && method === "POST" ? 1 : 0);
      expect(request.locals).toEqual(
        known ? { key: registeredKey, uid: await uidOf(registeredKey) } : { key: null, uid: null },
      );
      if (key) expect(rpc.has).toHaveBeenCalledExactlyOnceWith(await uidOf(key));
      else expect(rpc.has).not.toHaveBeenCalled();
    },
  );

  it.each(
    identities.flatMap((identity) => ["/", "/api/me"].map((path) => ({ ...identity, path }))),
  )(
    "isolates $identity account reads at $path without opening unknown spaces",
    async ({ identity, key, path }) => {
      const response = await handle({
        event: event(path, key),
        resolve: async (current) =>
          path === "/api/me"
            ? handleMeGet(current)
            : Response.json(await getSpaceState(current.locals.uid)),
      });
      const state = await response.json();
      if (identity === "registered") {
        expect(state).toEqual(account);
        expect(rpc.state).toHaveBeenCalledExactlyOnceWith(await uidOf(registeredKey));
      } else {
        expect(state).toEqual({
          profile: null,
          speech: null,
          model: null,
          tts: false,
          messages: [],
          nextBefore: null,
          busy: false,
          generation: null,
        });
        expect(rpc.space).not.toHaveBeenCalled();
      }
      expect(rpc.mint).not.toHaveBeenCalled();
    },
  );
});

describe("native request hook", () => {
  it.each(["/", "/admin", "/api/me"])(
    "keeps private responses uncached while preserving streams and resolved headers: %s",
    async (path) => {
      const request = event(path);
      const bytes = new TextEncoder().encode("private response");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      const response = await handle({
        event: request,
        resolve: async () =>
          new Response(body, {
            headers: { "Cache-Control": "private, no-store", "X-Request": "preserved" },
          }),
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-request")).toBe("preserved");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(await response.text()).toBe("private response");
    },
  );

  it("keeps identity in each request's locals across overlapping renders", async () => {
    const key = registeredKey;
    const authenticated = event("/", key);
    const anonymous = event("/");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pending = handle({
      event: authenticated,
      resolve: async (request) => {
        entered.resolve();
        await release.promise;
        return Response.json(request.locals);
      },
    });
    await entered.promise;
    try {
      const other = await handle({
        event: anonymous,
        resolve: async (request) => Response.json(request.locals),
      });
      expect(await other.json()).toEqual({ key: null, uid: null });
    } finally {
      release.resolve();
    }
    expect(await (await pending).json()).toEqual({ key, uid: await uidOf(key) });
  });

  it("blocks cross-origin mutation before routing and protects the error response", async () => {
    const resolve = vi.fn(async () => new Response("unexpected"));
    const response = await handle({
      event: event("/api/chat", undefined, {
        method: "POST",
        headers: { Origin: "https://other.test" },
      }),
      resolve,
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(resolve).not.toHaveBeenCalled();
  });
});
