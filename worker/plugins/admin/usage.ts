import type { Profile } from "../../../src/lib/contracts";
import type { SpaceScope } from "../../core/storage";
import type { GenerationUsage } from "../generation/ports";
import type { MemoryReader } from "../memory/ports";
import type { AccountIdentityPort } from "../account/api";
import { UsageLedger } from "./usage-store";
/** Usage and directory writes are fenced and joined before index removal on wipe. */
export class UsageProjection {
  private readonly ledger: UsageLedger;
  constructor(
    private readonly scope: SpaceScope,
    private readonly generation: GenerationUsage,
    private readonly memory: Pick<MemoryReader, "stats">,
    private readonly profile: () => Promise<Profile | null>,
    private readonly identity: AccountIdentityPort,
  ) {
    this.ledger = new UsageLedger(scope.storage.sql);
  }
  async cost() {
    return (await this.generation.cost()) + this.ledger.cost();
  }
  async touch() {
    const uid = this.identity.uid();
    if (!uid) return;
    const cost = await this.cost(),
      profile = await this.profile();
    this.scope.assert();
    await this.scope.track(
      this.scope.directory.touch({
        id: uid,
        name: profile?.name ?? "",
        created: this.identity.created(),
        messages: this.memory.stats().messages,
        cost,
      }),
    );
  }
}
