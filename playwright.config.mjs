import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

const sourceCommit = process.env.SOURCE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const port = Number(process.env.BROWSER_TEST_PORT || 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid BROWSER_TEST_PORT");
const baseURL = `http://127.0.0.1:${port}`;
const browserRunId = randomUUID();
const serverDiagnosticsDir = resolve("output/playwright/server");
// Bind diagnostics to the actual browser harness, including uncommitted helpers.
const browserTestSources = [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "tests/browser", "playwright.config.mjs", "scripts/browser-test-server.mjs", "scripts/browser-server-diagnostics.mjs"], { encoding: "utf8" }).split("\0").filter(Boolean))]
  .filter(path => existsSync(path)).sort().map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Hosted runners share one local workerd server with the browser engines.
  // Serialize CI to reduce resource contention; keep local parallelism.
  workers: process.env.CI ? 1 : 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: "output/playwright/results",
  reporter: [["list"], ["json", { outputFile: "output/playwright/results.json" }], ["html", { outputFolder: "output/playwright/report", open: "never" }], ["./tests/browser/server-exit-reporter.mjs"]],
  metadata: {
    sourceCommit,
    browserRunId,
    serverDiagnosticsDir,
    ci: {
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      prHeadSha: process.env.PR_HEAD_SHA || null,
      testedSha: sourceCommit,
      shard: process.env.BROWSER_TEST_SHARD || null,
      runnerName: process.env.RUNNER_NAME || null,
    },
    browserTestSources,
    browserTestSourcesHash: createHash("sha256").update(JSON.stringify(browserTestSources)).digest("hex"),
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
  // Playwright 1.64 forwards a device descriptor's screen size to the browser. screen: undefined,
  // set after the spread, keeps the 1.63 behavior these tests were written against.
  projects: [
    { name: "chromium-mobile", use: { ...devices["iPhone 13"], screen: undefined, defaultBrowserType: "chromium", browserName: "chromium" } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], screen: undefined, browserName: "webkit" } },
  ],
  webServer: {
    command: `node scripts/browser-test-server.mjs -- node node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --ip 127.0.0.1 --port ${port} --inspector-port 0`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    env: { WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", BROWSER: "none", BROWSER_TEST_RUN_ID: browserRunId, BROWSER_TEST_STATE_DIR: serverDiagnosticsDir },
  },
});
