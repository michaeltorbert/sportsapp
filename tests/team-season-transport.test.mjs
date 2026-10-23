import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./helpers.mjs";

const { createTeamSeasonService, teamScheduleUrl, teamStatsUrl } = await bundle("lib/team-season-server.ts");
const { loadTeamSeason } = await bundle("lib/team-season-client.ts");

const { TEAM_SEASON_TTL_MS } = await bundle("lib/team-season.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-team-season-${name}.json`, import.meta.url), "utf8"));
const DUKE = fixture("duke-2026"), UNC = fixture("unc-2026");
const T0 = Date.parse("2026-10-19T05:05:00Z");
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// Upstream answers by exact fixed URL; anything else is a test failure.
function upstream(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.Accept, "application/json");
    const answer = routes[url];
    if (!answer) throw new Error(`unexpected upstream URL ${url}`);
    return typeof answer === "function" ? answer(init) : json(answer);
  };
  return { calls, fetcher };
}
const dukeRoutes = (changes = {}) => ({
  [teamScheduleUrl("150")]: DUKE.default,
  [teamScheduleUrl("150", { year: 2026, type: 3 })]: DUKE.postseason,
  [teamStatsUrl("150", 2026)]: DUKE.stats,
  ...changes,
});

test("the fixed upstream URLs: current schedule, then the postseason and regular-season statistics for that season", () => {
  const base = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/150";
  assert.equal(teamScheduleUrl("150"), `${base}/schedule`);
  assert.equal(teamScheduleUrl("150", { year: 2026, type: 3 }), `${base}/schedule?season=2026&seasontype=3`);
  assert.equal(teamStatsUrl("150", 2026), `${base}/statistics?season=2026&seasontype=2`);
});

