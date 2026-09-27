import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { appendEvidence, resourceSnapshot, writeServerState } from "./browser-server-diagnostics.mjs";

const separator = process.argv.indexOf("--");
if (separator < 0 || separator === process.argv.length - 1) throw new Error("Usage: browser-test-server.mjs -- <command> [args]");
const command = process.argv.slice(separator + 1);
const directory = resolve(process.env.BROWSER_TEST_STATE_DIR || "output/playwright/server");
const runId = process.env.BROWSER_TEST_RUN_ID;
if (!runId) throw new Error("BROWSER_TEST_RUN_ID is required");

rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const child = spawn(command[0], command.slice(1), { stdio: ["ignore", "pipe", "pipe"], detached: true, env: process.env });
const state = { runId, directory, phase: "running", startedAt: new Date().toISOString(), supervisorPid: process.pid, serverPid: child.pid };
const tail = [];
const pending = { stdout: "", stderr: "" };
let stopping = false;
let done = false;
let forceTimer;
let drainTimer;

function sample(reason) {
  appendEvidence(directory, "resources.jsonl", { reason, ...resourceSnapshot(child.pid) });
}
sample("start");
const sampler = setInterval(() => sample("interval"), 2000);
sampler.unref();

function killGroup(signal) {
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") process.stderr.write(`Server group ${signal}: ${error.message}\n`); }
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (!state.exit) {
    state.phase = "stopping";
    state.stoppingAt = new Date().toISOString();
    state.stopSignal = signal;
  } else {
    state.cleanupRequestedAt = new Date().toISOString();
  }
  writeServerState(directory, state);
  clearInterval(sampler);
  killGroup(signal);
  forceTimer = setTimeout(() => killGroup("SIGKILL"), 4000);
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

function recordLine(stream, line) {
  const record = { utc: new Date().toISOString(), stream, line };
  appendEvidence(directory, "wrangler-stdio.jsonl", record);
  tail.push(record);
  if (tail.length > 200) tail.shift();
  if (!state.firstAnomaly && /broken pipe|disconnected|\[ERROR\]|uncaught|segmentation|out of memory/i.test(line)) {
    state.firstAnomaly = record;
    writeServerState(directory, state);
    sample("first-anomaly");
  }
}

function flushPending(stream) {
  if (!pending[stream]) return;
  recordLine(stream, pending[stream]);
  pending[stream] = "";
}

for (const stream of ["stdout", "stderr"]) {
  child[stream].on("data", chunk => {
    process[stream].write(chunk);
    pending[stream] += chunk.toString("utf8");
    const lines = pending[stream].split(/\r?\n/);
    pending[stream] = lines.pop();
    for (const line of lines) recordLine(stream, line);
  });
  child[stream].on("end", () => flushPending(stream));
}

function recordUnexpectedExit(code, signal, spawnError) {
  if (state.exit || stopping) return;
  clearInterval(sampler);
  sample("unexpected-exit");
  state.phase = "exited";
  state.exit = { utc: new Date().toISOString(), code, signal, ...(spawnError ? { spawnError } : {}), tail: [...tail] };
  writeServerState(directory, state);
  process.stderr.write(`[browser-test-server] Unexpected Wrangler exit (${spawnError || signal || code}); diagnostics: ${directory}\n`);
  process.exitCode = code || 70;
  // A descendant can inherit stdio after Wrangler exits. Record the exit now,
  // then give final stderr a brief chance to drain before ending its group.
  drainTimer = setTimeout(() => {
    killGroup("SIGKILL");
    flushPending("stdout");
    flushPending("stderr");
    child.stdout.destroy();
    child.stderr.destroy();
  }, 1000);
}
child.on("error", error => recordUnexpectedExit(null, null, error.message));
child.on("exit", (code, signal) => recordUnexpectedExit(code, signal));
child.on("close", (code, signal) => {
  if (done) return;
  done = true;
  clearInterval(sampler);
  clearTimeout(forceTimer);
  clearTimeout(drainTimer);
  flushPending("stdout");
  flushPending("stderr");
  if (state.exit) {
    state.exit.tail = [...tail];
    state.exit.stdioClosedAt = new Date().toISOString();
    writeServerState(directory, state);
    killGroup("SIGKILL");
    process.exitCode = state.exit.code || 70;
  } else if (stopping) {
    state.stoppedAt = new Date().toISOString();
    writeServerState(directory, state);
    process.exitCode = 0;
  } else {
    recordUnexpectedExit(code, signal);
    killGroup("SIGKILL");
    clearTimeout(drainTimer);
  }
});
process.on("exit", () => { if (!done) killGroup("SIGKILL"); });
// Publish readiness only after signal and child handlers are installed. A test
// or Playwright teardown can otherwise signal us between state creation and
// registering the handler, orphaning the detached server process group.
writeServerState(directory, state);
