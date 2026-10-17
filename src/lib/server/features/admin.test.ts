import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Cookies, RequestEvent } from "@sveltejs/kit";
import { GET as spaces } from "../../../routes/api/admin/spaces/+server.js";
import {
  GET as session,
  POST as login,
  DELETE as logout,
} from "../../../routes/api/admin/session/+server.js";
import { isAdministrator } from "./admin.js";
import { ADMIN_COOKIE, adminValue } from "../identity.js";

const bindings = vi.hoisted(() => ({ token: "test-token", list: vi.fn() }));
vi.mock("#lib/server/space.js", () => ({
  adminToken: () => bindings.token,
  directory: () => ({ list: bindings.list }),
  space: () => {
    throw new Error("Unexpected space access");
  },
}));

function cookies(value?: string): Cookies {
  return {
    get: () => value,
    getAll: () => (value ? [{ name: ADMIN_COOKIE, value }] : []),
    set: vi.fn(),
    delete: vi.fn(),
    serialize: () => "",
    parse: () => ({ name: "unused", value: "" }),
  };
}
function event<T extends RequestEvent>(
  jar: Cookies,
  path = "/api/admin/session",
  init?: RequestInit,
): T {
  const url = new URL(path, "https://mira.test");
  return { cookies: jar, url, request: new Request(url, init) } as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  bindings.token = "test-token";
});

describe("native admin authentication", () => {
  it("rejects unauthorized administration before directory access", async () => {
    await expect(spaces(event(cookies(), "/api/admin/spaces"))).rejects.toMatchObject({
      status: 401,
    });
    expect(bindings.list).not.toHaveBeenCalled();
  });

  it("returns only an authentication boolean and reflects token rotation per request", async () => {
    const jar = cookies(await adminValue("test-token"));
    expect(await isAdministrator(jar)).toBe(true);
    expect(await (await session(event(jar))).json()).toEqual({ admin: true });
    bindings.token = "rotated-token";
    expect(await isAdministrator(jar)).toBe(false);
    expect(await (await session(event(jar))).json()).toEqual({ admin: false });
    expect(await isAdministrator(cookies())).toBe(false);
  });

  it("creates and clears a secure session usable by SSR", async () => {
    const jar = cookies();
    const response = await login(
      event(jar, "/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ token: "test-token" }),
      }),
    );
    expect(await response.json()).toEqual({ admin: true });
    expect(jar.set).toHaveBeenCalledWith(ADMIN_COOKIE, await adminValue("test-token"), {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 12,
    });
    vi.mocked(jar.delete).mockClear();
    expect(await (await logout(event(jar))).json()).toEqual({ admin: false });
    expect(jar.delete).toHaveBeenCalledWith(ADMIN_COOKIE, { path: "/" });
  });

  it.each(["-1", "1.5", "Infinity", "9007199254740992", ""])(
    "rejects an invalid pagination offset before directory access: %s",
    async (offset) => {
      const jar = cookies(await adminValue("test-token"));
      await expect(spaces(event(jar, `/api/admin/spaces?offset=${offset}`))).rejects.toMatchObject({
        status: 400,
      });
      expect(bindings.list).not.toHaveBeenCalled();
    },
  );

  it("passes valid pagination and a bounded search query to the directory", async () => {
    const jar = cookies(await adminValue("test-token"));
    bindings.list.mockResolvedValue({ items: [], total: 0, messages: 0, cost: 0 });
    const response = await spaces(event(jar, `/api/admin/spaces?offset=50&q=${"x".repeat(80)}`));
    expect(bindings.list).toHaveBeenCalledWith("x".repeat(64), 50);
    expect(await response.json()).toEqual({ items: [], total: 0, messages: 0, cost: 0 });
  });
});