test("a Duke season from three base reads and no provider leader calls: record, stats, 12 regular games and none listed after the season", async () => {
  let now = T0;
  const { calls, fetcher } = upstream(dukeRoutes());
  const service = createTeamSeasonService(fetcher, () => now);
  const result = await service.get("150");
  assert.equal(result.status, 200);
  const season = result.season;
  // The current answer is regular season 2026, so it is not fetched twice.
  assert.deepEqual(calls.sort(), [teamScheduleUrl("150"), teamScheduleUrl("150", { year: 2026, type: 3 }), teamStatsUrl("150", 2026)].sort());
  assert.deepEqual(season.team, { id: "150", name: "Duke Blue Devils", shortName: "Duke", abbreviation: "DUKE", logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/150.png" });
  assert.deepEqual(season.season, { year: 2026 });
  assert.equal(season.record, "4-2");
  assert.deepEqual(season.stats.points, ["31.7", "16.0"]);
  assert.equal(season.regular.status, "complete"); assert.equal(season.regular.entries.length, 12);
  assert.deepEqual(season.postseason, { status: "complete", entries: [] });
  // Retrieval time is this read, not any source timestamp.
  assert.equal(season.checkedAt, new Date(T0).toISOString());
  // A fresh hit keeps its original retrieval time and makes no upstream request.
  now += 59_000;
  assert.equal((await service.get("150")).season.checkedAt, new Date(T0).toISOString());
  assert.equal(calls.length, 3);
});

test("after its cadence, a failed refresh returns that team's last season marked stale, and nothing for another team", async () => {
  let now = T0, down = false;
  const { fetcher } = upstream(dukeRoutes());
  const service = createTeamSeasonService((url, init) => down ? Promise.reject(new Error("offline")) : fetcher(url, init), () => now);
  assert.equal((await service.get("150")).season.stale, undefined);
  down = true; now += TEAM_SEASON_TTL_MS + 1;
  const old = await service.get("150");
  assert.equal(old.status, 200); assert.equal(old.season.stale, true); assert.equal(old.season.checkedAt, new Date(T0).toISOString());
  assert.equal((await service.get("153")).status, 502);
  // Not beyond 30 minutes: then the failure is reported.
  now = T0 + 1_800_001;
  assert.equal((await service.get("150")).status, 502);
});

test("a non-regular current season fetches the regular season explicitly (SYNTHETIC current metadata)", async () => {
  const current = structuredClone(DUKE.postseason);
  current.season = { year: 2026, type: 3 }; current.requestedSeason = { year: 2026, type: 3 };
  const { calls, fetcher } = upstream(dukeRoutes({ [teamScheduleUrl("150")]: current, [teamScheduleUrl("150", { year: 2026, type: 2 })]: DUKE.regular }));
  const { season } = await createTeamSeasonService(fetcher, () => T0).get("150");
  assert.ok(calls.includes(teamScheduleUrl("150", { year: 2026, type: 2 })));
  assert.equal(season.regular.entries.length, 12);
});

test("partial sources keep their own state; discovery failures and identity mismatches fail the request", async () => {
  // Postseason down and statistics for another team: both shown as unavailable, the rest stays.
  const { fetcher } = upstream(dukeRoutes({ [teamScheduleUrl("150", { year: 2026, type: 3 })]: () => json({}, 500), [teamStatsUrl("150", 2026)]: UNC.stats }));
  const { season } = await createTeamSeasonService(fetcher, () => T0).get("150");
  assert.deepEqual(season.postseason, { status: "unavailable" });
  assert.equal(season.stats, null);
  assert.equal(season.regular.entries.length, 12);
  for (const discovery of [() => json({}, 500), () => new Response("not json"), UNC.schedule, { ...DUKE.default, requestedSeason: { year: 2025, type: 2 } }, () => new Response("x".repeat(2_000_001))]) {
    const { fetcher } = upstream(dukeRoutes({ [teamScheduleUrl("150")]: discovery }));
    const result = await createTeamSeasonService(fetcher, () => T0).get("150");
    assert.deepEqual([result.status, result.retryAfter], [502, 30]);
    assert.doesNotMatch(result.error, /espn\.com|site\.api/);
  }
});

test("admission is bounded: a third concurrent miss is busy, without another upstream request", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { calls, fetcher } = upstream(dukeRoutes({ [teamScheduleUrl("150")]: async () => { await gate; return json(DUKE.default); }, [teamScheduleUrl("153")]: async () => { await gate; return json(UNC.schedule); } }));
  const service = createTeamSeasonService(fetcher, () => T0);
  const first = service.get("150"), second = service.get("153");
  const third = await service.get("150");
  assert.deepEqual(third, { status: 503, error: "Team seasons are busy. Please retry.", retryAfter: 5 });
  assert.equal(calls.length, 2);
  release();
  assert.equal((await first).status, 200);
  await second;
});

test("the route accepts one numeric team only, before any upstream work", async () => {
  const original = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls++; throw new Error("no upstream in this test"); };
  try {
    // Server-only Cloudflare bindings are supplied by workerd in deployment. This Node test
    // stubs only that module; the native runtime regression covers real KV bindings.
    const { build } = await import("esbuild");
    const output = await build({entryPoints:["app/api/team/route.ts"],bundle:true,platform:"node",format:"esm",write:false,plugins:[{name:"cloudflare-env-fixture",setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:"env",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const env={};",loader:"js"}));}}]});
    const { GET } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
    for (const query of ["", "?team=", "?team=abc", "?team=1234567", "?team=150&team=153", "?team=-1", "?team=15%2F0", "?id=150"]) {
      const response = await GET(new Request(`https://app.test/api/team${query}`));
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(upstreamCalls, 0);
    const failed = await GET(new Request("https://app.test/api/team?team=150"));
    assert.equal(failed.status, 502);
    assert.equal(failed.headers.get("retry-after"), "30");
  } finally { globalThis.fetch = original; }
});

test("the browser loads only its own Worker, validates identity and maps failures", async () => {
  const { season } = await createTeamSeasonService(upstream(dukeRoutes()).fetcher, () => T0).get("150");
  const seen = [];
  const fetcher = answer => async (url, init) => { seen.push([url, init.mode, init.credentials, init.cache]); return answer(); };
  const signal = new AbortController().signal;
  const ok = await loadTeamSeason("150", signal, fetcher(() => json(season)));
  assert.equal(ok.kind, "ok"); assert.equal(ok.season.regular.entries.length, 12);
  assert.deepEqual(seen[0], ["/api/team?team=150", "same-origin", "same-origin", "no-store"]);
  // Another team's season is never accepted for this request.
  assert.deepEqual(await loadTeamSeason("153", signal, fetcher(() => json(season))), { kind: "failed", reason: "invalid" });
  assert.deepEqual(await loadTeamSeason("150", signal, fetcher(() => json({}, 503, { "Retry-After": "12" }))), { kind: "failed", reason: "busy", retryAfter: 12 });
  assert.deepEqual(await loadTeamSeason("150", signal, fetcher(() => json({}, 502, { "Retry-After": "99999999" }))), { kind: "failed", reason: "upstream", retryAfter: undefined });
  assert.deepEqual(await loadTeamSeason("150", signal, fetcher(() => json({}, 400))), { kind: "failed", reason: "invalid" });
  assert.deepEqual(await loadTeamSeason("150", signal, fetcher(() => new Response("<html>"))), { kind: "failed", reason: "invalid" });
  assert.deepEqual(await loadTeamSeason("150", signal, async () => { throw new TypeError("offline"); }), { kind: "failed", reason: "network" });
  // The caller's cancellation is not a failure: it propagates.
  const controller = new AbortController();
  const pending = loadTeamSeason("150", controller.signal, (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  // The total deadline ends a stuck request as a network failure.
  const stuck = await loadTeamSeason("150", signal, (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")))), 20);
  assert.deepEqual(stuck, { kind: "failed", reason: "network" });
});
