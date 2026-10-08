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
import { observeHealthBodies, consumeHealthAfter } from "../tests/browser/health-sync.mjs";
const root = resolve(import.meta.dirname, ".."), temp = await mkdtemp(join(tmpdir(), "ss-updater-"));
const A = "a".repeat(40), B = "b".repeat(40), children = [], browsers = [];
// Headless Chromium already mutes; the flag makes it explicit. The init script mutes any in-document media before it can play (the app has none).
const evidence = { syntheticIdentities: { A, B }, scenarios: [], sourceManifest: [], audio: "chromium --mute-audio; init script sets muted on media loadstart/play (capture)" };
// Allowlisted diagnostics only: counts and states, never raw child output or headers.
const state = { engine: null, stage: "copy sources", tick: null, page: null }, health = { seq: 0, inFlight: 0, recent: [], switches: [] }, logs = [];
const runtimeLogs = () => logs.map(({ child, ...counts }) => ({ ...counts, exitCode: child.exitCode, signalCode: child.signalCode }));
let proxy;
async function run(args, cwd, commit, command = process.execPath) {
  const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SOURCE_COMMIT: commit, CLOUDFLARE_ENV: "", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/logs", BROWSER: "none" } });
  children.push(child); let output = "";
  const log = { label: `${commit === A ? "A" : "B"} ${args.includes("dev") ? "wrangler dev" : "build"}`, recoveredRequestWarnings: 0, proxyWorkerErrorLines: 0, child }; logs.push(log);
  // Counts of Wrangler 4.129.1's published ProxyWorker recovery and error messages; lines themselves are not kept.
  const classify = line => {
    line = line.replace(/\x1b\[[0-9;]*m/g, "");
    if (/ProxyWorker: \S+ \S+ recovered on attempt \d+ after a dropped connection to the UserWorker/.test(line)) log.recoveredRequestWarnings++;
    if (line.includes("Error inside ProxyWorker (the affected request failed; the dev server continues):")) log.proxyWorkerErrorLines++;
  };
  for (const stream of [child.stdout, child.stderr]) {
    let partial = "";
    stream.on("data", d => { const lines = (partial + d).split("\n"); partial = lines.pop(); lines.forEach(classify); output = (output + d).slice(-20000); });
    stream.on("end", () => { if (partial) classify(partial); partial = ""; });
  }
  return { child, output: () => output };
}
const withTimeout = promise => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 5000).unref())]);
async function pageSnapshot(page) {
  const snapshot = await withTimeout(page.evaluate(() => ({ fakeDate: new Date().toISOString(), hidden: document.hidden, online: navigator.onLine, readyState: document.readyState, identity: document.querySelector("main[data-app-commit]")?.getAttribute("data-app-commit") ?? null, status: document.querySelector(".app-update-status")?.textContent.trim().slice(0, 200) ?? null, notice: (notice => notice && { visible: notice.checkVisibility?.() ?? notice.getClientRects().length > 0, text: notice.textContent.trim().slice(0, 300) })(document.querySelector(".app-update")) ?? null, healthBodiesConsumed: window.__healthBodiesConsumed ?? null })));
  snapshot.refreshAppButtons = await withTimeout(page.getByRole("button", { name: "Refresh app", exact: true }).count());
  snapshot.screenshot = await withTimeout(page.screenshot({ path: join(root, "output/playwright/updater-two-build-failure.png"), timeout: 5000 })).then(() => "output/playwright/updater-two-build-failure.png", e => `unavailable: ${e.message.split("\n")[0]}`);
  return snapshot;
}
async function freePort() { const s = createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening"); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function worker(dir, commit) {
  state.stage = `build ${commit === A ? "A" : "B"}`; const build = await run(["run", "build"], dir, commit, "npm");
  const [code] = await once(build.child, "exit"); if (code !== 0) throw new Error(build.output());
  state.stage = `start ${commit === A ? "A" : "B"}`; const port = await freePort(); const runtime = await run(["node_modules/wrangler/bin/wrangler.js", "dev", "--config", "dist/server/wrangler.json", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], dir, commit);
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
  const setBackends = (document, healthIndex, fail = false) => { documentBackend = document; healthBackend = healthIndex; failHealth = fail; health.switches.push({ engine: state.engine, stage: state.stage, afterHealthSeq: health.seq, inFlightAtSwitch: health.inFlight, document, health: healthIndex, fail }); };
  proxy = createServer((req, res) => {
    const isHealth = new URL(req.url, "http://local").pathname === "/api/health";
    let entry;
    if (isHealth) {
      healthCount++; health.inFlight++;
      entry = { seq: ++health.seq, engine: state.engine, stage: state.stage, tick: state.tick, backend: failHealth ? "503" : healthBackend, inFlightAtStart: health.inFlight };
      health.recent = [...health.recent.slice(-99), entry];
      res.on("close", () => { health.inFlight--; entry.status = res.statusCode; entry.completed = res.writableFinished; });
    }
    if (req.headers.accept?.includes("text/html")) documents++;
    if (isHealth && failHealth) { res.writeHead(503); res.end(); return; }
    const upstream = httpRequest({ hostname: "127.0.0.1", port: ports[isHealth ? healthBackend : documentBackend], path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${ports[isHealth ? healthBackend : documentBackend]}` } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on("error", error => { if (entry) entry.errorCode = error.code ?? "unknown"; res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  state.stage = "document cache check"; proxy.listen(0, "127.0.0.1"); await once(proxy, "listening"); const origin = `http://127.0.0.1:${proxy.address().port}`;
  const response = await fetch(origin); evidence.documentCacheControl = response.headers.get("cache-control");
  expect(response.status).toBe(200); expect(evidence.documentCacheControl || "").not.toMatch(/immutable|s-maxage=[1-9]|max-age=[1-9]/);
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    state.engine = name; state.stage = "launch"; state.tick = null; state.page = null;
    const browser = await engine.launch(name === "chromium" ? { args: ["--mute-audio"] } : {}); browsers.push(browser);
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => { for (const type of ["loadstart", "play"]) addEventListener(type, event => { if (event.target instanceof HTMLMediaElement) event.target.muted = true; }, true); });
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
    const page = await context.newPage(); state.page = page; await page.clock.install({ time: new Date(NOW) });
    await observeHealthBodies(page); // Before navigation, so every document counts consumed health bodies.
    const refreshPage = async () => { await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Refresh app", exact: true }).click()]); await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled(); };
    const identity = () => page.locator("main[data-app-commit]");
    // Wait until the app has read the health JSON body, not just the transport,
    // before advancing the confirmation clock. Quiet background checks
    // deliberately do not expose pending/current UI statuses.
    const tickHealth = async milliseconds => {
      state.tick = milliseconds;
      await consumeHealthAfter(page, () => page.clock.fastForward(milliseconds));
      state.tick = null;
    };
    const detect = async () => { await tickHealth(3100); await tickHealth(10100); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible(); };

    state.stage = "A detects B"; setBackends(0, 0);
    await page.goto(origin); await expect(identity()).toHaveAttribute("data-app-commit", A); await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
    setBackends(1, 1); await detect();
    await refreshPage(); await expect(identity()).toHaveAttribute("data-app-commit", B);
    await tickHealth(14000); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toHaveCount(0);
    evidence.scenarios.push(`${name}: A page detects B and loads hydrated B, marker arrival is inert`);
    // Roll back the whole origin to A while B remains open.
    state.stage = "rollback verification"; setBackends(0, 0); await tickHealth(300000); await tickHealth(10100); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible();
    setBackends(0, 0, true); const before = documents;
    await page.getByRole("button", { name: "Refresh app", exact: true }).click(); await expect(page.locator(".app-update-status")).toContainText("Refresh could not be verified"); expect(documents).toBe(before);
    setBackends(0, 0); await refreshPage(); await expect(identity()).toHaveAttribute("data-app-commit", A);
    evidence.scenarios.push(`${name}: failed verification stays open; explicit rollback loads A`);
    state.stage = "stale document retry"; setBackends(0, 1); await detect(); await refreshPage();
    await expect.poll(() => documents).toBeGreaterThan(before + 1); await expect(identity()).toHaveAttribute("data-app-commit", A);
    const staleDocuments = documents; await detect(); await page.clock.fastForward(300000); await expect(page.getByRole("button", { name: "Refresh app", exact: true })).toBeVisible(); expect(documents).toBe(staleDocuments);
    evidence.scenarios.push(`${name}: fresh B health with stale A document offers retry without reload loop`);
    state.stage = "close"; await context.close(); await browser.close();
  }
  evidence.runtimeLogs = runtimeLogs();
  await mkdir(join(root, "output/playwright"), { recursive: true }); await writeFile(join(root, "output/playwright/updater-two-build.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, sourceManifest: `${evidence.sourceManifest.length} files; full evidence in output/playwright/updater-two-build.json` }, null, 2));
} catch (error) {
  // Partial evidence before cleanup; a capture problem never replaces the original error.
  try {
    await mkdir(join(root, "output/playwright"), { recursive: true });
    // Build/start errors carry raw child output, so only the error type is kept for those stages.
    const message = /^(build|start) /.test(state.stage) ? undefined : String(error?.message ?? error).replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 300);
    const failure = { ...evidence, failure: { engine: state.engine, stage: state.stage, tick: state.tick, error: { name: error?.name, message } }, health, runtimeLogs: runtimeLogs(), page: null };
    if (state.page && !state.page.isClosed()) failure.page = await pageSnapshot(state.page).catch(e => ({ unavailable: e.message.split("\n")[0] }));
    await writeFile(join(root, "output/playwright/updater-two-build-failure.json"), JSON.stringify(failure, null, 2));
    console.error("Partial updater evidence in output/playwright/updater-two-build-failure.json");
  } catch (captureError) { console.error(`Updater failure evidence was not captured: ${captureError?.message}`); }
  throw error;
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  if (proxy) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
  for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  await new Promise(r => setTimeout(r, 1000));
  for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  await rm(temp, { recursive: true, force: true });
}
