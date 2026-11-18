import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const d = await bundle("lib/schedule-diagnostics.ts");
const client = await bundle("lib/score-client.ts");
function installStorage(t) {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map();
  let blocked = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => { if (blocked) throw Error("blocked"); return values.get(key) ?? null; },
    setItem: (key, value) => { if (blocked) throw Error("blocked"); values.set(key, value); },
    removeItem: key => { if (blocked) throw Error("blocked"); values.delete(key); },
  } });
  d.clearDiagnostics();
  t.after(() => { d.clearDiagnostics(); if (old) Object.defineProperty(globalThis, "localStorage", old); else delete globalThis.localStorage; });
  return { values, block: () => { blocked = true; } };
}
const incidents = () => JSON.parse(d.diagnosticsSnapshot().text).incidents;
function incident(scope = "daily", outcome = "failed") { const x = d.createTrace("2026-09-05", "2026-09-05", scope); x.data.outcome = outcome; x.add("primary", "http", 503); x.add("request", "failed"); return x.data; }
const hostedBoard = { date: "2026-09-05", endDate: "2026-09-05", fetchedAt: new Date().toISOString(), games: [] };
const rejectedFeed = async url => String(url).startsWith("/api/") ? Response.json(hostedBoard) : new Response("private-provider-sentinel", { status: 503 });

test("strict ingest/export retains causal allowlist only, expires poison and clears only dedicated storage", t => {
  const { values } = installStorage(t); values.set("ss:push", "owner-secret-sentinel");
  const x = incident(); x.rawBody = "provider-secret-sentinel"; x.observations[0].url = "secret-url";
  d.saveDiagnostic(x);
  assert.equal(incidents().length, 1);
  assert.doesNotMatch(d.diagnosticsSnapshot().text, /sentinel|rawBody|secret-url|ss:push/);
  const old = { ...incident(), id: "expired", at: Date.now() - 8 * 86400000 };
  values.set(d.DIAGNOSTICS_KEY, JSON.stringify([old, { ...x, id: "poison", observations: [{ stage: "cookie", code: "private", ms: 0 }] }]));
  assert.ok(incidents().every(x => x.id !== "expired" && x.id !== "poison"));
  d.clearDiagnostics(); assert.equal(incidents().length, 0); assert.equal(values.get("ss:push"), "owner-secret-sentinel");
});
test("bounded observations retain initial cause, owned deadline and terminal/final stages with explicit omissions", () => {
  const x = d.createTrace("2026-09-05", "2026-09-05"); x.add("primary", "http", 403);
  for (let n = 0; n < 20; n++) x.add("cdn-week", "ok", 200);
  x.add("request", "deadline");
  for (let n = 0; n < 50; n++) x.add("hosted", "ok", 200);
  x.add("hosted", "http", 502); x.add("request", "failed");
  assert.equal(x.data.observations.length, 32); assert.ok(x.data.omitted > 0);
  assert.equal(x.data.observations[0].status, 403); assert.ok(x.data.observations.some(o => o.code === "deadline"));
  assert.equal(x.data.observations.at(-2).status, 502); assert.equal(x.data.observations.at(-1).code, "failed");
});
test("retention protects failed/stale records against fallback/cancel churn and stays under fixed storage bounds", t => {
  installStorage(t);
  for (let n = 0; n < 20; n++) { const x = incident("week", n % 2 ? "stale" : "failed"); x.id = `terminal-${n}`; d.saveDiagnostic(x); }
  for (let n = 0; n < 40; n++) { const x = incident("daily", n % 2 ? "canceled" : "degraded"); x.id = `routine-${n}`; d.saveDiagnostic(x); }
  assert.equal(incidents().length, 20); assert.ok(incidents().every(x => x.id.startsWith("terminal-")));
  assert.ok(globalThis.localStorage.getItem(d.DIAGNOSTICS_KEY).length * 2 <= 65536);
});
test("only actual matching-scope publication marks recovery; original failure persists and storage denial remains usable", t => {
  const s = installStorage(t); const x = incident("week"); d.saveDiagnostic(x);
  const success = incident("daily", "success");
  d.publishedDiagnostic(success, "daily"); assert.equal(incidents()[0].recoveredAt, undefined);
  d.publishedDiagnostic(success, "week", true); assert.equal(incidents()[0].recoveredAt, undefined);
  d.publishedDiagnostic(success, "week"); assert.equal(typeof incidents()[0].recoveredAt, "number");
  assert.equal(incidents()[0].id, x.id);
  s.block(); const failed = incident(); failed.id = "memory-failure"; d.saveDiagnostic(failed);
  const snapshot = d.diagnosticsSnapshot(); assert.equal(snapshot.persistent, false); assert.match(snapshot.text, /memory-failure/);
});
test("production request exports exact HTTP failure chain, never provider text; malformed optional metadata cannot reject valid board", async t => {
  installStorage(t);
  const request = await client.requestScores("2026-09-05", new AbortController().signal, async url => String(url).startsWith("/api/") ? Response.json({ ...hostedBoard, scheduleDiagnostics: { rawBody: "malicious-sentinel" } }) : rejectedFeed(url), "2026-09-05", false, undefined, "daily");
  assert.equal(request.board.date, "2026-09-05"); assert.equal(request.board.scheduleDiagnostics, undefined);
  const x = incidents().find(x => x.side === "client"); assert.equal(x.outcome, "degraded"); assert.equal(x.source, "hosted");
  assert.ok(x.observations.some(o => o.stage === "primary" && o.status === 503));
  assert.ok(x.observations.some(o => o.stage === "hosted" && o.code === "detail-unavailable"));
  assert.doesNotMatch(d.diagnosticsSnapshot().text, /private-provider|malicious-sentinel/);
});
test("production request retains platform-style 502 with absent server detail, parse and acquisition validation separately", async t => {
  installStorage(t);
  await assert.rejects(client.requestScores("2026-09-05", new AbortController().signal, async url => String(url).startsWith("/api/") ? new Response("platform-private-sentinel", { status: 502 }) : new Response("not-json")));
  let x = incidents().find(x => x.outcome === "failed");
  assert.ok(x.observations.some(o => o.stage === "primary" && o.code === "parse"));
  assert.ok(x.observations.some(o => o.stage === "hosted" && o.status === 502));
  assert.ok(x.observations.some(o => o.stage === "hosted" && o.code === "detail-unavailable"));
  await assert.rejects(client.requestScores("2026-09-05", new AbortController().signal, async url => Response.json(String(url).startsWith("/api/") ? { ...hostedBoard, date: "2026-09-06" } : {})));
  x = incidents().findLast(x => x.outcome === "failed");
  assert.ok(x.observations.some(o => o.stage === "primary" && o.code === "validation"));
  assert.ok(x.observations.some(o => o.stage === "hosted" && o.code === "validation"));
});
test("production cancellation is distinct from owned eight-second deadline and cannot recover a prior failure", async t => {
  installStorage(t); d.saveDiagnostic(incident());
  const c = new AbortController();
  const pending = client.requestScores("2026-09-05", c.signal, async (_url, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("private-cancel", "AbortError")))));
  c.abort(); await assert.rejects(pending);
  let x = incidents().findLast(x => x.outcome === "canceled"); assert.ok(x.observations.some(o => o.code === "parent-cancel")); assert.equal(incidents()[0].recoveredAt, undefined);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timed = client.requestScores("2026-09-05", new AbortController().signal, async (url, options) => String(url).startsWith("/api/") ? new Response("failed", { status: 502 }) : new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("deadline", "AbortError")))));
  t.mock.timers.tick(8000); await assert.rejects(timed);
  x = incidents().findLast(x => x.outcome === "failed"); assert.ok(x.observations.some(o => o.code === "deadline")); assert.ok(!x.observations.some(o => o.code === "parent-cancel"));
});
test("production CDN shared reuse records unknown acquisition provenance, never synthetic fresh HTTP 200", async t => {
  installStorage(t);
  const { createCdnDocuments } = await bundle("lib/cdn-documents.ts");
  const documents = createCdnDocuments(), signal = new AbortController().signal; let calls = 0;
  const feed = { content: { sbData: { events: [], season: { type: 2, year: 2026 }, week: { number: 1 }, leagues: [{ calendar: [{ value: "2", entries: [{ value: "1", startDate: "2026-08-22T07:00:00Z", endDate: "2026-09-08T06:59:00Z" }] }] }] } } };
  const fetcher = async url => { calls++; return String(url).includes("site.api") ? new Response("failed", { status: 503 }) : Response.json(feed); };
  await client.requestScores("2026-09-05", signal, fetcher, "2026-09-05", false, documents);
  await client.requestScores("2026-09-06", signal, fetcher, "2026-09-06", false, documents);
  assert.equal(calls, 3);
  const x = incidents().find(x => x.date === "2026-09-06");
  assert.ok(x.observations.some(o => o.stage === "cdn" && o.code === "reused-or-acquired" && o.status === undefined));
  assert.ok(!x.observations.some(o => o.stage === "cdn" && o.status === 200));
});


