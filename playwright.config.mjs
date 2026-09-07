import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sourceCommit = process.env.SOURCE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const port = Number(process.env.BROWSER_TEST_PORT || 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid BROWSER_TEST_PORT");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: "output/playwright/results",
  reporter: [["list"], ["json", { outputFile: "output/playwright/results.json" }], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  metadata: {
    sourceCommit,
    appVersion: JSON.parse(readFileSync("package.json", "utf8")).version,
    verification: "Desktop engines with mobile emulation. Scores, alert service, notification permission, service-worker registration and PushManager are simulated; no real push is sent.",
  },
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "America/New_York",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", browserName: "chromium" } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: {
    command: `node node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --ip 127.0.0.1 --port ${port} --inspector-port 0`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", BROWSER: "none" },
  },
});
