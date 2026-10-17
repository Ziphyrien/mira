import { Type } from "@earendil-works/pi-ai";

export const MEMORY_TOOLS = [
  {
    name: "zoom",
    description:
      "Open the line id+n of the view into the two lines of n/2 under it; n = 1 gives the message whole. A long text comes in pages from character at, saying where to go on.",
    parameters: Type.Object({
      id: Type.Integer({ minimum: 0 }),
      n: Type.Optional(Type.Integer({ minimum: 1 })),
      at: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  },
  {
    name: "date",
    description: "The date and time of message id.",
    parameters: Type.Object({ id: Type.Integer({ minimum: 0 }) }),
  },
] as const;
