import { z } from "zod";
import { ImageId } from "./images.js";
import type { Row } from "./messages.js";
import { ModelChoice, THINKING, type AiModelInfo } from "./models.js";
import type { SearchActivity } from "./search.js";

export const ChatInput = z
  .object({
    prompt: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("message"),
          text: z.string().trim().max(4000),
          image: ImageId.optional(),
        })
        .strict()
        .refine((input) => Boolean(input.text || input.image), "请输入消息或选择图片"),
      z.object({ kind: z.literal("reply"), replyId: z.number().int().nonnegative() }).strict(),
      z.object({ kind: z.literal("question"), userId: z.number().int().nonnegative() }).strict(),
    ]),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    thinking: z.enum(THINKING.map((option) => option.id)),
    model: ModelChoice,
  })
  .strict();
export type ChatInput = z.infer<typeof ChatInput>;

export const StopInput = z.object({ requestId: ChatInput.shape.requestId }).strict();

export type ChatReply = {
  text: string;
  thinking?: string;
  searches?: SearchActivity[];
  stopped?: true;
  at: number;
  replyId: number;
  userId: number;
};

export type StreamEvent =
  | { type: "model"; model: AiModelInfo | null }
  | { type: "status"; phase: "thinking" | "recall" }
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | { type: "thinking"; text: string; replace: boolean }
  | { type: "search"; search: SearchActivity }
  | { type: "stopped"; messages: Row[] }
  | ({ type: "done"; messages: Row[] } & ChatReply)
  | { type: "error"; message: string };
