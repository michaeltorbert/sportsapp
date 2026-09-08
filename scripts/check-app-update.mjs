// Two synthetic builds of the same source, isolated Workers and one browser origin.
// No deploy, real score fetch, push delivery, or remote alert writes.
import { spawn, execFileSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, copyFile, symlink, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { chromium, webkit, expect } from "@playwright/test";
import { standardEvents, NOW } from "../tests/browser/fixtures.mjs";
const root = resolve(import.meta.dirname, ".."), temp = await mkdtemp(join(tmpdir(), "ss-updater-"));
const A = "a".repeat(40), B = "b".repeat(40), children = [], browsers = [];
const evidence = { syntheticIdentities: { A, B }, scenarios: [], sourceManifest: [] };
let proxy;
async function run(args, cwd, commit) {
  const child = spawn(process.execPath, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SOURCE_COMMIT: commit, CLOUDFLARE_ENV: "", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", BROWSER: "none" } });
  children.push(child); let output = "";
  child.stdout.on("data", d => { output = (output + d).slice(-20000); }); child.stderr.on("data", d => { output = (output + d).slice(-20000); });
  return { child, output: () => output };
}
async function freePort() { const s = createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening"); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function worker(dir, commit) {
  const build = await run(["scripts/run-with-timeout.mjs", "3m", "10s", "node_modules/vinext/dist/cli.js", "build"], dir, commit);
  const [code] = await once(build.child, "exit"); if (code !== 0) throw new Error(build.output());
  const port = await freePort(); const runtime = await run(["node_modules/wrangler/bin/wrangler.js", "dev", "--config", "dist/server/wrangler.json", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], dir, commit);
  for (let n = 0; n < 120; n++) {
    if (runtime.child.exitCode !== null) throw new Error(runtime.output());
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }); if ((await response.json()).commit === commit) return port; } catch { /* Bounded startup. */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Worker startup failed: ${runtime.output()}`);
}
try {
  // Explicit source allowlist excludes private config, generated outputs and logs.
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).toString().split("\0").filter(p => p && (/^(app|components|lib|public|scripts|services|tests|worker|vendor|hooks|db|drizzle)\//.test(p) || /^(package(-lock)?\.json|wrangler\.jsonc|.*config\.(ts|mjs|jsonc?|js)|tsconfig\.json|worker-configuration\.d\.ts|next-env\.d\.ts)$/.test(p))).sort();
  const dirs = [join(temp, "a"), join(temp, "b")];
  for (const path of paths) {
    const bytes = await readFile(join(root, path)); evidence.sourceManifest.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    for (const dir of dirs) { await mkdir(dirname(join(dir, path)), { recursive: true }); await copyFile(join(root, path), join(dir, path)); }
  }
  evidence.sourceHash = createHash("sha256").update(JSON.stringify(evidence.sourceManifest)).digest("hex");
  evidence.lockfileHash = createHash("sha256").update(await readFile(join(root, "package-lock.json"))).digest("hex");
  // Reuses the root npm ci installation; both snapshots contain the same lockfile.
  for (const dir of dirs) await symlink(resolve(root, "node_modules"), join(dir, "node_modules"), "dir");
  const ports = [await worker(dirs[0], A), await worker(dirs[1], B)];
  let documentBackend = 0, healthBackend = 0, failHealth = false, healthCount = 0, documents = 0;
  proxy = createServer((req, res) => {
    const health = new URL(req.url, "http://local").pathname === "/api/health";
    if (health) healthCount++;
    if (req.headers.accept?.includes("text/html")) documents++;
    if (health && failHealth) { res.writeHead(503); res.end(); return; }
    const upstream = httpRequest({ hostname: "127.0.0.1", port: ports[health ? healthBackend : documentBackend], path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${ports[health ? healthBackend : documentBackend]}` } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening"); const origin = `http://127.0.0.1:${proxy.address().port}`;
  const response = await fetch(origin); evidence.documentCacheControl = response.headers.get("cache-control");
  expect(response.status).toBe(200); expect(evidence.documentCacheControl || "").not.toMatch(/immutable|s-maxage=[1-9]|max-age=[1-9]/);
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch(); browsers.push(browser);
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname === "site.api.espn.com") return route.fulfill({ json: url.pathname.endsWith("/summary") ? {} : { events: standardEvents() } });
      if (url.origin === origin) {
        if (url.pathname === "/api/scores") return route.fulfill({ status: 503, json: { error: "simulated" } });
        if (url.pathname === "/alerts-config.json") return route.fulfill({ json: { serviceUrl: "" } });
        return route.continue();
      }
      return route.abort();
    });
    const page = await context.newPage(); await page.clock.install({ time: new Date(NOW) });
    const refreshPage = async () => { await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Refresh app", exact: true }).click()]); await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled(); };
    const identity = () => page.locator("main[data-app-commit]");
    // Wait for the full response before advancing the confirmation clock. Quiet
    // background checks deliberately do not expose pending/current UI statuses.
    const tickHealth = async milliseconds => {
      const received = page.waitForResponse(response => new URL(response.url()).pathname === "/api/health");
      await page.clock.fastForward(milliseconds); await (await received).finished();
      await page.waitForTimeout(50); // Let JSON consumption and React publication finish.
    };
    const detect = async () => { await tickHealth(3100); await tickHealth(10100); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible(); };

    documentBackend = healthBackend = 0; failHealth = false;
    await page.goto(origin); await expect(identity()).toHaveAttribute("data-app-commit", A); await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
    documentBackend = healthBackend = 1; await detect();
    await refreshPage(); await expect(identity()).toHaveAttribute("data-app-commit", B);
    await tickHealth(14000); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toHaveCount(0);
    evidence.scenarios.push(`${name}: A page detects B and loads hydrated B, marker arrival is inert`);
    // Roll back the whole origin to A while B remains open.
    documentBackend = healthBackend = 0; await tickHealth(300000); await tickHealth(10100); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible();
    failHealth = true; const before = documents;
    await page.getByRole("button", { name: "Refresh app", exact: true }).click(); await expect(page.locator(".app-update-status")).toContainText("Refresh could not be verified"); expect(documents).toBe(before);
    failHealth = false; await refreshPage(); await expect(identity()).toHaveAttribute("data-app-commit", A);
    evidence.scenarios.push(`${name}: failed verification stays open; explicit rollback loads A`);
    healthBackend = 1; await detect(); await refreshPage();
    await expect.poll(() => documents).toBeGreaterThan(before + 1); await expect(identity()).toHaveAttribute("data-app-commit", A);
    const staleDocuments = documents; await detect(); await page.clock.fastForward(300000); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible(); expect(documents).toBe(staleDocuments);
    evidence.scenarios.push(`${name}: fresh B health with stale A document offers retry without reload loop`);
    await context.close(); await browser.close();
  }
  await mkdir(join(root, "output/playwright"), { recursive: true }); await writeFile(join(root, "output/playwright/updater-two-build.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, sourceManifest: `${evidence.sourceManifest.length} files; full evidence in output/playwright/updater-two-build.json` }, null, 2));
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  if (proxy) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
  for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  await new Promise(r => setTimeout(r, 1000));
  for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  await rm(temp, { recursive: true, force: true });
}
