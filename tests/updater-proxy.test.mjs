import test from "node:test";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { once } from "node:events";
import { forward } from "../scripts/updater-proxy.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = check(); if (value) return value; await pause(10); }
  throw new Error("Timed out waiting for proxy state");
}
async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}
async function proxyTo(t, upstreamPort) {
  const outcomes = [];
  const port = await listen(t, (req, res) => forward(req, res, upstreamPort, { onOutcome: outcome => outcomes.push(outcome) }));
  return { port, outcomes };
}
// Collects one downstream exchange without letting a client-side reset escape as uncaught.
function fetchRaw(port, { onResponse } = {}) {
  return new Promise(resolve => {
    const result = { statuses: [], body: "", error: null, complete: null };
    const req = get({ host: "127.0.0.1", port, path: "/api/health" }, response => {
      result.statuses.push(response.statusCode);
      response.setEncoding("utf8");
      response.on("data", chunk => { result.body += chunk; onResponse?.(req, chunk); });
      response.on("error", error => { result.error = error.code ?? error.message; });
      response.on("close", () => { result.complete = response.complete; resolve(result); });
    });
    req.on("error", error => { result.error = error.code ?? error.message; resolve(result); });
  });
}

test("a normal response completes once with its body", async t => {
  const upstream = await listen(t, (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"commit":"a"}'); });
  const { port, outcomes } = await proxyTo(t, upstream);
  const result = await fetchRaw(port);
  assert.deepEqual(result.statuses, [200]);
  assert.equal(result.body, '{"commit":"a"}');
  assert.equal(result.complete, true);
  await until(() => outcomes.length);
  await pause(50);
  assert.deepEqual(outcomes, [{ kind: "complete" }]);
});

test("an upstream refusal before headers keeps the existing 502", async t => {
  // A just-released port, so the upstream connect is refused.
  const refused = await new Promise(resolve => {
    const server = createServer(); server.listen(0, "127.0.0.1", () => { const free = server.address().port; server.close(() => resolve(free)); });
  });
  const { port, outcomes } = await proxyTo(t, refused);
  const result = await fetchRaw(port);
  assert.deepEqual(result.statuses, [502]);
  assert.equal(result.complete, true);
  await until(() => outcomes.length);
  await pause(50);
  assert.deepEqual(outcomes, [{ kind: "refused", code: "ECONNREFUSED" }]);
});

test("a downstream cancellation aborts the paired upstream and is not reclassified", async t => {
  let upstreamClosed = false;
  const upstream = await listen(t, (req, res) => {
    res.on("close", () => { upstreamClosed = true; });
    res.writeHead(200, { "content-type": "application/json" }); res.write('{"partial":');
  });
  const { port, outcomes } = await proxyTo(t, upstream);
  const result = await fetchRaw(port, { onResponse: req => req.destroy() });
  assert.deepEqual(result.statuses, [200]);
  await until(() => upstreamClosed);
  await pause(100);
  assert.deepEqual(outcomes, [{ kind: "cancelled" }]);
});

test("an upstream mid-body reset is truncated without replacement headers", async t => {
  const upstream = await listen(t, (req, res) => {
    res.writeHead(200, { "content-type": "application/json", "content-length": "64" });
    res.write('{"version":"', () => res.socket.destroy());
  });
  const { port, outcomes } = await proxyTo(t, upstream);
  const result = await fetchRaw(port);
  assert.deepEqual(result.statuses, [200], "headers are written exactly once; no 502 after headers");
  assert.equal(result.complete, false);
  await until(() => outcomes.length);
  await pause(100);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].kind, "truncated");
  assert.equal(typeof outcomes[0].code, "string");
});
