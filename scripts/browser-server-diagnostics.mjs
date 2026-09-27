import { appendFileSync, existsSync, linkSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

export function readUnavailable(directory, runId) {
  try {
    const unavailable = JSON.parse(readFileSync(join(directory, "first-unavailable.json"), "utf8"));
    return unavailable.runId === runId ? unavailable : null;
  } catch { return null; }
}

export function writeServerState(directory, state) {
  const temp = join(directory, `state-${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(state, null, 2));
  renameSync(temp, join(directory, "state.json"));
}

export function recordUnavailable(directory, runId, reason, serverPid) {
  const existing = readUnavailable(directory, runId);
  if (existing) return existing;
  const unavailable = { runId, utc: new Date().toISOString(), reason, resources: resourceSnapshot(serverPid) };
  const temp = join(directory, `unavailable-${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(unavailable, null, 2));
  try {
    // Keep the first failure when local runs have two workers racing here.
    linkSync(temp, join(directory, "first-unavailable.json"));
    return unavailable;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readUnavailable(directory, runId) || unavailable;
  } finally { unlinkSync(temp); }
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
  const anomaly = state.firstAnomaly ? `; first ${state.firstAnomaly.stream} anomaly ${state.firstAnomaly.utc}: ${state.firstAnomaly.line}` : "";
  return `Local Wrangler server exited unexpectedly at ${exit.utc} (${reason})${anomaly}. Diagnostics: ${state.directory}`;
}

export function unavailableMessage(unavailable, directory) {
  return `Local Worker health request failed at ${unavailable.utc} without a recorded Wrangler exit (${unavailable.reason}). Diagnostics: ${directory}`;
}
