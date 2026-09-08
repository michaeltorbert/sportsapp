import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "ss-static-check-"));
let child;
try {
  const config = JSON.parse(await readFile(path.join(root, "dist/server/wrangler.json"), "utf8"));
  config.main = "guard.mjs";
  config.no_bundle = false;
  config.assets.directory = path.join(root, "dist/client");
  await writeFile(path.join(temporary, "wrangler.json"), JSON.stringify(config));
  // A root request reaching the Worker must fail. A successful root response
  // therefore proves asset-first routing, rather than merely fast SSR.
  await writeFile(path.join(temporary, "guard.mjs"), `import worker from ${JSON.stringify(path.join(root, "dist/server/index.js"))}; export default { fetch(request, env, ctx) { if (new URL(request.url).pathname === "/") return new Response("ROOT_REACHED_WORKER", { status: 599 }); return worker.fetch(request, env, ctx); } };`);
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--config", path.join(temporary, "wrangler.json"), "--env", "", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", BROWSER: "none" } });
  let output = "", spawnError;
  child.on("error", error => { spawnError = error; });
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-8000); });
  const origin = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, output);
    try { health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }); if (health.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, output);
  const { version, commit } = await health.json();
  for (const suffix of ["/", "/?tab=acc&date=2026-09-07&_ss_update=1", "/?game=401858212#game-401858212"]) {
    const response = await fetch(origin + suffix);
    assert.equal(response.status, 200, suffix);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate", suffix);
    assert.ok((await response.text()).includes(`<!-- saturday-signal-static ${version} ${commit} -->`), suffix);
  }
  assert.equal((await fetch(origin + "/", { method: "HEAD" })).status, 200);
  assert.equal((await fetch(origin + "/api/scores?date=invalid")).status, 400);
  assert.equal((await fetch(origin + "/not-a-route")).status, 404);
  const rsc = await fetch(origin + "/.rsc", { headers: { RSC: "1", Accept: "text/x-component" } });
  assert.equal(rsc.status, 200);
  assert.match(rsc.headers.get("content-type") ?? "", /text\/x-component/);
  assert.ok(!(await rsc.text()).includes("saturday-signal-static"));
  console.log(JSON.stringify({ version, commit, runtime: "workerd", rootBypassesWorker: true, checks: ["root", "query", "HEAD", "dynamic-api", "404", "rsc"], externalRequests: 0 }));
} finally {
  if (child?.pid && child.exitCode === null) {
    const exited = once(child, "exit");
    process.kill(-child.pid, "SIGTERM");
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 3000);
    await exited;
    clearTimeout(timer);
  }
  await rm(temporary, { recursive: true, force: true });
}
