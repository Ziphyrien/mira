import { getSpaceState } from "#lib/server/features/account.js";
import type { PageServerLoad } from "./$types";

export const prerender = false;

export const load: PageServerLoad = async ({ locals, depends, setHeaders }) => {
  depends("mira:space");
  setHeaders({ "Cache-Control": "private, no-store", Vary: "Cookie" });
  return { space: await getSpaceState(locals.uid) };
};
