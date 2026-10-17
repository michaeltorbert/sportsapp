// Cleanup for detached children this invocation spawned. Each one leads its own
// process group (pgid === child pid), so descendants are reached even after the
// leader has exited. Never signals by process name or any group it did not start.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const firstLine = error => String(error?.message ?? error).replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 200);

function groupAlive(pgid) {
  try { process.kill(-pgid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

// SIGTERM, then a bounded SIGKILL, then observed disappearance. Never throws or hangs;
// a survivor or signaling problem is returned as result.error for the caller to report.
export async function stopOwnedGroup(pgid, { graceMs = 3000, killMs = 2000, pollMs = 50 } = {}) {
  const started = Date.now(), result = { pgid, signals: [], gone: false };
  const waitGone = async limit => {
    for (const end = Date.now() + limit; groupAlive(pgid);) { if (Date.now() >= end) return false; await pause(pollMs); }
    return true;
  };
  try {
    if (!Number.isInteger(pgid) || pgid <= 1 || pgid === process.pid) throw new Error(`Not an owned process group: ${pgid}`);
    for (const [signal, limit] of [["SIGTERM", graceMs], ["SIGKILL", killMs]]) {
      if (!groupAlive(pgid)) break;
      try { process.kill(-pgid, signal); result.signals.push(signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
      if (await waitGone(limit)) break;
    }
    result.gone = !groupAlive(pgid);
    if (!result.gone) throw new Error(`Process group ${pgid} survived SIGKILL`);
  } catch (error) {
    result.error = { code: error.code, message: firstLine(error) };
  }
  result.ms = Date.now() - started;
  return result;
}

// The first failure is the verdict. Evidence capture and cleanup problems are
// reported beside it and never replace it; cleanup always runs.
export async function keepFirstFailure(work, { capture = async () => {}, cleanup = async () => {} } = {}) {
  let failed = false;
  try {
    return await work();
  } catch (error) {
    failed = true;
    try { await capture(error); } catch (captureError) { console.error(`Failure evidence was not captured: ${firstLine(captureError)}`); }
    throw error;
  } finally {
    try { await cleanup(failed); } catch (cleanupError) {
      if (!failed) throw cleanupError;
      console.error(`Cleanup also failed: ${firstLine(cleanupError)}`);
    }
  }
}
