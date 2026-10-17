import type { Handle } from "@sveltejs/kit/hooks";
import { KEY_COOKIE, uidOf } from "#lib/server/identity.js";
import { normalizeKey } from "#lib/shared/identity.js";
import { directory } from "#lib/server/space.js";

export const handle: Handle = async ({ event, resolve }) => {
  const key = normalizeKey(event.cookies.get(KEY_COOKIE) ?? "");
  const uid = key ? await uidOf(key) : null;
  // A well-formed key is only an identity after its space has been admitted.
  const registered = uid !== null && (await directory().has(uid));
  event.locals.key = registered ? key : null;
  event.locals.uid = registered ? uid : null;
  const isApi = event.url.pathname.startsWith("/api/");

  let forbidden = false;
  if (isApi && event.request.method !== "GET") {
    const site = event.request.headers.get("sec-fetch-site");
    const origin = event.request.headers.get("origin");
    forbidden = Boolean(
      (site && site !== "same-origin") || (origin && origin !== event.url.origin),
    );
  }
  const response = forbidden ? new Response("Forbidden", { status: 403 }) : await resolve(event);
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  // Cover HTML and Kit data responses as well as API responses. Loads can also
  // set cache headers: copying the resolved response avoids setHeaders conflicts.
  if (
    isApi ||
    event.url.pathname === "/" ||
    event.url.pathname === "/admin" ||
    event.url.pathname.startsWith("/admin/")
  )
    headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
