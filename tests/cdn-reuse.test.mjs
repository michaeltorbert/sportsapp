import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const { requestScores } = await bundle("lib/score-client.ts");
const { createCdnDocuments } = await bundle("lib/cdn-documents.ts");

// Week 2 is ESPN's selected CDN week; September 8 is its boundary day and needs week 1 too.
const calendar = [
  { value: "1", startDate: "2026-08-22T07:00Z", endDate: "2026-09-08T06:59Z" },
  { value: "2", startDate: "2026-09-08T07:00Z", endDate: "2026-09-14T06:59Z" },
];
const DEFAULT = "https://cdn.espn.com/core/college-football/scoreboard?xhr=1&group=80";
const WEEK1 = `${DEFAULT}&year=2026&seasontype=2&week=1`;
const HOSTED_AT = "2026-09-08T18:00:00.000Z", T0 = Date.parse("2026-09-09T18:00:00Z");
const iso = ms => new Date(ms).toISOString();
const event = (id, date) => ({ id, date, status: { type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ competitors: [
  { id: "a", homeAway: "away", team: { id: "a", conferenceId: "1" } },
  { id: "b", homeAway: "home", team: { id: "b", conferenceId: "2" } },
] }] });
const feed = (week, events = []) => ({ content: { sbData: { season: { year: 2026, type: 2 }, week: { number: week }, leagues: [{ calendar: [{ value: "2", entries: calendar }] }], events } } });
const ids = request => request.board.games.map(g => g.id);

// Primary refused; CDN weeks served from routes; hosted echoes the requested range.
function source(routes) {
  const log = { cdn: [], hosted: [] };
  const fetcher = async (url, options) => {
    const text = String(url);
    if (text.startsWith("/api/scores?")) {
      log.hosted.push(text);
      const query = new URL(text, "https://app.test").searchParams;
      return Response.json({ date: query.get("date"), endDate: query.get("end"), fetchedAt: HOSTED_AT, games: [] });
    }
    const parsed = new URL(text);
    if (parsed.hostname === "site.api.espn.com") return routes.primary ? routes.primary() : new Response(null, { status: 403 });
    const week = parsed.searchParams.get("week") ?? "default";
    log.cdn.push(week);
    const route = routes[week], body = typeof route === "function" ? await route(options) : route;
    return body instanceof Response ? body : Response.json(body);
  };
  return { fetcher, log };
}
const read = (date, parent, fetcher, documents) => requestScores(date, parent, fetcher, date, false, documents);
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error("condition not reached");
}
function deadlines(t) {
  const timers = [];
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { timers.push({ callback, milliseconds }); return timers.length; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  return timers;
}

test("completed CDN documents are reused within one store, keep their acquisition time, and a new store downloads again", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const { fetcher, log } = source({ default: () => feed(2, [event("wed", "2026-09-09T23:00Z"), event("thu", "2026-09-10T23:00Z")]) });
  const documents = createCdnDocuments(), parent = new AbortController().signal;
  const first = await read("2026-09-09", parent, fetcher, documents);
  t.mock.timers.setTime(T0 + 5000);
  const second = await read("2026-09-10", parent, fetcher, documents);
  assert.deepEqual(log.cdn, ["default"]); assert.deepEqual(log.hosted, []);
  assert.deepEqual(ids(first), ["wed"]); assert.deepEqual(ids(second), ["thu"]);
  assert.equal(second.board.fetchedAt, iso(T0), "a hit is not relabeled as newly fetched");
  assert.ok(second.generation > first.generation, "each request keeps its own halftime generation");
  const fresh = await read("2026-09-10", parent, fetcher, createCdnDocuments());
  assert.deepEqual(log.cdn, ["default", "default"]); assert.equal(fresh.board.fetchedAt, iso(T0 + 5000));
  await read("2026-09-10", parent, fetcher);
  assert.equal(log.cdn.length, 3, "callers without documents keep downloading as before");
});

