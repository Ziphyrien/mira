import { createContext } from "svelte";
import type { MemoryPort } from "#lib/plugins/memory/api.js";
export const [getMemory, setMemory] = createContext<MemoryPort>();
