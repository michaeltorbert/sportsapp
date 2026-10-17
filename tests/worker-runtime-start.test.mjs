import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorkerRuntime } from "../scripts/worker-runtime-start.mjs";

const identity = { version: "9.9.9", commit: "c".repeat(40) };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const groupGone = pgid => { try { process.kill(-pgid, 0); return false; } catch (error) { return error.code === "ESRCH"; } };

// A fake `wrangler` bin: records each invocation, then runs the given body with
// `port` from argv. It never contacts anything but its own loopback listener.
function fakeBin(t, body) {
  const dir = mkdtempSync(join(tmpdir(), "worker-runtime-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "fake-wrangler.mjs"), invocations = join(dir, "invocations");
  writeFileSync(invocations, "");
  writeFileSync(bin, `import { appendFileSync } from "node:fs";\nimport { createServer } from "node:http";\nappendFileSync(${JSON.stringify(invocations)}, "run\\n");\nconst port = Number(process.argv[process.argv.indexOf("--port") + 1]);\nconst send = message => process.send(typeof message === "string" ? message : JSON.stringify(message));\n${body}\n`);
  return { bin, dir, invocations: () => readFileSync(invocations, "utf8").split("\n").filter(Boolean).length };
}
const serveIdentity = `const server = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(${JSON.stringify(JSON.stringify(identity))}); });`;
async function start(t, options) {
  const runtime = startWorkerRuntime({ cwd: process.cwd(), env: process.env, readyTimeoutMs: 5000, ...options });
  t.after(() => runtime.stop());
  return runtime;
}

test("own IPC readiness names the endpoint; teardown is cleanup, not failure", async t => {
  const fake = fakeBin(t, `${serveIdentity}\nserver.listen(port, "127.0.0.1", () => send({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: server.address().port }));`);
  const runtime = await start(t, { bin: fake.bin });
  const { port } = await runtime.during(runtime.ready);
  assert.ok(port > 0);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(), identity);
  runtime.assertAlive();
  const cleanup = await runtime.stop();
  assert.equal(cleanup.gone, true);
  assert.equal(cleanup.readyPortAfterCleanup, "ECONNREFUSED");
  assert.equal(runtime.attempt.failure, null, "intentional teardown never becomes the verdict");
  assert.equal(runtime.attempt.requestedPort, 0);
  assert.equal(fake.invocations(), 1);
});

test("an occupied port held by a matching-health foreign server cannot pass and stays alive", async t => {
  let foreignRequests = 0;
  const foreign = createServer((req, res) => { foreignRequests++; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(identity)); });
  foreign.listen(0, "127.0.0.1"); await once(foreign, "listening");
  t.after(() => { foreign.closeAllConnections(); foreign.close(); });
  const occupied = foreign.address().port;
  // Mirrors a bind conflict: the child reports the error and exits without readiness.
  const fake = fakeBin(t, `${serveIdentity}\nserver.on("error", error => { console.error("✘ [ERROR] Address already in use " + error.code); process.exit(1); });\nserver.listen(port, "127.0.0.1", () => send({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port }));`);
  const runtime = await start(t, { bin: fake.bin, port: occupied });
  await assert.rejects(runtime.during(runtime.ready), /exited before readiness \(code 1/);
  assert.equal(runtime.attempt.failure.kind, "exit-before-ready");
  assert.equal(runtime.attempt.ready, null);
  const cleanup = await runtime.stop();
  assert.equal(cleanup.gone, true);
  await pause(200);
  assert.equal(fake.invocations(), 1, "exactly one attempt, no retry");
  assert.equal(foreignRequests, 0, "the foreign owner is never contacted");
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${occupied}/api/health`)).json(), identity, "the foreign owner is still alive");
});

test("a live child without own readiness is never accepted, even beside matching foreign health", async t => {
  const fake = fakeBin(t, `setInterval(() => {}, 1000);`);
  const runtime = await start(t, { bin: fake.bin, readyTimeoutMs: 300 });
  await assert.rejects(runtime.during(runtime.ready), /not ready within 300 ms/);
  assert.equal(runtime.attempt.failure.kind, "ready-deadline");
  assert.equal((await runtime.stop()).gone, true);
  assert.ok(groupGone(runtime.child.pid));
});

test("a distinct non-bind startup error fails once and keeps its first cause", async t => {
  const fake = fakeBin(t, `console.error("✘ [ERROR] Could not resolve dist/server/wrangler.json"); setTimeout(() => process.exit(1), 20);`);
  const runtime = await start(t, { bin: fake.bin });
  await assert.rejects(runtime.during(runtime.ready), /exited before readiness \(code 1/);
  await runtime.stop();
  await pause(200);
  assert.equal(fake.invocations(), 1);
  assert.equal(runtime.attempt.failure.kind, "exit-before-ready");
  assert.equal(runtime.attempt.exit.code, 1);
  assert.match(runtime.output(), /Could not resolve/);
  assert.doesNotMatch(JSON.stringify(runtime.attempt), /Could not resolve/, "attempt evidence never carries child output");
});

test("invalid, malformed or changed readiness fails closed", async t => {
  for (const [body, kind] of [
    [`send({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: 0 }); setInterval(() => {}, 1000);`, "invalid-ready"],
    [`send({ event: "DEV_SERVER_READY", ip: "0.0.0.0", port: 4000 }); setInterval(() => {}, 1000);`, "invalid-ready"],
    [`send("not json"); setInterval(() => {}, 1000);`, "invalid-message"],
  ]) {
    const runtime = await start(t, { bin: fakeBin(t, body).bin });
    await assert.rejects(runtime.during(runtime.ready));
    assert.equal(runtime.attempt.failure.kind, kind);
    assert.equal((await runtime.stop()).gone, true);
  }
  const fake = fakeBin(t, `${serveIdentity}\nserver.listen(0, "127.0.0.1", () => { const own = server.address().port; send({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: own }); setTimeout(() => send({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: own }), 50); setTimeout(() => send({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: own + 1 }), 150); });`);
  const runtime = await start(t, { bin: fake.bin });
  await runtime.during(runtime.ready);
  await pause(100);
  runtime.assertAlive();
  await pause(150);
  assert.throws(() => runtime.assertAlive(), /endpoint changed/);
  assert.equal(runtime.attempt.readyMessages, 3);
  assert.equal(runtime.attempt.failure.kind, "endpoint-changed");
});

test("an exit after readiness fails the open run", async t => {
  const fake = fakeBin(t, `${serveIdentity}\nserver.listen(0, "127.0.0.1", () => { send({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: server.address().port }); setTimeout(() => process.exit(3), 100); });`);
  const runtime = await start(t, { bin: fake.bin });
  await runtime.during(runtime.ready);
  await assert.rejects(runtime.during(pause(1500)), /exited after readiness \(code 3/);
  assert.throws(() => runtime.assertAlive());
});

test("an IPC disconnect from a still-running child fails closed", async t => {
  const fake = fakeBin(t, `process.disconnect(); setInterval(() => {}, 1000);`);
  const runtime = await start(t, { bin: fake.bin });
  await assert.rejects(runtime.during(runtime.ready), /IPC channel disconnected/);
  assert.equal(runtime.attempt.failure.kind, "ipc-disconnect");
  assert.equal(runtime.attempt.exit, null);
  assert.equal((await runtime.stop()).gone, true);
});

test("the occupied-port option is validated", () => {
  assert.throws(() => startWorkerRuntime({ cwd: process.cwd(), env: process.env, port: "8787" }), /Invalid runtime port option/);
});
