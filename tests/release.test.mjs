import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRelease } from "../scripts/check-release.mjs";
import { readAlertConfig, verifyDeployment } from "../scripts/verify-deployment.mjs";

test("rollout preflight executes and records success under a path containing # and %", t => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "rollout-#%-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "scripts"));
  mkdirSync(join(cwd, "public"));
  const script = join(cwd, "scripts", "check-alert-preferences-rollout.mjs");
  copyFileSync(new URL("../scripts/check-alert-preferences-rollout.mjs", import.meta.url), script);
  writeFileSync(join(cwd, "public", "alerts-config.json"), JSON.stringify({ serviceUrl: "https://example.invalid" }));
  const mock = "globalThis.fetch=async()=>Response.json({preferencesVersion:1,preferencesCutoverComplete:true})";
  const result = execFileSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`, script], { encoding: "utf8" });
  assert.match(result, /Alert preference cutover is complete/);
});

test("release configuration accepts JSONC comments and trailing commas but rejects malformed origins", () => {
  const source = '{ // Allowed by Wrangler\n "vars": { "SITE_ORIGIN": "https://old.test", }, }';
  assert.equal(readAlertConfig(source).vars.SITE_ORIGIN, "https://old.test");
  for (const invalid of ['{"vars":', '{"vars":{}}', '{"vars":{"SITE_ORIGIN":"https://old.test/path"}}'])
    assert.throws(() => readAlertConfig(invalid));
  assert.ok(readAlertConfig().vars.SITE_ORIGIN);
});

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "release-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Release Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  mkdirSync(join(cwd, "lib"));
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "1.2.0" }));
  writeFileSync(join(cwd, "package-lock.json"), JSON.stringify({ version: "1.2.0", packages: { "": { version: "1.2.0" } } }));
  writeFileSync(join(cwd, "lib/releases.ts"), 'export const VERSION = "1.2.0";');
  writeFileSync(join(cwd, "CHANGELOG.md"), "## 1.2.0 · 2026-09-06\n");
  git("add", "."); git("commit", "-m", "fixture"); git("tag", "v1.2.0");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return { cwd, git };
}

test("release gate accepts only the clean tagged version reachable from main", t => {
  const { cwd, git } = repository(t);
  assert.deepEqual(checkRelease("v1.2.0", cwd), { tag: "v1.2.0", version: "1.2.0", commit: git("rev-parse", "HEAD") });
  for (const tag of ["main", "v1.2.0-beta", "--help", "v1.2.0;echo bad"]) assert.throws(() => checkRelease(tag, cwd));
  writeFileSync(join(cwd, "unexpected.txt"), "uncommitted");
  assert.throws(() => checkRelease("v1.2.0", cwd), /clean/);
  git("add", "."); git("commit", "-m", "unmerged change"); git("tag", "v1.2.1");
  assert.throws(() => checkRelease("v1.2.0", cwd), /Checkout/);
  assert.throws(() => checkRelease("v1.2.1", cwd));
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.throws(() => checkRelease("v1.2.1", cwd), /versions disagree/);
});

test("deployment verification detects wrong code, broken assets, stale scores and rejected alert origins", async () => {
  const commit = "a".repeat(40), origin = "https://app.test", alertsUrl = "https://alerts.test", version = "1.2.0";
  let failure;
  const requested = [];
  const fetcher = async (url, options) => {
    requested.push([url, options.method || "GET"]);
    const path = new URL(url).pathname;
    if (path === "/api/health") return Response.json({ version, commit: failure === "commit" ? "b".repeat(40) : commit });
    if (path === "/") return new Response("Saturday Signal");
    if (path === "/manifest.webmanifest") return Response.json({ start_url: "/" });
    if (path === "/sw.js") return new Response("self.addEventListener('push', () => {})", { headers: { "content-type": failure === "assets" ? "text/html" : "application/javascript" } });
    if (path === "/api/scores") {
      const date = new URL(url).searchParams.get("date");
      return Response.json({ date, endDate: date, fetchedAt: new Date().toISOString(), games: [], stale: failure === "scores" });
    }
    if (path === "/config") return Response.json({ version, ready: true }, { headers: { "access-control-allow-origin": failure === "origin" ? "https://other.test" : options.headers.Origin } });
    throw new Error(`Unexpected request: ${url}`);
  };
  const options = { origin, commit, version, fetcher, alertsUrl, alertOrigins: [origin, "https://old.test"] };
  await verifyDeployment(options);
  assert.equal(requested.filter(([url]) => url.endsWith("/config")).length, 2);
  assert.ok(requested.every(([, method]) => method === "GET"), "Smoke test must not write or send notifications");
  for (failure of ["commit", "assets", "scores", "origin"]) await assert.rejects(() => verifyDeployment(options));
});
