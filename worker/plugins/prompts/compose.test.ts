import { describe, it, expect } from "vite-plus/test";
import { composePrompt } from "./compose";
import type { ModelChoice, Profile } from "../../../src/lib/contracts";

const profile: Profile = { name: "Example", focus: [], style: "brief", timezone: "UTC" };
const models = {
  chat: { provider: "radius", modelId: "deepseek-flash" },
  memory: { provider: "deepseek", modelId: "deepseek-flash" },
} satisfies { chat: ModelChoice; memory: ModelChoice };

describe("prompt role contracts", () => {
  // Same-provider mode selection and persisted identities are covered at the actual Radius wire boundary.
  it("keeps identical model IDs isolated across providers", () => {
    const turn = composePrompt({ purpose: "turn", models }, profile);
    const compact = composePrompt({ purpose: "compaction", models });
    expect(turn.mode).toBe("separate");
    expect(compact.mode).toBe("separate");
    expect(turn.system).not.toContain("# Compactions");
    expect(compact.tools).toEqual([]);
  });
  it("keeps independent compaction insensitive to chat profile changes", () => {
    const compact = composePrompt({ purpose: "compaction", models });
    expect(
      composePrompt(
        { purpose: "compaction", models },
        { ...profile, name: "Changed", style: "detailed", timezone: "Asia/Shanghai" },
      ),
    ).toEqual(compact);
  });
});
