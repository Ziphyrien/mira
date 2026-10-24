import { enhancedImages } from "@sveltejs/enhanced-img";
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { chrome92Css } from "./scripts/chrome92-css.ts";
import { defineConfig, lazyPlugins } from "vite-plus";

/**
 * Oldest supported engine: Chrome 92 (July 2021).
 *
 * One declaration feeds both pipelines, in the shape each expects: esbuild takes
 * the es-version name, Lightning CSS takes a numeric target. Bumping the floor
 * means editing these two lines and nothing else.
 */
const SCRIPT_TARGET = ["chrome92"];
const STYLE_TARGETS = { chrome: 92 << 16 };

export default defineConfig({
  fmt: { ignorePatterns: ["vendor/**", ".svelte-kit/**"] },
  lint: {
    ignorePatterns: ["vendor/**", ".svelte-kit/**", "worker-configuration.d.ts"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "no-nested-ternary": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  server: { watch: { ignored: ["**/vendor/**"] } },
  css: {
    transformer: "lightningcss",
    lightningcss: { targets: STYLE_TARGETS },
  },
  build: { target: SCRIPT_TARGET, cssMinify: "lightningcss" },
  plugins: lazyPlugins(() => [
    chrome92Css(),
    enhancedImages(),
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
      adapter: adapter({ config: "wrangler.app.jsonc" }),
    }),
  ]),
});
