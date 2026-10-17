import { MemoryBackup, type MemoryImportResult } from "../src/lib/contracts/memory-backup";
import { restoreMemoryBackup } from "./plugins/memory/api";
import { Images } from "./plugins/images/api";
import { DurableObject } from "cloudflare:workers";
import { openSpace, type SpaceRuntime } from "./core/space";
import { SpaceScope } from "./core/storage";
import { KeyValue } from "./core/kv";
import { AccountIdentity } from "./plugins/account/identity";
import { ConversationPersistence } from "./plugins/conversation/persistence";
/** Platform lifetime/RPC only; requests during reset or fatal replacement wait for the previous generation. */
export class Space extends DurableObject<Env> {
  private runtime?: Promise<SpaceRuntime>;
  private scope?: SpaceScope;
  private resetting?: Promise<unknown>;
  private wiping?: Promise<void>;
  private replacement?: Promise<void>;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    new KeyValue(state.storage.sql);
  }
  private gate<T>(work: Promise<T>): Promise<T> {
    const resetting = work.finally(() => {
      if (this.resetting === resetting) this.resetting = undefined;
    });
    this.resetting = resetting;
    return resetting;
  }
  private ready(): Promise<SpaceRuntime> {
    if (this.resetting) return this.resetting.then(() => this.ready());
    if (new KeyValue(this.ctx.storage.sql).get("wipe-intent") !== undefined)
      return this.wipe().then(() => this.ready());
    if (!this.runtime) {
      const scope = new SpaceScope(
        this.ctx,
        this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("main")),
      );
      this.scope = scope;
      const opening = openSpace(scope, (closing) => {
        if (this.scope === scope) {
          this.replacement = closing;
          this.runtime = undefined;
          this.scope = undefined;
          if (!this.resetting)
            void this.gate(closing).catch((error: unknown) =>
              console.error("space.replace", error),
            );
        }
      }).catch((error: unknown) => {
        if (this.scope === scope) {
          this.runtime = undefined;
          this.scope = undefined;
        }
        throw error;
      });
      this.runtime = opening;
    }
    return this.runtime;
  }
  async state(uid: string) {
    return (await this.ready()).account.state(uid);
  }
  async onboard(uid: string, input: unknown) {
    return (await this.ready()).account.configure({ uid, input });
  }
  async speechPreferences() {
    return (await this.ready()).speech.get(null);
  }
  async updateSpeech(input: unknown) {
    return (await this.ready()).speech.set(input);
  }
  async synthesizeSpeech(requestId: string, text: string) {
    return (await this.ready()).synthesis.synthesize({ requestId, text });
  }
  async cancelSpeech(requestId: string) {
    await (await this.ready()).synthesis.cancel(requestId);
  }
  async uploadImage(data: ArrayBuffer) {
    return (await this.ready()).images.upload(data);
  }
  async image(id: string) {
    return (await this.ready()).images.read(id);
  }
  async history(before: number | undefined, limit = 80) {
    return (await this.ready()).history.page({ before, limit });
  }
  async memoryLines() {
    return (await this.ready()).memory.lines(null);
  }
  async memoryTree(id?: number, n?: number) {
    return (await this.ready()).history.tree({ id, n });
  }
  async chat(uid: string, input: unknown) {
    return (await this.ready()).conversation.chat({ uid, input });
  }
  async stop(requestId: string) {
    for (;;) {
      if (this.resetting) {
        await this.resetting;
        continue;
      }
      if (new KeyValue(this.ctx.storage.sql).get("wipe-intent") !== undefined) {
        await this.wipe();
        continue;
      }
      break;
    }
    ConversationPersistence.cancel(this.ctx.storage.sql, requestId);
    const rt = await this.ready();
    await rt.conversation.stop(requestId);
    const uid = new AccountIdentity(this.scope!.storage.sql).uid();
    if (!uid) throw new Error("Space is not configured");
    return rt.account.state(uid);
  }
  async alarm() {
    if (new KeyValue(this.ctx.storage.sql).get("wipe-intent") !== undefined) {
      await this.wipe();
      return;
    }
    await (await this.ready()).alarm();
  }
  async memoryImport(input: unknown): Promise<MemoryImportResult> {
    const parsed = MemoryBackup.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        status: 400,
        message: "记忆备份格式无效，请选择 Mira 导出的 JSON 文件。",
      };
    const backup = parsed.data;
    const images: { id: string; userId: number; data: ArrayBuffer }[] = [];
    try {
      const owners = new Set<number>();
      for (const [id, image] of Object.entries(backup.images)) {
        const userId =
          typeof image === "string"
            ? backup.messages.find((m) => m.images?.includes(id))!.id
            : image.userId;
        if (owners.has(userId)) throw new Error("一条用户消息不能重复绑定图片");
        owners.add(userId);
        images.push({
          id,
          userId,
          data: Images.decodeBackup(typeof image === "string" ? image : image.data),
        });
      }
    } catch (error) {
      return {
        ok: false,
        status: 400,
        message: error instanceof Error ? error.message : "备份图片无效",
      };
    }
    if (this.resetting) {
      await this.resetting;
      return this.memoryImport(input);
    }
    const opening = this.ready();
    return this.gate(
      opening.then(async (runtime) => {
        if (!(await runtime.conversation.prepareImport(null)))
          return { ok: false as const, status: 409, message: "请等待当前回复结束后再导入记忆。" };
        this.runtime = undefined;
        this.scope?.retire();
        await runtime.close();
        this.scope = undefined;
        try {
          this.ctx.storage.transactionSync(() => {
            restoreMemoryBackup(this.ctx.storage, backup);
            Images.restore(this.ctx.storage.sql, images);
            ConversationPersistence.restoreMetadata(this.ctx.storage.sql, backup.messages);
          });
        } catch {
          return { ok: false as const, status: 500, message: "导入未完成，原有记忆已保留。" };
        }
        return { ok: true as const, messages: backup.messages.length };
      }),
    );
  }
  async memoryExport() {
    return (await this.ready()).memory.export(null);
  }
  async inspect() {
    return (await this.ready()).account.inspect(null);
  }
  wipe(): Promise<void> {
    if (this.wiping) return this.wiping;
    const previous = this.resetting;
    const wiping = this.gate(
      Promise.resolve(previous)
        .catch(() => {})
        .then(() => this.clear()),
    ).finally(() => {
      if (this.wiping === wiping) this.wiping = undefined;
    });
    this.wiping = wiping;
    return wiping;
  }
  private async clear() {
    const values = new KeyValue(this.ctx.storage.sql);
    const uid = values.get("wipe-intent") ?? new AccountIdentity(this.ctx.storage.sql).uid() ?? "";
    const opening = this.runtime;
    this.runtime = undefined;
    this.scope?.retire();
    // Intent and its wakeup commit together. Never erase the identity before remote cleanup.
    // SQLite deleteAll is atomic and (compatibility date >= 2026-02-24) deletes the alarm.
    await this.ctx.storage.transaction(async (transaction) => {
      values.set("wipe-intent", uid);
      await transaction.setAlarm(Date.now() + 15_000);
    });
    const rt = await opening?.catch(() => undefined);
    await rt?.close();
    await this.replacement?.catch((error: unknown) => console.error("space.replace", error));
    this.replacement = undefined;
    this.scope = undefined;
    if (uid) await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("main")).remove(uid);
    await this.ctx.storage.deleteAll();
    new KeyValue(this.ctx.storage.sql);
  }
}
