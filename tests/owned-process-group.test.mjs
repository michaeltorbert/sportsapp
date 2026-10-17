import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepFirstFailure, stopOwnedGroup } from "../scripts/owned-process-group.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { try { const value = check(); if (value) return value; } catch { /* Not yet. */ } await pause(20); }
  throw new Error("Timed out waiting for process state");
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };

test("a descendant ignoring SIGTERM is killed after its group leader already exited", async t => {
  const dir = mkdtempSync(join(tmpdir(), "owned-group-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pidFile = join(dir, "descendant.pid");
  const descendant = `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const leader = spawn(process.execPath, ["-e", `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" }); setTimeout(() => process.exit(0), 50);`], { detached: true, stdio: "ignore" });
  const [code] = await once(leader, "exit");
  assert.equal(code, 0);
  const pid = Number(await until(() => readFileSync(pidFile, "utf8")));
  t.after(() => { try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ } });
  assert.equal(alive(pid), true, "the descendant outlives its exited leader");
  const result = await stopOwnedGroup(leader.pid, { graceMs: 300, killMs: 2000 });
  assert.equal(result.gone, true, JSON.stringify(result));
  assert.deepEqual(result.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(result.error, undefined);
  assert.equal(alive(pid), false);
  // Idempotent: a gone group is not signaled again.
  assert.deepEqual((await stopOwnedGroup(leader.pid)).signals, []);
});

test("groups this invocation did not start are never signaled", async () => {
  for (const pgid of [undefined, 0, 1, -5, process.pid]) {
    const result = await stopOwnedGroup(pgid);
    assert.equal(result.gone, false);
    assert.deepEqual(result.signals, []);
    assert.match(result.error.message, /Not an owned process group/);
  }
});

test("the first failure outranks capture and cleanup failures, and cleanup still runs", async t => {
  const original = new Error("health truncated mid-body");
  const logged = [];
  const error = t.mock.method(console, "error", line => { logged.push(line); });
  let cleaned = false;
  await assert.rejects(keepFirstFailure(async () => { throw original; }, {
    capture: async () => { throw new Error("screenshot failed"); },
    cleanup: async failed => { cleaned = failed; throw new Error("group survived"); },
  }), rejected => rejected === original);
  error.mock.restore();
  assert.equal(cleaned, true);
  assert.match(logged.join("\n"), /not captured: screenshot failed/);
  assert.match(logged.join("\n"), /Cleanup also failed: group survived/);
});

test("a cleanup failure fails an otherwise successful run", async () => {
  await assert.rejects(keepFirstFailure(async () => "ok", { cleanup: async () => { throw new Error("group survived"); } }), /group survived/);
  assert.equal(await keepFirstFailure(async () => "ok"), "ok");
});
