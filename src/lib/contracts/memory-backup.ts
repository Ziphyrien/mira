import { z } from "zod";

export const MAX_MEMORY_BACKUP_BYTES = 32 * 1024 * 1024;
const index = z.number().int().nonnegative().safe();
const part = z.object({ id: index, n: z.number().int().positive().safe() });
const webUrl = z
  .string()
  .url()
  .regex(/^https?:\/\//);
const source = z.object({
  id: z.string(),
  url: webUrl,
  title: z.string(),
  excerpt: z.string(),
  favicon: webUrl.optional(),
});
const reply = z.object({
  thinking: z.string().optional(),
  replyTo: index.optional(),
  stopped: z.literal(true).optional(),
  searches: z
    .array(
      z.object({
        id: z.string(),
        query: z.string(),
        status: z.enum(["running", "done", "error"]),
        sources: z.array(source),
        error: z.string().optional(),
      }),
    )
    .optional(),
});
export const MemoryBackup = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    messages: z.array(
      z.object({
        id: index,
        kind: z.enum(["user", "mira", "tool", "echo", "work", "note"]),
        text: z.string(),
        date: z.string().refine((s) => Number.isFinite(Date.parse(s)), "无效的消息时间"),
        images: z.array(z.string().min(1)).max(1).optional(),
        reply: reply.optional(),
      }),
    ),
    summaries: z.array(part.extend({ text: z.string() })),
    images: z.record(
      z.string().regex(/^[A-Za-z0-9-]{1,128}$/),
      z.union([z.string(), z.object({ data: z.string(), userId: index })]),
    ),
    sources: z.array(z.object({ source: z.string(), id: index })).optional(),
    view: z
      .object({
        parts: z.array(part),
        seen: z.array(part),
        batch: z.boolean(),
        seenBatch: z.boolean(),
      })
      .optional(),
  })
  .superRefine((backup, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    const total = backup.messages.length;
    const imageMessages = new Map<string, number>();
    for (const m of backup.messages)
      for (const key of m.images ?? []) {
        if (!imageMessages.has(key)) imageMessages.set(key, m.id);
      }
    const imageOwners = new Set<number>();
    backup.messages.forEach((m, i) => {
      if (m.id !== i) bad("消息编号必须从 0 连续排列");
      for (const image of m.images ?? [])
        if (!Object.hasOwn(backup.images, image)) bad("消息引用的图片缺失");
      if (m.reply?.replyTo !== undefined && backup.messages[m.reply.replyTo]?.kind !== "user")
        bad("回复关联的用户消息不存在");
    });
    const validPart = (p: { id: number; n: number }) =>
      Number.isInteger(Math.log2(p.n)) && p.id % p.n === 0 && p.id + p.n <= total;
    const nodes = new Set<string>();
    for (const p of backup.summaries) {
      const key = `${p.id}+${p.n}`;
      if (!validPart(p) || nodes.has(key)) bad("摘要节点范围无效或重复");
      nodes.add(key);
    }
    for (const p of backup.summaries)
      if (
        p.n > 1 &&
        (!nodes.has(`${p.id}+${p.n / 2}`) || !nodes.has(`${p.id + p.n / 2}+${p.n / 2}`))
      )
        bad("摘要节点缺少子节点");
    const sourceIds = new Set<string>();
    for (const s of backup.sources ?? []) {
      if (s.id >= total || sourceIds.has(s.source)) bad("消息来源无效或重复");
      sourceIds.add(s.source);
    }
    for (const [key, image] of Object.entries(backup.images)) {
      const owner = typeof image === "string" ? imageMessages.get(key) : image.userId;
      if (owner === undefined || backup.messages[owner]?.kind !== "user")
        bad("图片缺少对应的用户消息");
      if (!imageMessages.has(key)) bad("图片未被消息引用");
      if (owner !== undefined) {
        if (imageOwners.has(owner)) bad("用户消息重复绑定图片");
        imageOwners.add(owner);
      }
    }
    if (backup.view)
      for (const [name, parts] of [
        ["parts", backup.view.parts],
        ["seen", backup.view.seen],
      ] as const) {
        let next = 0;
        for (const p of parts) {
          if (!validPart(p) || p.id !== next || (p.n > 1 && !nodes.has(`${p.id}+${p.n}`)))
            bad("折叠视图无效");
          next = p.id + p.n;
        }
        if (name === "parts" && next !== total) bad("折叠视图未覆盖全部消息");
        if (name === "seen" && backup.messages.slice(0, next).some((m) => !nodes.has(`${m.id}+1`)))
          bad("压缩视图包含未完成摘要");
      }
  });
export type MemoryBackup = z.infer<typeof MemoryBackup>;
export type MemoryImportResult =
  | { ok: true; messages: number }
  | { ok: false; status: number; message: string };
