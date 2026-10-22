import { DurableObject } from "cloudflare:workers";
import { openDirectory } from "./core/directory";
import type { StudyListing } from "../src/lib/contracts/research";
import type { SpaceSummary } from "../src/lib/contracts";
/** Platform adapter only. Index and private model settings are separate feature capabilities. */
export class Directory extends DurableObject<Env> {
  private runtime?: ReturnType<typeof openDirectory>;
  private ready() {
    if (!this.runtime) {
      const opening = openDirectory(this.ctx.storage.sql).catch((error: unknown) => {
        if (this.runtime === opening) this.runtime = undefined;
        throw error;
      });
      this.runtime = opening;
    }
    return this.runtime;
  }
  async researchList() {
    return (await this.ready()).research.list(null);
  }
  async researchAdd(entry: StudyListing) {
    return (await this.ready()).research.add(entry);
  }
  async researchShare(id: string) {
    return (await this.ready()).research.share(id);
  }
  async researchResolve(code: string) {
    return (await this.ready()).research.resolve(code);
  }
  async researchRemove(id: string) {
    return (await this.ready()).research.remove(id);
  }
  async aiConfiguration() {
    return (await this.ready()).models.configuration(null);
  }
  async aiAdmin() {
    return (await this.ready()).models.admin(null);
  }
  async chatModel() {
    return (await this.ready()).models.chatModel(null);
  }
  async updateAi(input: unknown) {
    return (await this.ready()).models.save(input);
  }
  async touch(row: Omit<SpaceSummary, "seen">) {
    return (await this.ready()).index.touch(row);
  }
  async has(id: string) {
    return (await this.ready()).index.has(id);
  }
  async mint(ipDay: string) {
    return (await this.ready()).index.mint(ipDay);
  }
  async list(query: string, offset: number) {
    return (await this.ready()).index.list({ query, offset });
  }
  async remove(id: string) {
    return (await this.ready()).index.remove(id);
  }
}
