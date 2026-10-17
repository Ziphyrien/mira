import { getHighlighter, highlightCodeBlocks } from "comark/plugins/shiki";
import { bundledLanguages, type BundledLanguage } from "shiki/langs";
import type { MarkdownDocument } from "comark";

/** Loaded only for a visible code block; each grammar loads on first use. */
export async function highlight(source: string, language: string): Promise<MarkdownDocument> {
  const highlighter = await getHighlighter({ registerDefaultLanguages: false });
  if (
    Object.hasOwn(bundledLanguages, language) &&
    !highlighter.getLoadedLanguages().includes(language)
  ) {
    await highlighter.loadLanguage(await bundledLanguages[language as BundledLanguage]());
  }
  return highlightCodeBlocks(
    {
      frontmatter: {},
      meta: {},
      nodes: [["pre", { language }, ["code", {}, source]]],
    },
    { registerDefaultLanguages: false },
  );
}
