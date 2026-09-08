// Opt-in live CORS probe; deliberately excluded from CI and npm test.
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, webkit } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const [date, endDate = date] = process.argv.slice(2);
assert.match(date || "", /^\d{4}-\d{2}-\d{2}$/, "Usage: node scripts/check-browser-cdn-live.mjs YYYY-MM-DD [YYYY-MM-DD]");
assert.match(endDate, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(endDate >= date, "End date must not precede start date");
const compiled = await build({ entryPoints: [root + "/lib/score-client.ts"], bundle: true, platform: "browser", format: "iife", globalName: "DirectScoresProbe", write: false });
const server = http.createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Browser CDN probe</title>"); });
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = process.env.BASE_ORIGIN || `http://127.0.0.1:${server.address().port}`;
const output = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim(),
  startedUtc: new Date().toISOString(), date, endDate, origin: new URL(origin).origin, engines: [],
  limitations: ["Fresh desktop contexts, not an installed phone.", "Primary requests forced to fail; CDN is live. This tests the checkout's score client, not deployed client identity.", "No subscription or notification requests are allowed."],
};
try {
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage(), requests = [], responses = []; let hostedRequests = 0;
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.hostname === "site.api.espn.com") return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        if (url.pathname === "/api/scores") { hostedRequests++; return route.abort(); }
        if (url.hostname === "cdn.espn.com") return route.continue();
        // Supply a neutral document at the selected origin without loading its app.
        if (route.request().isNavigationRequest() && url.origin === new URL(origin).origin) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Browser CDN probe</title>" });
        return route.abort();
      });
      page.on("request", request => { if (new URL(request.url()).hostname === "cdn.espn.com") requests.push(request.url()); });
      page.on("response", response => { if (new URL(response.url()).hostname === "cdn.espn.com") responses.push({ url: response.url(), status: response.status(), allowOrigin: response.headers()["access-control-allow-origin"] || null }); });
      await page.goto(origin); await page.addScriptTag({ content: compiled.outputFiles[0].text });
      const result = await page.evaluate(async ({ date, endDate }) => {
        try {
          const board = await DirectScoresProbe.loadScores(date, new AbortController().signal, fetch, endDate);
          return { success: true, date: board.date, endDate: board.endDate || board.date, stale: !!board.stale, warnings: board.warnings || [], games: board.games.map(game => ({ id: game.id, date: game.date, state: game.state })) };
        } catch (error) { return { success: false, error: error.message }; }
      }, { date, endDate });
      output.engines.push({ name, browserVersion: browser.version(), requests, responses, hostedRequests, result });
    } finally { await browser.close(); }
  }
} finally { server.close(); output.completedUtc = new Date().toISOString(); console.log(JSON.stringify(output, null, 2)); }
for (const probe of output.engines) {
  assert.equal(probe.hostedRequests, 0); assert.equal(probe.result.success, true);
  assert.equal(probe.result.date, date); assert.equal(probe.result.endDate, endDate);
  assert.equal(probe.result.stale, false); assert.deepEqual(probe.result.warnings, []);
  assert.ok(probe.responses.length > 0); assert.ok(probe.responses.every(response => response.status === 200 && response.allowOrigin === "*"));
}
