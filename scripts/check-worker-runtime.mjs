import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { readAlertConfig } from "./verify-deployment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Validate the same configuration used by post-deploy checks before any upload.
readAlertConfig();
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const { port } = socket.address();
await new Promise(resolve => socket.close(resolve));
const child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--config", "dist/server/wrangler.json", "--local", "--ip", "127.0.0.1", "--port", String(port)], {
  cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", BROWSER: "none" },
});
let output = "";
child.stdout.on("data", data => { output = (output + data).slice(-12000); });
child.stderr.on("data", data => { output = (output + data).slice(-12000); });
const exited = once(child, "exit");
const origin = `http://127.0.0.1:${port}`;
const fetchLocal = path => fetch(origin + path, { signal: AbortSignal.timeout(1500), redirect: "error" });
try {
  let health;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Worker runtime exited before startup:\n${output}`);
    try { health = await fetchLocal("/api/health"); if (health.ok) break; } catch { /* Wait for local startup. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, `Worker did not start:\n${output}`);
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
  console.log(JSON.stringify({ ...metadata, runtime: "workerd", checks: ["health", "home", "manifest", "service-worker", "icon", "score-route"], externalRequests: 0 }));
} finally {
  const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  kill("SIGTERM");
  const timer = setTimeout(() => kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(timer);
}
