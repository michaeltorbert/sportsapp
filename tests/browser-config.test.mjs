import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

for (const ci of [false, true]) test(`browser configuration ${ci ? "serializes CI" : "retains local parallelism"} without retries`, () => {
  const env = { ...process.env, SOURCE_COMMIT: "config-test", BROWSER_TEST_PORT: "4178" };
  delete env.CI;
  if (ci) env.CI = "true";
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", "import c from './playwright.config.mjs'; console.log(JSON.stringify({ workers:c.workers,retries:c.retries,reuse:c.webServer.reuseExistingServer,projects:c.projects.map(p=>p.name) }));"], { cwd: new URL("..", import.meta.url), env, encoding: "utf8" }));
  assert.deepEqual(result, { workers: ci ? 1 : 2, retries: 0, reuse: false, projects: ["chromium-mobile", "webkit-mobile"] });
});

test("browser CI isolates engine server lifetimes and retains crash logs", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tests.yml", import.meta.url), "utf8");
  const chromium = "npm run test:browser -- --project=chromium-mobile";
  const webkit = "npm run test:browser -- --project=webkit-mobile";
  assert.ok(workflow.includes(chromium));
  assert.ok(workflow.includes(webkit));
  assert.ok(workflow.indexOf(chromium) < workflow.indexOf(webkit));
  assert.match(workflow, /mv output\/playwright\/results output\/playwright\/results-chromium-mobile/);
  assert.match(workflow, /\.wrangler\/logs\//);
});
