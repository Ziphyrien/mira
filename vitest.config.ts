import { defineConfig } from "vite-plus";
import { compileModule } from "svelte/compiler";
import ts from "typescript";
/** Only rune modules need compilation; tests never initialize SvelteKit or the Cloudflare dev proxy. */
export default defineConfig({
  plugins: [
    {
      name: "test-rune-modules",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith(".svelte.ts")) return;
        const javascript = ts.transpileModule(code, {
          compilerOptions: {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            verbatimModuleSyntax: true,
          },
        }).outputText;
        return compileModule(javascript, { filename: id, generate: "client" }).js;
      },
    },
  ],
  test: { include: ["src/**/*.test.ts", "worker/**/*.test.ts"] },
});
