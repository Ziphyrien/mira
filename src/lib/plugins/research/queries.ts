import { queryOptions, type QueryClient } from "@tanstack/svelte-query";
import { researchRequest } from "./client";

export function researchQuery<T>(path: string) {
  return queryOptions({
    queryKey: [path],
    queryFn: ({ signal }) =>
      researchRequest<T>(
        path,
        undefined,
        "GET",
        AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      ),
  });
}
export async function invalidateResearch(client: QueryClient, id: string) {
  const filter = {
    predicate: (query: { queryKey: readonly unknown[] }) => {
      const path = String(query.queryKey[0]);
      return (
        path === "/api/research" ||
        path === "/api/research/" + id ||
        path.startsWith("/api/research/" + id + "/")
      );
    },
  };
  await client.cancelQueries(filter);
  await client.invalidateQueries(filter);
}