test("a board reports the earliest acquisition of every CDN document it used, including calendar discovery", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const { fetcher, log } = source({
    default: feed(2, [event("today", "2026-09-08T18:00Z"), event("thu", "2026-09-10T23:00Z")]),
    // The adjacent week finishes three seconds after the selected week used for discovery.
    1: () => { t.mock.timers.setTime(Date.now() + 3000); return feed(1, [event("overnight", "2026-09-08T05:00Z")]); },
  });
  const parent = new AbortController().signal, documents = createCdnDocuments();
  const boundary = await read("2026-09-08", parent, fetcher, documents);
  assert.deepEqual(ids(boundary), ["overnight", "today"]);
  assert.equal(boundary.board.fetchedAt, iso(T0));
  t.mock.timers.setTime(T0 + 10000);
  const reused = await read("2026-09-08", parent, fetcher, documents);
  assert.deepEqual(log.cdn, ["default", "1"]); assert.equal(reused.board.fetchedAt, iso(T0));
  // A stored selected week joined with a newly downloaded adjacent week keeps the older time.
  const mixed = createCdnDocuments();
  t.mock.timers.setTime(T0 + 20000); await read("2026-09-10", parent, fetcher, mixed);
  t.mock.timers.setTime(T0 + 30000);
  const joined = await read("2026-09-08", parent, fetcher, mixed);
  assert.deepEqual(log.cdn, ["default", "1", "default", "1"]);
  assert.equal(joined.board.fetchedAt, iso(T0 + 20000));
});

test("documents bind to the first parent signal and fetcher; other pairs neither read, write nor evict", async () => {
  const documents = createCdnDocuments(), parent = new AbortController().signal;
  const owner = source({ default: feed(2) }), other = source({ default: feed(2) }), bad = source({ default: () => Response.json({}) });
  await read("2026-09-10", parent, owner.fetcher, documents);
  await read("2026-09-10", parent, other.fetcher, documents);
  await read("2026-09-10", new AbortController().signal, owner.fetcher, documents);
  assert.deepEqual(owner.log.cdn, ["default", "default"]); assert.deepEqual(other.log.cdn, ["default"]);
  assert.equal(documents.entries.size, 1);
  await read("2026-09-10", parent, bad.fetcher, documents);
  assert.equal(bad.log.hosted.length, 1); assert.equal(documents.entries.size, 1, "a bypassing failure evicts nothing");
  await read("2026-09-10", parent, owner.fetcher, documents);
  assert.equal(owner.log.cdn.length, 2);
});

test("concurrent misses each return their own bytes and time; the first stored document serves later hits", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const gates = [];
  const { fetcher, log } = source({ default: () => new Promise(resolve => gates.push(resolve)) });
  const documents = createCdnDocuments(), parent = new AbortController().signal;
  const a = read("2026-09-10", parent, fetcher, documents), b = read("2026-09-10", parent, fetcher, documents);
  await until(() => gates.length === 2);
  gates[0](Response.json(feed(2, [event("first", "2026-09-10T18:00Z")])));
  await until(() => documents.entries.size === 1);
  t.mock.timers.setTime(T0 + 2000);
  gates[1](Response.json(feed(2, [event("second", "2026-09-10T18:00Z")])));
  const results = (await Promise.all([a, b])).map(r => [ids(r)[0], r.board.fetchedAt]).sort();
  assert.deepEqual(results, [["first", iso(T0)], ["second", iso(T0 + 2000)]]);
  const later = await read("2026-09-10", parent, fetcher, documents);
  assert.deepEqual(ids(later), ["first"]); assert.equal(later.board.fetchedAt, iso(T0));
  assert.equal(log.cdn.length, 2); assert.deepEqual(log.hosted, []);
});

