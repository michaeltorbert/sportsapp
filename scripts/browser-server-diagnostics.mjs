import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

export function readServerState(directory, runId) {
  try {
    const state = JSON.parse(readFileSync(join(directory, "state.json"), "utf8"));
    return state.runId === runId ? state : null;
  } catch {
    // The server may not have started yet, or a writer may be replacing state.
    return null;
  }
}

export function writeServerState(directory, state) {
  const temp = join(directory, `state-${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(state, null, 2));
  renameSync(temp, join(directory, "state.json"));
}

function readOptional(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function optional(call) {
  try { return call(); } catch { return null; }
}

function processState(pid) {
  if (!pid || process.platform !== "linux") return null;
  const status = readOptional(`/proc/${pid}/status`);
  if (!status) return null;
  const fields = Object.fromEntries(status.split("\n").filter(line => /^(Name|State|VmRSS|VmHWM|Threads):/.test(line)).map(line => {
    const index = line.indexOf(":");
    return [line.slice(0, index), line.slice(index + 1).trim()];
  }));
  try { fields.openFds = readdirSync(`/proc/${pid}/fd`).length; } catch { fields.openFds = null; }
  return fields;
}

export function resourceSnapshot(pid) {
  const snapshot = {
    utc: new Date().toISOString(),
    system: { freeBytes: optional(() => os.freemem()), totalBytes: optional(() => os.totalmem()), loadAverage: optional(() => os.loadavg()), uptimeSeconds: optional(() => os.uptime()) },
    process: processState(pid),
  };
  if (process.platform === "linux") {
    snapshot.linux = {
      meminfo: readOptional("/proc/meminfo")?.split("\n").filter(line => /^(MemAvailable|MemFree|SwapFree|SwapTotal):/.test(line)),
      memoryPressure: readOptional("/proc/pressure/memory"),
      cpuPressure: readOptional("/proc/pressure/cpu"),
      cgroupMemoryCurrent: readOptional("/sys/fs/cgroup/memory.current")?.trim(),
      cgroupMemoryMax: readOptional("/sys/fs/cgroup/memory.max")?.trim(),
      cgroupMemoryEvents: readOptional("/sys/fs/cgroup/memory.events"),
    };
  }
  return snapshot;
}

export function appendEvidence(directory, filename, record) {
  if (!existsSync(directory)) return;
  appendFileSync(join(directory, filename), `${JSON.stringify(record)}\n`);
}

export function serverFailureMessage(state) {
  const exit = state?.exit;
  if (!exit) return null;
  const reason = exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
  const anomaly = state.firstAnomaly ? `; first stderr anomaly ${state.firstAnomaly.utc}: ${state.firstAnomaly.line}` : "";
  return `Local Wrangler server exited unexpectedly at ${exit.utc} (${reason})${anomaly}. Diagnostics: ${state.directory}`;
}
