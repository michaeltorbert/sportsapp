import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ServerExitReporter from "./browser/server-exit-reporter.mjs";
import { anomalyText, readServerState, recordUnavailable, serverFailureMessage } from "../scripts/browser-server-diagnostics.mjs";

const supervisor = resolve("scripts/browser-test-server.mjs");
// Playwright runs webServer.command through a POSIX shell; quote each argv token.
const shellQuote = arg => "'" + arg.replaceAll("'", "'\\''") + "'";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await pause(25);
  }
  throw new Error("Timed out waiting for supervised state");
}

function launch(directory, runId, code) {
  const fake = join(directory, "fake-server.mjs");
  writeFileSync(fake, code);
  const child = spawn(process.execPath, [supervisor, "--", process.execPath, fake], {
    env: { ...process.env, BROWSER_TEST_RUN_ID: runId, BROWSER_TEST_STATE_DIR: join(directory, "evidence") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

test("unexpected server exit keeps first anomaly, resources, and a failing status", async t => {
  const dir = mkdtempSync(join(tmpdir(), "browser-server-exit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "evidence"));
  writeFileSync(join(dir, "evidence/state.json"), JSON.stringify({ runId: "stale", phase: "exited" }));
  const child = launch(dir, "current", `process.stderr.write('Broken pipe without newline'); setTimeout(() => process.exit(3), 100);`);
  const [code] = await once(child, "close");
  assert.equal(code, 3);
  const state = readServerState(join(dir, "evidence"), "current");
  assert.equal(state.phase, "exited");
  assert.equal(state.exit.code, 3);
  assert.equal(state.firstAnomaly.line, "Broken pipe without newline");
  assert.match(serverFailureMessage(state), /code 3/);
  assert.match(serverFailureMessage(state), /first stderr anomaly/);
  assert.match(readFileSync(join(dir, "evidence/wrangler-stdio.jsonl"), "utf8"), /Broken pipe without newline/);
  assert.match(JSON.stringify(state.exit.tail), /Broken pipe without newline/);
  assert.match(readFileSync(join(dir, "evidence/resources.jsonl"), "utf8"), /unexpected-exit/);
  assert.equal(readServerState(join(dir, "evidence"), "stale"), null);
});

test("ANSI-colored Wrangler error is the first anomaly without losing raw stderr", async t => {
  const dir = mkdtempSync(join(tmpdir(), "browser-server-ansi-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const line = "\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1m\x1b[0m";
  const child = launch(dir, "ansi", `process.stderr.write(${JSON.stringify(`${line}\n\nIf you think this is a bug\n`)}); process.exit(1);`);
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  const state = readServerState(join(dir, "evidence"), "ansi");
  assert.equal(state.firstAnomaly.stream, "stderr");
  assert.equal(state.firstAnomaly.line, line);
  assert.equal(state.firstAnomaly.text, "✘ [ERROR] ");
  assert.equal(anomalyText(line), "✘ [ERROR] ");
  assert.equal(anomalyText("\x1b[31mUncaught\x1b[0m exception"), "Uncaught exception");
  assert.equal(anomalyText("ordinary output"), null);
  assert.equal(anomalyText(""), null);
  const message = serverFailureMessage(state);
  assert.match(message, /first stderr anomaly.*\[ERROR\]/);
  assert.doesNotMatch(message, /\x1b/);
  assert.equal(state.exit.code, 1);
  const samples = readFileSync(join(dir, "evidence/resources.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const firstIndex = samples.findIndex(sample => sample.reason === "first-anomaly");
  const exitIndex = samples.findIndex(sample => sample.reason === "unexpected-exit");
  assert.ok(firstIndex >= 0 && exitIndex > firstIndex);
});

test("a failed fixture health request stops a shard even while Wrangler remains alive", async t => {
  const dir = mkdtempSync(join(tmpdir(), "browser-health-failure-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = { runId: "unavailable", phase: "running", directory: dir };
  writeFileSync(join(dir, "state.json"), JSON.stringify(state));
  const marker = recordUnavailable(dir, "unavailable", "connect ECONNREFUSED 127.0.0.1:4178");
  assert.equal(marker.reason, "connect ECONNREFUSED 127.0.0.1:4178");
  assert.equal(recordUnavailable(dir, "unavailable", "later failure").reason, marker.reason);
  const prior = process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT;
  process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT = "1";
  t.after(() => { if (prior === undefined) delete process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT; else process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT = prior; });
  let signals = 0;
  const reporter = new ServerExitReporter({ signal: () => { signals++; }, pollMs: 10 });
  reporter.onBegin({ metadata: { serverDiagnosticsDir: dir, browserRunId: "unavailable" } });
  await until(() => signals === 1);
  assert.deepEqual(reporter.onEnd(), { status: "failed" });
  assert.equal(readServerState(dir, "unavailable").phase, "running");
});

test("parent exit is recorded before a descendant releases inherited stdio", async t => {
  const dir = mkdtempSync(join(tmpdir(), "browser-server-inherited-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const child = launch(dir, "inherited", `import { spawn } from 'node:child_process';\nspawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'inherit' });\nsetTimeout(() => process.exit(7), 100);`);
  const started = Date.now();
  const state = await until(() => {
    const current = readServerState(join(dir, "evidence"), "inherited");
    return current?.phase === "exited" ? current : null;
  });
  assert.equal(state.exit.code, 7);
  assert.ok(Date.now() - started < 3000, "the parent exit must be available before the descendant releases stdio");
  const [code] = await once(child, "close");
  assert.equal(code, 7);
});

test("normal supervisor teardown is marked before the child stops", async t => {
  const dir = mkdtempSync(join(tmpdir(), "browser-server-stop-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const child = launch(dir, "normal", `console.log('READY'); process.on('SIGTERM', () => process.exit(143)); setInterval(() => {}, 1000);`);
  await until(() => readServerState(join(dir, "evidence"), "normal")?.serverPid);
  child.kill("SIGTERM");
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  const state = readServerState(join(dir, "evidence"), "normal");
  assert.equal(state.phase, "stopping");
  assert.ok(state.stoppedAt);
  assert.equal(state.exit, undefined);
});

test("reporter signals once on confirmed exit and reports failure, not on normal teardown", async t => {
  const dir = mkdtempSync(join(tmpdir(), "browser-reporter-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prior = process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT;
  process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT = "1";
  t.after(() => { if (prior === undefined) delete process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT; else process.env.BROWSER_TEST_STOP_ON_SERVER_EXIT = prior; });
  let signals = 0;
  const reporter = new ServerExitReporter({ signal: () => { signals++; }, pollMs: 10 });
  reporter.onBegin({ metadata: { serverDiagnosticsDir: dir, browserRunId: "reporter" } });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ runId: "other", phase: "exited", exit: { utc: "now", code: 3 }, directory: dir }));
  await pause(30);
  assert.equal(signals, 0);
  writeFileSync(join(dir, "state.json"), JSON.stringify({ runId: "reporter", phase: "exited", exit: { utc: "now", code: 3 }, directory: dir }));
  await until(() => signals === 1);
  assert.deepEqual(reporter.onEnd(), { status: "failed" });
  await pause(30);
  assert.equal(signals, 1);

  const normal = new ServerExitReporter({ signal: () => { signals++; }, pollMs: 10 });
  normal.onBegin({ metadata: { serverDiagnosticsDir: dir, browserRunId: "normal" } });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ runId: "normal", phase: "stopping", directory: dir }));
  await pause(30);
  assert.equal(normal.onEnd(), undefined);
  assert.equal(signals, 1);
});

test("Playwright stops after the first supervised server exit", async t => {
  const root = resolve("output/playwright");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "fault with space and 'quote-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Force both command paths to contain spaces and an apostrophe even in CI.
  const scripts = join(dir, "scripts with space");
  symlinkSync(resolve("scripts"), scripts, "dir");
  const spacedSupervisor = join(scripts, "browser-test-server.mjs");
  const runId = "fault-injection";
  const evidence = join(dir, "server");
  const marker = join(dir, "second-test-ran");
  const fake = join(dir, "fake-server.mjs");
  for (const path of [spacedSupervisor, fake]) {
    assert.match(path, / /);
    assert.match(path, /'/);
  }
  writeFileSync(fake, `console.log('READY'); setTimeout(() => process.exit(3), 1500);\n`);
  const spec = join(dir, "fault.spec.mjs");
  writeFileSync(spec, `import { test } from '@playwright/test';\nimport { writeFileSync } from 'node:fs';\ntest('waits while server crashes', async () => { await new Promise(resolve => setTimeout(resolve, 10000)); });\ntest('must not run after crash', async () => { writeFileSync(${JSON.stringify(marker)}, 'ran'); });\n`);
  const command = [process.execPath, spacedSupervisor, "--", process.execPath, fake].map(shellQuote).join(" ");
  const config = join(dir, "playwright.config.mjs");
  writeFileSync(config, `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: ${JSON.stringify(dir)}, testMatch: 'fault.spec.mjs', outputDir: ${JSON.stringify(join(dir, "results"))}, workers: 1, retries: 0, timeout: 15000, reporter: [['list'], [${JSON.stringify(resolve("tests/browser/server-exit-reporter.mjs"))}]], metadata: { browserRunId: ${JSON.stringify(runId)}, serverDiagnosticsDir: ${JSON.stringify(evidence)} }, webServer: { command: ${JSON.stringify(command)}, wait: { stdout: /READY/ }, timeout: 10000, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }, env: { BROWSER_TEST_RUN_ID: ${JSON.stringify(runId)}, BROWSER_TEST_STATE_DIR: ${JSON.stringify(evidence)} } } });\n`);
  const runner = spawn(process.execPath, [resolve("node_modules/playwright/cli.js"), "test", "--config", config], {
    cwd: resolve("."),
    env: { ...process.env, BROWSER_TEST_STOP_ON_SERVER_EXIT: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  runner.stdout.on("data", chunk => { output += chunk; });
  runner.stderr.on("data", chunk => { output += chunk; });
  const timer = setTimeout(() => runner.kill("SIGTERM"), 20000);
  const [code] = await once(runner, "close");
  clearTimeout(timer);
  assert.equal(code, 1, output);
  assert.match(output, /Local Wrangler server exited unexpectedly/);
  assert.equal(readServerState(evidence, runId)?.exit?.code, 3);
  assert.throws(() => readFileSync(marker), /ENOENT/, "the next test body must never run");
});
