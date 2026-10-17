import type { ParserOptions } from "comark";
import cjkFriendly from "markdown-it-cjk-friendly";

/** One parser policy for visible replies and speech; raw HTML remains literal text. */
export const markdownOptions = {
  registerDefaultPlugins: false,
  plugins: [{ name: "cjk-friendly", markdownItPlugins: [cjkFriendly] }],
} satisfies ParserOptions;
