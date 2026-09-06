import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const { normalizeCdnRange } = await bundle("lib/espn-data.ts");
const { getScoreboard } = await bundle("lib/espn.ts");
function feed() {
  return { content: { sbData: { season: { type: 2 }, week: { number: 1 }, leagues: [{ calendar: [{ value: "2", entries: [{ value: "1", startDate: "2026-08-22T07:00Z", endDate: "2026-09-08T06:59Z" }] }] }], events: [] } } };
}
test("CDN fallback refuses unproven, different-week, and partial boundary-day coverage", () => {
  assert.equal(normalizeCdnRange(feed(), "2026-09-03", "2026-09-07").endDate, "2026-09-07");
  for (const [start, end] of [["2026-09-09", "2026-09-13"], ["2026-08-22", "2026-08-22"], ["2026-09-08", "2026-09-08"]])
    assert.throws(() => normalizeCdnRange(feed(), start, end), /does not cover/);
  const missing = feed(); delete missing.content.sbData.leagues;
  assert.throws(() => normalizeCdnRange(missing, "2026-09-06"));
});
test("CDN range normalization filters Eastern dates and ACC teams, and rejects partial data", () => {
  const raw = feed();
  const event = (id, date, conference) => ({ id, date, status: { type: { name: "STATUS_SCHEDULED", state: "pre" } }, competitions: [{ competitors: [
    { id: "a", homeAway: "away", team: { id: "a", conferenceId: conference } },
    { id: "b", homeAway: "home", team: { id: "b", conferenceId: "2" } },
  ] }] });
  raw.content.sbData.events = [event("late", "2026-09-06T02:30:00Z", "1"), event("other-conference", "2026-09-05T16:00:00Z", "2"), event("sunday", "2026-09-06T20:00:00Z", "1")];
  assert.deepEqual(normalizeCdnRange(raw, "2026-09-05").games.map(game => game.id), ["late", "other-conference"]);
  assert.deepEqual(normalizeCdnRange(raw, "2026-09-05", "2026-09-05", true).games.map(game => game.id), ["late"]);
  raw.content.sbData.events.push({ invalid: true });
  assert.throws(() => normalizeCdnRange(raw, "2026-09-05"), /incomplete/);
});
test("server scores recover from the Cloudflare site-API 403 without returning another week's board", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(url);
    return url.includes("site.api") ? new Response("Forbidden", { status: 403 }) : Response.json(feed());
  });
  assert.equal((await getScoreboard("2026-09-06")).date, "2026-09-06");
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("cdn.espn.com"));
  await assert.rejects(() => getScoreboard("2026-09-13"), /does not cover/);
});