test("JSON malformed identity values fail strict sanitizer and persisted-key ingress without exporting the values", async t => {
  const { values } = installStorage(t);
  const malformed = [{ id: ["owner-secret"] }, { id: 123 }, { version: ["1.26.1"] }, { commit: ["development"] }];
  for (const [index, overrides] of malformed.entries()) {
    const raw = JSON.parse(JSON.stringify({ ...incident(), ...overrides }));
    assert.equal(d.sanitizeDiagnostic(raw), null, `Counterexample ${index} must not rely on regex coercion`);
    // Reset this page memory, then admit exactly the poisoned persisted JSON bytes.
    d.clearDiagnostics();
    values.set(d.DIAGNOSTICS_KEY, JSON.stringify([raw]));
    const snapshot = d.diagnosticsSnapshot();
    assert.equal(snapshot.count, 0); assert.deepEqual(JSON.parse(snapshot.text).incidents, []);
    assert.doesNotMatch(snapshot.text, /owner-secret/);
  }
  const valid = JSON.parse(JSON.stringify(incident()));
  assert.deepEqual(d.sanitizeDiagnostic(valid), valid, "Valid JSON metadata remains admissible");
});
test("JSON malformed optional hosted identity fields are ignored without failing the valid board or exporting malformed values", async t => {
  installStorage(t);
  for (const overrides of [{ id: ["owner-secret"] }, { id: 123 }, { version: ["1.26.1"] }, { commit: ["development"] }]) {
    const server = { ...incident(), side: "server", ...overrides };
    const request = await client.requestScores("2026-09-05", new AbortController().signal, async url => String(url).startsWith("/api/")
      ? Response.json({ ...hostedBoard, scheduleDiagnostics: server }) : new Response("controlled", { status: 503 }));
    assert.equal(request.board.date, hostedBoard.date); assert.deepEqual(request.board.games, []);
    assert.equal(request.board.scheduleDiagnostics, undefined); assert.equal(request.diagnostic.relatedId, undefined);
    assert.ok(request.diagnostic.observations.some(o => o.stage === "hosted" && o.code === "detail-unavailable"));
  }
  const exported = incidents(); assert.ok(exported.every(x => x.side === "client"));
  assert.ok(exported.every(x => typeof x.id === "string" && typeof x.version === "string" && typeof x.commit === "string"));
  assert.doesNotMatch(d.diagnosticsSnapshot().text, /owner-secret/);
});
