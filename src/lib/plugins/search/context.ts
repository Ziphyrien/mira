import { createContext } from "svelte";
import type { SearchPort } from "#lib/plugins/search/api.js";
export const [getSearch, setSearch] = createContext<SearchPort>();
