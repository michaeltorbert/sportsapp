import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const { completeCdnRange } = await bundle("lib/espn-cdn.ts");
const entries = [
  { value: "1", startDate: "2026-08-22T07:00Z", endDate: "2026-09-08T06:59Z" },
  { value: "2", startDate: "2026-09-08T07:00Z", endDate: "2026-09-14T06:59Z" },
];
function event(id, date) {
  return { id, date, status: { type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ competitors: [
    { id: "a", homeAway: "away", team: { id: "a", conferenceId: "1" } },
    { id: "b", homeAway: "home", team: { id: "b", conferenceId: "2" } },
  ] }] };
}
function feed(week, events = []) { return { content: { sbData: { season: { year: 2026, type: 2 }, week: { number: week }, leagues: [{ calendar: [{ value: "2", entries: structuredClone(entries) }] }], events } } }; }
test("overnight boundary joins both explicitly identified weeks for today and alert lookback", async t => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async url => {
    urls.push(new URL(url));
    return Response.json(feed(1, [event("overnight", "2026-09-08T05:00Z"), event("monday", "2026-09-08T02:00Z")]));
  });
  const current = feed(2, [event("tuesday", "2026-09-08T18:00Z")]);
  assert.deepEqual((await completeCdnRange(current, "2026-09-08")).games.map(g => g.id), ["overnight", "tuesday"]);
  assert.deepEqual((await completeCdnRange(current, "2026-09-07", "2026-09-08")).games.map(g => g.id), ["overnight", "monday", "tuesday"]);
  assert.equal(urls[0].searchParams.get("week"), "1");
  assert.equal(urls[0].searchParams.get("year"), "2026");
  assert.equal(urls[0].searchParams.get("seasontype"), "2");
});
for (const kind of ["wrong-week", "wrong-season", "changed-calendar", "partial", "unavailable"]) test(`boundary rejects ${kind} adjacent response`, async t => {
  const adjacent = feed(1);
  if (kind === "wrong-week") adjacent.content.sbData.week.number = 2;
  if (kind === "wrong-season") adjacent.content.sbData.season.year = 2025;
  if (kind === "changed-calendar") adjacent.content.sbData.leagues[0].calendar[0].entries[0].endDate = "2026-09-08T05:59Z";
  if (kind === "partial") adjacent.content.sbData.events = [{ invalid: true }];
  t.mock.method(globalThis, "fetch", async () => kind === "unavailable" ? new Response("", { status: 503 }) : Response.json(adjacent));
  await assert.rejects(completeCdnRange(feed(2), "2026-09-08"));
});
test("boundary rejects calendar gaps and missing previous week before fetching", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("unproven calendars must not fetch"));
  const gap = feed(2); gap.content.sbData.leagues[0].calendar[0].entries[0].endDate = "2026-09-08T06:58Z";
  await assert.rejects(completeCdnRange(gap, "2026-09-08"), /continuously/);
  const missing = feed(2); missing.content.sbData.leagues[0].calendar[0].entries.shift();
  await assert.rejects(completeCdnRange(missing, "2026-09-08"), /does not cover/);
});
test("fully covered empty adjacent weeks are a proven empty board", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(feed(1)));
  const board = await completeCdnRange(feed(2), "2026-09-08");
  assert.deepEqual(board.games, []); assert.equal(board.stale, undefined); assert.equal(board.warnings, undefined);
});
test("overnight alert poll records readiness only after complete adjacent-week coverage", async t => {
  const { database } = await import("./helpers.mjs");
  const { poll } = await bundle("services/alerts/worker.ts");
  const { db, sqlite } = database(); t.after(() => sqlite.close());
  const now = Date.parse("2026-09-08T04:30:00Z"), urls = [];
  t.mock.method(globalThis, "fetch", async url => {
    const parsed = new URL(url); urls.push(parsed);
    assert.equal(parsed.hostname, "cdn.espn.com", "No delivery request is permitted");
    return Response.json(feed(parsed.searchParams.get("week") === "1" ? 1 : 2));
  });
  await poll({ DB: db, VAPID_PUBLIC_KEY: "unused", VAPID_PRIVATE_KEY: "unused" }, now);
  assert.equal(sqlite.prepare("SELECT value FROM poll_state WHERE id='last_good_score'").get().value, now);
  assert.equal(urls.length, 2);
});