test("an expired caller's abort-ignoring late body is never stored and cannot replace another caller's document", async t => {
  const timers = deadlines(t), gates = [];
  const { fetcher, log } = source({ default: () => new Promise(resolve => gates.push(resolve)) });
  const documents = createCdnDocuments(), parent = new AbortController().signal;
  const a = read("2026-09-10", parent, fetcher, documents);
  await until(() => gates.length === 1);
  const b = read("2026-09-10", parent, fetcher, documents);
  await until(() => gates.length === 2);
  timers[0].callback(); // Only A's direct deadline expires; its transport ignores the abort.
  gates[0](Response.json(feed(2, [event("late", "2026-09-10T18:00Z")])));
  const late = await a;
  assert.equal(late.board.fetchedAt, HOSTED_AT, "the expired direct phase falls back to hosted as before");
  assert.equal(documents.entries.size, 0);
  gates[1](Response.json(feed(2, [event("current", "2026-09-10T18:00Z")])));
  assert.deepEqual(ids(await b), ["current"]);
  assert.deepEqual(ids(await read("2026-09-10", parent, fetcher, documents)), ["current"]);
  assert.equal(log.cdn.length, 2); assert.equal(log.hosted.length, 1);
  assert.deepEqual(timers.map(timer => timer.milliseconds), [8000, 8000, 10000, 8000], "no new timers or renewed deadlines");
});

test("cancellation during an adjacent week evicts nothing; parent cancellation starts no hosted request", async t => {
  await t.test("parent abort", async () => {
    const parent = new AbortController(), documents = createCdnDocuments();
    const { fetcher, log } = source({ default: feed(2), 1: () => { parent.abort(); throw new DOMException("Canceled", "AbortError"); } });
    await read("2026-09-10", parent.signal, fetcher, documents);
    await assert.rejects(read("2026-09-08", parent.signal, fetcher, documents), /Canceled/);
    assert.deepEqual(log.hosted, []); assert.equal(documents.entries.has(DEFAULT), true);
    await assert.rejects(read("2026-09-10", parent.signal, fetcher, documents), /canceled/i);
    assert.deepEqual(log.cdn, ["default", "1"], "an aborted caller reads nothing");
  });
  await t.test("direct deadline", async sub => {
    const timers = deadlines(sub), parent = new AbortController().signal, documents = createCdnDocuments();
    const { fetcher, log } = source({ default: feed(2), 1: () => { timers.at(-1).callback(); throw new DOMException("Expired", "AbortError"); } });
    await read("2026-09-10", parent, fetcher, documents);
    const expired = await read("2026-09-08", parent, fetcher, documents);
    assert.equal(expired.board.fetchedAt, HOSTED_AT); assert.equal(log.hosted.length, 1);
    assert.equal(documents.entries.has(DEFAULT), true);
    await read("2026-09-10", parent, fetcher, documents);
    assert.deepEqual(log.cdn, ["default", "1"]);
  });
});

test("a stored wrong-week document is evicted by the consumer that rejects it, then a later consumer recovers", async () => {
  let healthy = false;
  const { fetcher, log } = source({ default: feed(2, [event("today", "2026-09-08T18:00Z")]), 1: () => healthy ? feed(1, [event("overnight", "2026-09-08T05:00Z")]) : feed(2) });
  const documents = createCdnDocuments(), parent = new AbortController().signal;
  const failed = await read("2026-09-08", parent, fetcher, documents);
  assert.equal(failed.board.fetchedAt, HOSTED_AT); assert.equal(log.hosted.length, 1);
  assert.equal(documents.entries.size, 0, "both documents this consumer used are dropped");
  healthy = true;
  const recovered = await read("2026-09-08", parent, fetcher, documents);
  assert.deepEqual(ids(recovered), ["overnight", "today"]); assert.equal(log.hosted.length, 1);
  assert.deepEqual(log.cdn, ["default", "1", "default", "1"]);
});

