import { isAdministrator } from "#lib/server/features/admin.js";
import type { PageServerLoad } from "./$types";

export const prerender = false;

export const load: PageServerLoad = async ({ cookies, depends, setHeaders }) => {
  depends("mira:admin");
  setHeaders({ "Cache-Control": "private, no-store", Vary: "Cookie" });
  return { authenticated: await isAdministrator(cookies) };
};
