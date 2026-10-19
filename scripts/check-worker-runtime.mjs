import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readAlertConfig } from "./verify-deployment.mjs";
import { keepFirstFailure } from "./owned-process-group.mjs";
import { startWorkerRuntime } from "./worker-runtime-start.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Validate the same configuration used by post-deploy checks before any upload.
readAlertConfig();
// One attempt; only this child's own IPC readiness names the endpoint we check.
const runtime = startWorkerRuntime({
  cwd: root,
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", BROWSER: "none" },
});
const identity = await keepFirstFailure(async () => {
  const { port } = await runtime.during(runtime.ready);
  const origin = `http://127.0.0.1:${port}`;
  const fetchLocal = (path, timeout = 1500) => runtime.during(fetch(origin + path, { signal: AbortSignal.timeout(timeout), redirect: "error" }));
  const health = await fetchLocal("/api/health", 10000);
  assert.ok(health.ok, `Worker health returned ${health.status}`);
  const metadata = await health.json();
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const commit = process.env.SOURCE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.deepEqual(metadata, { version, commit });
  assert.match(await (await fetchLocal("/")).text(), /Saturday Signal/);
  const manifest = await fetchLocal("/manifest.webmanifest");
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).start_url, "/");
  const sw = await fetchLocal("/sw.js");
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get("content-type"), /javascript/);
  const icon = await fetchLocal("/icon-192.png");
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
  assert.equal((await fetchLocal("/api/scores?date=invalid")).status, 400);
  // Invalid stats input is rejected before any upstream request.
  const stats = await fetchLocal("/api/stats?event=invalid&phase=final");
  assert.equal(stats.status, 400);
  assert.equal(stats.headers.get("cache-control"), "no-store");
  // Invalid team input is rejected the same way, with no upstream work.
  for (const query of ["", "?team=", "?team=abc", "?team=1234567", "?team=150&team=153"]) {
    const team = await fetchLocal(`/api/team${query}`);
    assert.equal(team.status, 400, `team${query}`);
    assert.equal(team.headers.get("cache-control"), "no-store");
  }
  runtime.assertAlive();
  return metadata;
}, {
  capture: () => { console.error(`Worker runtime output tail:\n${runtime.output()}`); },
  cleanup: async () => {
    const cleanup = await runtime.stop();
    console.error(`Worker runtime attempt: ${JSON.stringify(runtime.attempt)}`);
    if (!cleanup.gone) throw new Error(`Worker runtime process group was not cleaned up: ${cleanup.error?.message}`);
  },
});
console.log(JSON.stringify({ ...identity, runtime: "workerd", checks: ["health", "home", "manifest", "service-worker", "icon", "score-route", "stats-route", "team-route"], externalRequests: 0 }));
