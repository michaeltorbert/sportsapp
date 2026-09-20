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

test("browser CI runs engines on independent runners and retains crash logs", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tests.yml", import.meta.url), "utf8");
  assert.match(workflow, /browser:\n    runs-on: ubuntu-latest/);
  assert.match(workflow, /- project: chromium-mobile\n            engine: chromium/);
  assert.match(workflow, /- project: webkit-mobile\n            engine: webkit/);
  assert.match(workflow, /npm run test:browser -- --project=\$\{\{ matrix\.project \}\}/);
  assert.match(workflow, /browser-\$\{\{ matrix\.project \}\}-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /fail-fast: false/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
  assert.doesNotMatch(workflow, /mv output\/playwright\/results/);
  assert.match(workflow, /\.wrangler\/logs\//);
});

test("CI keeps updater engines isolated and gates every required result", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tests.yml", import.meta.url), "utf8");
  assert.match(workflow, /updater:\n    runs-on: ubuntu-latest/);
  assert.match(workflow, /npx playwright install --with-deps chromium webkit/);
  assert.match(workflow, /npm run test:updater/);
  assert.match(workflow, /test:\n    if: always\(\)/);
  assert.match(workflow, /needs: \[core, browser, updater\]/);
  assert.match(workflow, /test "\$CORE_RESULT" = success/);
  assert.match(workflow, /test "\$BROWSER_RESULT" = success/);
  assert.match(workflow, /test "\$UPDATER_RESULT" = success/);
});
