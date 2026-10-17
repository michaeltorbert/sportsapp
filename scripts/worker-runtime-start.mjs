// One owned `wrangler dev` attempt. Wrangler binds --port 0 itself and reports the
// endpoint as JSON-text DEV_SERVER_READY on this child's own IPC channel, so a
// foreign listener can never stand in for it. No retries: the first failure is the verdict.
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { stopOwnedGroup } from "./owned-process-group.mjs";

const firstLine = error => String(error?.message ?? error).replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 200);
const probe = port => new Promise(resolve => {
  const socket = connect({ host: "127.0.0.1", port });
  socket.setTimeout(1000);
  socket.once("connect", () => { socket.destroy(); resolve("accepted"); });
  socket.once("timeout", () => { socket.destroy(); resolve("timeout"); });
  socket.once("error", error => resolve(error.code ?? "error"));
});

// `port` exists only so tests can inject an occupied port; the runtime path always uses 0.
export function startWorkerRuntime({ cwd, env, port = 0, readyTimeoutMs = 90000, bin = "node_modules/wrangler/bin/wrangler.js", config = "dist/server/wrangler.json" }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid runtime port option: ${port}`);
  const started = Date.now(), ms = () => Date.now() - started;
  // Bounded, allowlisted attempt evidence: no child output, only states, codes and timings.
  const attempt = { startedAt: new Date(started).toISOString(), requestedPort: port, pid: null, readyMessages: 0, otherMessages: 0, ready: null, exit: null, failure: null, cleanup: null };
  let endpoint = null, fault = null, stopping = false, stopped = null, output = "", rejectFault, resolveReady;
  const faulted = new Promise((_, reject) => { rejectFault = reject; });
  faulted.catch(() => {});
  const ready = new Promise(resolve => { resolveReady = resolve; });
  // Our own teardown's exit/disconnect is cleanup, never a replacement failure.
  const fail = (kind, error) => {
    if (fault || stopping) return;
    fault = error; clearTimeout(deadline); clearTimeout(disconnected);
    attempt.failure = { kind, ms: ms(), name: error.name, code: error.code, message: firstLine(error) };
    rejectFault(error);
  };
  const child = spawn(process.execPath, [bin, "dev", "--config", config, "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  attempt.pid = child.pid ?? null;
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", data => { output = (output + data).slice(-12000); });
  const deadline = setTimeout(() => fail("ready-deadline", new Error(`Worker runtime was not ready within ${readyTimeoutMs} ms`)), readyTimeoutMs);
  child.on("error", error => fail("spawn-error", error));
  let disconnected;
  child.on("exit", (code, signal) => {
    clearTimeout(disconnected); attempt.exit = { code, signal, ms: ms() };
    fail(endpoint ? "exit-after-ready" : "exit-before-ready", new Error(`Worker runtime exited ${endpoint ? "after" : "before"} readiness (code ${code}, signal ${signal})`));
  });
  // A dying child closes IPC just before its exit event; give the more specific exit a bounded moment.
  child.on("disconnect", () => {
    attempt.disconnectMs = ms();
    disconnected = setTimeout(() => fail("ipc-disconnect", new Error("Worker runtime IPC channel disconnected")), 500);
  });
  child.on("message", message => {
    let data;
    try { data = JSON.parse(message); } catch { return fail("invalid-message", new Error("Worker runtime sent a non-JSON IPC message")); }
    if (data?.event !== "DEV_SERVER_READY") { attempt.otherMessages++; return; }
    attempt.readyMessages++;
    const { ip, port: readyPort } = data;
    if (ip !== "127.0.0.1" || !Number.isInteger(readyPort) || readyPort < 1 || readyPort > 65535 || (port !== 0 && readyPort !== port)) {
      return fail("invalid-ready", new Error(`Invalid DEV_SERVER_READY endpoint ${String(ip).slice(0, 40)}:${String(readyPort).slice(0, 10)}`));
    }
    if (endpoint) {
      if (readyPort !== endpoint.port) fail("endpoint-changed", new Error(`Worker runtime endpoint changed from ${endpoint.port} to ${readyPort}`));
      return;
    }
    endpoint = { ip, port: readyPort }; attempt.ready = { ...endpoint, ms: ms() };
    clearTimeout(deadline); resolveReady(endpoint);
  });
  // Races work against spawn error, exit, IPC disconnect, invalid/changed readiness and the deadline.
  const during = promise => Promise.race([promise, faulted]);
  return {
    child, attempt, ready, during,
    output: () => output,
    onFault: handler => { faulted.catch(handler); },
    assertAlive() {
      if (fault) throw fault;
      if (!endpoint || child.exitCode !== null || child.signalCode !== null || !child.connected) throw new Error("Worker runtime is not alive at its ready endpoint");
    },
    stop: () => stopped ??= (async () => {
      stopping = true; clearTimeout(deadline); clearTimeout(disconnected);
      const cleanup = child.pid ? await stopOwnedGroup(child.pid) : { gone: true, skipped: "not spawned" };
      // Supplementary only: the ready port should refuse once the owned group is gone.
      if (endpoint) cleanup.readyPortAfterCleanup = await probe(endpoint.port);
      attempt.cleanup = cleanup;
      return cleanup;
    })(),
  };
}
