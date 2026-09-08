import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const { loadScores } = await bundle("lib/score-client.ts");
const calendar = [
  { value: "1", startDate: "2026-08-22T07:00Z", endDate: "2026-09-08T06:59Z" },
  { value: "2", startDate: "2026-09-08T07:00Z", endDate: "2026-09-14T06:59Z" },
];
const event = (id, date, conference = "1") => ({ id, date, status: { type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ competitors: [
  { id: "a", homeAway: "away", team: { id: "a", conferenceId: conference } },
  { id: "b", homeAway: "home", team: { id: "b", conferenceId: "2" } },
] }] });
const feed = (week, events = []) => ({ content: { sbData: { season: { year: 2026, type: 2 }, week: { number: week }, leagues: [{ calendar: [{ value: "2", entries: calendar }] }], events } } });
const hosted = () => Response.json({ date: "2026-09-08", endDate: "2026-09-08", fetchedAt: "2026-09-08T18:00:00Z", games: [] });
function deadlines(t) {
  const timers = [];
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { timers.push({ callback, milliseconds }); return timers.length; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  return timers;
}
function assertDirect(options) {
  assert.equal(options.credentials, "omit"); assert.equal(options.mode, "cors"); assert.equal(options.cache, "no-store");
}
test("primary success uses neither CDN nor hosted scoreboard", async () => {
  const calls = [];
  const result = await loadScores("2026-09-08", new AbortController().signal, async (url, options) => {
    calls.push(String(url)); assertDirect(options); assert.equal(new URL(url).hostname, "site.api.espn.com"); return Response.json({ events: [] });
  });
  assert.deepEqual(result.games, []); assert.equal(calls.length, 1);
});
test("fast primary failure uses complete browser CDN data and preserves ACC filtering", async () => {
  const calls = [], signals = [];
  const result = await loadScores("2026-09-09", new AbortController().signal, async (url, options) => {
    const parsed = new URL(url); calls.push(parsed.hostname); signals.push(options.signal); assertDirect(options);
    if (parsed.hostname === "site.api.espn.com") return new Response(null, { status: 403 });
    assert.equal(parsed.hostname, "cdn.espn.com"); assert.equal(parsed.searchParams.get("group"), "80");
    return Response.json(feed(2, [event("acc", "2026-09-10T18:00Z"), event("other", "2026-09-10T19:00Z", "3")]));
  }, "2026-09-13", true);
  assert.deepEqual(calls, ["site.api.espn.com", "cdn.espn.com"]); assert.equal(signals[0], signals[1]);
  assert.deepEqual(result.games.map(g => g.id), ["acc"]); assert.equal(result.endDate, "2026-09-13");
});
test("adjacent CDN weeks use the injected browser fetch and the same direct deadline", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No request may escape the supplied fetcher"));
  const calls = [], signals = [];
  const result = await loadScores("2026-09-08", new AbortController().signal, async (url, options) => {
    const parsed = new URL(url); calls.push(parsed); signals.push(options.signal); assertDirect(options);
    if (parsed.hostname === "site.api.espn.com") throw new TypeError("Primary unavailable");
    assert.equal(parsed.hostname, "cdn.espn.com");
    return Response.json(parsed.searchParams.get("week") === "1" ? feed(1, [event("overnight", "2026-09-08T05:00Z")]) : feed(2, [event("today", "2026-09-08T18:00Z")]));
  });
  assert.deepEqual(result.games.map(g => g.id), ["overnight", "today"]); assert.equal(calls.length, 3);
  assert.equal(new Set(signals).size, 1); assert.equal(calls[2].searchParams.get("week"), "1");
});
for (const failure of ["malformed", "partial", "wrong-week"]) test(`${failure} CDN data falls back to the existing hosted endpoint`, async () => {
  const calls = [];
  const result = await loadScores("2026-09-08", new AbortController().signal, async (url, options) => {
    calls.push(String(url));
    if (String(url).startsWith("/api/scores")) { assert.equal(options.mode, "same-origin"); return hosted(); }
    const parsed = new URL(url); assertDirect(options);
    if (parsed.hostname === "site.api.espn.com") return new Response(null, { status: 403 });
    if (failure === "malformed") return Response.json({});
    if (parsed.searchParams.has("week")) return Response.json(failure === "wrong-week" ? feed(2) : feed(1, [{ invalid: true }]));
    return Response.json(feed(2));
  });
  assert.equal(calls.at(-1), "/api/scores?date=2026-09-08&end=2026-09-08&acc=0"); assert.deepEqual(result.games, []);
});
test("a primary timeout skips CDN and retains only the original eight plus ten second budgets", async t => {
  const timers = deadlines(t), calls = [], signals = [];
  await loadScores("2026-09-08", new AbortController().signal, async (url, options) => {
    calls.push(String(url)); signals.push(options.signal);
    if (calls.length === 1) { timers[0].callback(); throw new DOMException("Expired", "AbortError"); }
    assert.equal(options.signal.aborted, false); return hosted();
  });
  assert.deepEqual(timers.map(t => t.milliseconds), [8000, 10000]);
  assert.equal(calls.length, 2); assert.ok(calls[1].startsWith("/api/scores")); assert.notEqual(signals[0], signals[1]);
});
test("CDN adjacent requests cannot renew the direct deadline", async t => {
  const timers = deadlines(t), calls = [], signals = [];
  await loadScores("2026-09-08", new AbortController().signal, async (url, options) => {
    calls.push(String(url)); signals.push(options.signal);
    if (String(url).startsWith("/api/scores")) { assert.equal(options.signal.aborted, false); return hosted(); }
    if (new URL(url).hostname === "site.api.espn.com") return new Response(null, { status: 403 });
    if (new URL(url).searchParams.has("week")) { timers[0].callback(); assert.equal(options.signal.aborted, true); throw new DOMException("Expired", "AbortError"); }
    return Response.json(feed(2));
  });
  assert.equal(calls.length, 4); assert.equal(new Set(signals.slice(0, 3)).size, 1);
  assert.deepEqual(timers.map(t => t.milliseconds), [8000, 10000]);
});
test("parent cancellation during CDN does not start a hosted fallback", async () => {
  const parent = new AbortController(), calls = [];
  await assert.rejects(loadScores("2026-09-08", parent.signal, async (url, options) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(null, { status: 403 });
    parent.abort(); assert.equal(options.signal.aborted, true); throw new DOMException("Canceled", "AbortError");
  }), /Canceled/);
  assert.equal(calls.length, 2);
});
