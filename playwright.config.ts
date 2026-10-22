import { defineConfig, devices } from "@playwright/test";
import { baseURL } from "./tests/browser/fixture.ts";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    extraHTTPHeaders: { "X-Mira-Research-Protocol": "2" },
    channel:
      process.env.MIRA_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/browser/worker.ts",
    wait: { stdout: /Mira browser fixture ready/ },
    timeout: 90_000,
    reuseExistingServer: false,
  },
});
