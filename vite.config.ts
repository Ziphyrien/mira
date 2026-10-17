import { enhancedImages } from "@sveltejs/enhanced-img";
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import browserslist from "browserslist";
import browserslistToEsbuild from "browserslist-to-esbuild";
import { browserslistToTargets } from "lightningcss";
import { defineConfig, lazyPlugins } from "vite-plus";

const browsers = browserslist();

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
    lightningcss: { targets: browserslistToTargets(browsers) },
  },
  build: { target: browserslistToEsbuild(browsers), cssMinify: "lightningcss" },
  plugins: lazyPlugins(() => [
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
