import { defineFacet, type Facet } from "@earendil-works/chord";
import { type Message, type UserMessage } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, GenerationTask, hook } from "@earendil-works/pi-durable";
import { textBlocks } from "../../core/content";
import { Extensions } from "../generation/api";
import { ConversationStore } from "../conversation/api";
import { ImageStore } from "../images/api";
import { MemoryQueries, MemoryStore } from "./api";
import { MEMORY_TOOLS } from "./tools";
import { viewBlocks } from "./view";
import { MemoryExtension } from "./api";
export const memoryExtensionFacet: Facet = {
  name: "mira.memory.extension",
  ...defineFacet(
    (api) =>
      api.serve(
        MemoryExtension,
        (_input, _principal, self) => {
          const memory = self.get(MemoryStore, {}),
            queries = self.get(MemoryQueries, {}),
            images = self.get(ImageStore, {}),
            journal = self.get(ConversationStore, {});
          const output = (text: string) => ({ output: [{ type: "text" as const, text }] });
          const zoom = defineTool({
            ...MEMORY_TOOLS[0],
            replay: "safe",
            execute: async (args) => {
              const result = await api.root((ctx) => queries.zoom(args, ctx));
              return {
                output: [
                  { type: "text" as const, text: result.text },
                  ...(result.image ? [result.image] : []),
                ],
              };
            },
          });
          const date = defineTool({
            ...MEMORY_TOOLS[1],
            replay: "safe",
            execute: async (args) => output(await api.root((ctx) => queries.date(args.id, ctx))),
          });
          const inject = async (messages: readonly Message[]): Promise<readonly Message[]> => {
            const at = messages.findIndex((message) => message.role === "user");
            if (at < 0) throw new Error("Generation has no user input");
            const first = messages[at] as UserMessage;
            const operation = journal.store!.active();
            const timezone = operation?.prompt?.timezone;
            if (!timezone) throw new Error("Turn timezone was not prepared");
            const now = new Intl.DateTimeFormat("zh-CN", {
              timeZone: timezone,
              dateStyle: "full",
              timeStyle: "short",
            }).format(first.timestamp);
            const content = [
              ...viewBlocks(memory.store!.frozen()),
              { type: "text" as const, text: `<now>${now}</now>\n\n${textBlocks(first.content)}` },
            ];
            const image = operation ? images.store!.content(operation.userId) : undefined;
            return [
              ...messages.slice(0, at),
              { ...first, content: image ? [...content, image] : content },
              ...messages.slice(at + 1),
            ];
          };
          self.register(Extensions, {
            memory: {
              order: 20,
              extension: defineExtension({
                name: "mira.memory",
                tools: [zoom, date],
                hooks: [
                  hook(GenerationTask, {
                    beforeRequest: async (request) => ({
                      messages: await inject(request.messages),
                    }),
                  }),
                ],
              }),
            },
          });
          return {};
        },
        { lifetime: "host" },
      ),
    { uses: [MemoryStore, MemoryQueries, ImageStore, ConversationStore] },
  ),
};