for (const [kind, body] of [["error status", () => new Response(null, { status: 503 })], ["invalid JSON", () => new Response("{", { status: 200 })], ["schema-invalid", { content: { sbData: { events: [] } } }]])
  test(`a ${kind} CDN response is never stored and keeps the hosted fallback`, async () => {
    const { fetcher, log } = source({ default: body });
    const documents = createCdnDocuments(), parent = new AbortController().signal;
    for (const attempt of [1, 2]) {
      const result = await read("2026-09-10", parent, fetcher, documents);
      assert.equal(result.board.fetchedAt, HOSTED_AT);
      assert.equal(log.cdn.length, attempt); assert.equal(log.hosted.length, attempt);
      assert.equal(documents.entries.size, 0);
    }
  });

test("a failing concurrent loser cannot delete the different winner it never used", async () => {
  const gates = [];
  const { fetcher, log } = source({ default: () => new Promise(resolve => gates.push(resolve)) });
  const documents = createCdnDocuments(), parent = new AbortController().signal;
  const a = read("2026-09-10", parent, fetcher, documents), b = read("2026-09-10", parent, fetcher, documents);
  await until(() => gates.length === 2);
  gates[0](Response.json(feed(2, [event("good", "2026-09-10T18:00Z")])));
  await until(() => documents.entries.size === 1);
  const winner = documents.entries.get(DEFAULT);
  // Schema-valid but unreadable games: admitted structurally, rejected by normalization.
  gates[1](Response.json(feed(2, [{ invalid: true }])));
  const results = await Promise.all([a, b]);
  assert.deepEqual(results.map(ids).sort(), [[], ["good"]]); assert.equal(log.hosted.length, 1);
  assert.equal(documents.entries.get(DEFAULT), winner);
  assert.deepEqual(ids(await read("2026-09-10", parent, fetcher, documents)), ["good"]);
  assert.equal(log.cdn.length, 2);
});

test("a late failure removes only exact records it used, never a replacement stored after an earlier eviction", async () => {
  let version = "e1", releaseWeek;
  const { fetcher, log } = source({ default: () => feed(2, [event(version, "2026-09-10T18:00Z")]), 1: () => new Promise(resolve => { releaseWeek = resolve; }) });
  const documents = createCdnDocuments(), parent = new AbortController().signal;
  await read("2026-09-10", parent, fetcher, documents);
  const e1 = documents.entries.get(DEFAULT);
  const pending = read("2026-09-08", parent, fetcher, documents); // Uses e1, then waits on week 1.
  await until(() => releaseWeek);
  // An out-of-calendar range conservatively evicts the selected week it used.
  const unsupported = await read("2025-09-05", parent, fetcher, documents);
  assert.equal(unsupported.board.fetchedAt, HOSTED_AT); assert.equal(documents.entries.has(DEFAULT), false);
  version = "e2"; await read("2026-09-10", parent, fetcher, documents);
  const e2 = documents.entries.get(DEFAULT); assert.notEqual(e2, e1);
  releaseWeek(Response.json(feed(2))); // Wrong identity for week 1.
  assert.equal((await pending).board.fetchedAt, HOSTED_AT);
  assert.equal(documents.entries.get(DEFAULT), e2); assert.equal(documents.entries.has(WEEK1), false);
  assert.equal(log.hosted.length, 2);
});

test("with documents, primary success and hosted fallback keep their existing behavior and timestamps", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const parent = new AbortController().signal;
  const primary = source({ primary: () => Response.json({ events: [event("primary", "2026-09-10T18:00Z")] }) }), documents = createCdnDocuments();
  const direct = await read("2026-09-10", parent, primary.fetcher, documents);
  assert.deepEqual(ids(direct), ["primary"]); assert.equal(direct.board.fetchedAt, iso(T0));
  assert.deepEqual(primary.log.cdn, []); assert.equal(documents.entries.size, 0);
  const hosted = source({ default: () => new Response(null, { status: 503 }) }), other = createCdnDocuments();
  assert.equal((await read("2026-09-10", parent, hosted.fetcher, other)).board.fetchedAt, HOSTED_AT);
  assert.equal(other.entries.size, 0);
});
