import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle, game } from "./helpers.mjs";

// Route upstream fetches go through this delegate so each test controls ESPN.
let upstream = async () => { throw new Error("unexpected upstream request"); };
globalThis.fetch = (...args) => upstream(...args);
const route = await bundle("app/api/stats/route.ts");
const { createStatsService, summaryUrl } = await bundle("lib/stats-server.ts");
const { loadGameStats, retryAfterSeconds } = await bundle("lib/stats-client.ts");
const { createStatsScheduler } = await bundle("lib/stats-scheduler.ts");
const { StatsController, createStatsMemory, statsGeneration } = await bundle("lib/use-game-stats.ts");
const { normalizeGameStats } = await bundle("lib/game-stats.ts");

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-summary-${name}.json`, import.meta.url), "utf8"));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
// Re-identify a genuine fixture as another event, keeping its teams.
function summary(name, id, status) {
  const raw = fixture(name); raw.header.id = id; raw.header.competitions[0].id = id;
  if (status) raw.header.competitions[0].status = status;
  return raw;
}
const LIVE_STATUS = { period: 1, displayClock: "12:00", type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "12:00 - 1st" } };
const PREGAME_IDS = ["99", "96"], FINAL_IDS = ["84", "158"];
function cardGame(id, teamIds, changes = {}) {
  const g = game({ id, state: "upcoming", started: false, date: "2026-10-10T23:00Z", ...changes });
  g.teams[0].id = teamIds[0]; g.teams[1].id = teamIds[1];
  return g;
}
function fakeClock(start = Date.parse("2026-10-10T20:00:00Z")) {
  let now = start, seq = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = Math.max(now, next[1].at); timers.delete(next[0]); next[1].fn();
        await flush();
      }
      now = end; await flush();
    },
  };
  return clock;
}
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

test("route validates input before any upstream call and serves no-store JSON", async () => {
  let calls = 0; upstream = async () => { calls++; return json({}); };
  for (const query of ["", "?event=abc&phase=final", "?event=12345&phase=final", "?event=401858481&phase=live", "?event=401858481&phase=final&refresh=2", "?event=401858481&phase=final&url=https://evil.test"]) {
    const response = await route.GET(new Request(`http://local/api/stats${query}`));
    if (query.includes("url=")) continue;
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 1, "only the valid request with an ignored extra parameter reached upstream");
  let requested = "";
  upstream = async url => { requested = String(url); return json(summary("final", "401000001")); };
  const ok = await route.GET(new Request("http://local/api/stats?event=401000001&phase=final"));
  assert.equal(ok.status, 200);
  assert.equal(requested, "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401000001");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await ok.json()).eventId, "401000001");
  upstream = async () => json({ error: "nope" }, 500);
  const failed = await route.GET(new Request("http://local/api/stats?event=401000002&phase=final"));
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("retry-after"), "30");
});

test("server cache: TTL by phase, original checkedAt on hits, LRU bound 20, phase/refresh revalidation", async () => {
  let now = Date.parse("2026-10-10T20:00:00Z"), calls = 0, status;
  const service = createStatsService(async url => { calls++; const id = new URL(url).searchParams.get("event"); return json(summary(id.startsWith("5") ? "live" : "final", id, status)); }, () => now);
  const first = await service.get("401000010", "final", false);
  now += 299_000;
  const hit = await service.get("401000010", "final", false);
  assert.equal(calls, 1); assert.equal(hit.stats.checkedAt, first.stats.checkedAt);
  now += 2000;
  await service.get("401000010", "final", false); assert.equal(calls, 2);
  // Started snapshots: 15 seconds.
  await service.get("501000010", "started", false); now += 14_000;
  await service.get("501000010", "started", false); assert.equal(calls, 3);
  now += 2000; await service.get("501000010", "started", false); assert.equal(calls, 4);
  // A phase hint that disagrees with the cached source phase, or refresh=1, bypasses a fresh entry.
  await service.get("401000010", "started", false); assert.equal(calls, 5);
  await service.get("401000010", "final", true); assert.equal(calls, 6);
  for (let i = 0; i < 25; i++) await service.get(String(402000000 + i), "final", false);
  assert.equal(service.size(), 20);
});

test("server admission: at most two upstream fetches; excess gets 503 Retry-After, never a stale mismatched snapshot", async () => {
  const pending = [];
  let calls = 0;
  const service = createStatsService(url => { calls++; return new Promise(resolve => pending.push(() => resolve(json(summary("final", new URL(url).searchParams.get("event")))))); });
  // Warm a final entry, then flip the hint while two fetches occupy the isolate.
  const warm = service.get("401000020", "final", false); pending.shift()(); await warm;
  const a = service.get("401000021", "final", false), b = service.get("401000022", "final", false);
  const denied = await service.get("401000020", "started", false);
  assert.deepEqual([denied.status, denied.retryAfter], [503, 5]);
  assert.equal(denied.stats, undefined);
  pending.forEach(resolve => resolve()); await Promise.all([a, b]);
  assert.equal(calls, 3);
});

test("server upstream deadline: 4 seconds covers fetch and parse", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const service = createStatsService((url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const result = service.get("401000030", "final", false);
  t.mock.timers.tick(3999); await flush();
  t.mock.timers.tick(1);
  assert.equal((await result).status, 502);
});

test("client: authoritative Worker answers never fall back; network/invalid failures fall back only when enabled", async () => {
  const request = { eventId: "401858481", teamIds: FINAL_IDS, phase: "final", refresh: false };
  const deadline = () => Date.now() + 8000;
  const calls = [];
  const fetcher = responses => async (url, options) => { calls.push({ url: String(url), mode: options.mode, credentials: options.credentials }); const next = responses[String(url).startsWith("/") ? "worker" : "direct"]; return typeof next === "function" ? next() : next; };
  for (const [worker, reason] of [[json({ error: "busy" }, 503, { "Retry-After": "9" }), "busy"], [json({ error: "x" }, 429), "busy"], [json({}, 400), "invalid"], [json({ error: "ESPN" }, 502, { "Retry-After": "30" }), "upstream"]]) {
    calls.length = 0;
    const outcome = await loadGameStats(request, deadline(), new AbortController().signal, fetcher({ worker, direct: json(fixture("final")) }), Date.now, true);
    assert.equal(outcome.reason, reason);
    assert.equal(calls.length, 1, `${reason} must not reach direct ESPN`);
  }
  // Identity mismatch from the Worker: no fallback.
  calls.length = 0;
  const wrong = normalizeGameStats(fixture("final"), "401858481", new Date().toISOString()); wrong.teamIds = ["158", "84"];
  assert.equal((await loadGameStats(request, deadline(), new AbortController().signal, fetcher({ worker: json(wrong), direct: json(fixture("final")) }), Date.now, true)).reason, "identity");
  assert.equal(calls.length, 1);
  // Unreachable Worker: fallback disabled by default.
  calls.length = 0;
  const down = { worker: () => Promise.reject(new TypeError("network")), direct: json(fixture("final")) };
  assert.equal((await loadGameStats(request, deadline(), new AbortController().signal, fetcher(down))).reason, "network");
  assert.equal(calls.length, 1);
  // When enabled, the direct path uses anonymous CORS and the same normalizer.
  calls.length = 0;
  const direct = await loadGameStats(request, deadline(), new AbortController().signal, fetcher(down), Date.now, true);
  assert.equal(direct.kind, "ok");
  assert.deepEqual(calls.map(c => [c.mode, c.credentials]), [["same-origin", "same-origin"], ["cors", "omit"]]);
  assert.equal(calls[1].url, summaryUrl("401858481"));
  // Byte-identical contract with checkedAt excluded.
  const worker = await loadGameStats(request, deadline(), new AbortController().signal, fetcher({ worker: json(normalizeGameStats(fixture("final"), "401858481", "2026-10-10T20:00:00.000Z")) }));
  const strip = s => JSON.stringify({ ...s, checkedAt: undefined });
  assert.equal(strip(worker.stats), strip(direct.stats));
  // A Worker body that fails the public contract is treated as invalid.
  assert.equal((await loadGameStats(request, deadline(), new AbortController().signal, fetcher({ worker: json({ ...worker.stats, odds: [] }) }))).reason, "invalid");
  assert.equal(retryAfterSeconds("100000"), 300); assert.equal(retryAfterSeconds("0"), 1); assert.equal(retryAfterSeconds("soon"), undefined);
});

test("client deadline: Worker gets min(5s, remaining); an expired budget never dispatches", async t => {
  const request = { eventId: "401858481", teamIds: FINAL_IDS, phase: "final", refresh: false };
  let calls = 0;
  assert.equal((await loadGameStats(request, Date.now() + 500, new AbortController().signal, async () => { calls++; return json({}); })).reason, "expired");
  assert.equal(calls, 0);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("t", "AbortError"))));
  let settled = false;
  const outcome = loadGameStats(request, 8000, new AbortController().signal, hang).then(v => { settled = true; return v; });
  t.mock.timers.tick(4999); await flush(); assert.equal(settled, false);
  t.mock.timers.tick(1); assert.equal((await outcome).reason, "network");
  // With 3s remaining (queue already used 5s), the Worker gets only 3s.
  settled = false;
  const late = loadGameStats(request, Date.now() + 3000, new AbortController().signal, hang).then(v => { settled = true; return v; });
  t.mock.timers.tick(2999); await flush(); assert.equal(settled, false);
  t.mock.timers.tick(1); assert.equal((await late).reason, "network");
});

test("scheduler: two active, FIFO fairness, one entry per card, deadline includes queue time, cancellation", async () => {
  const clock = fakeClock(), scheduler = createStatsScheduler(clock);
  const started = [], results = {}, resolvers = {};
  const run = name => (deadline, signal) => { started.push([name, deadline - clock.now()]); return new Promise((resolve, reject) => { resolvers[name] = resolve; signal.addEventListener("abort", () => reject(new Error("aborted"))); }); };
  for (const name of ["a", "b", "c", "d"]) scheduler.enqueue(name, run(name), outcome => { results[name] = outcome; });
  scheduler.enqueue("a", run("a-again"), () => assert.fail("duplicate demand must be ignored"));
  assert.deepEqual(started.map(s => s[0]), ["a", "b"]);
  assert.deepEqual(scheduler.stats(), { active: 2, queued: 2 });
  await clock.advance(3000);
  resolvers.a({ kind: "ok", stats: null }); await flush();
  // c starts after 3s in the queue with only 5s of its eight-second budget left.
  assert.deepEqual(started[2], ["c", 5000]);
  scheduler.cancel("b"); await flush();
  assert.equal(results.b, undefined, "canceled work settles nothing");
  assert.deepEqual(started.map(s => s[0]), ["a", "b", "c", "d"]);
  // Queued expiry: e waits behind two slow cards and expires locally at 8s.
  scheduler.enqueue("e", run("e"), outcome => { results.e = outcome; });
  scheduler.enqueue("f", run("f"), outcome => { results.f = outcome; });
  await clock.advance(8000);
  assert.deepEqual([results.e, results.f], [{ kind: "failed", reason: "expired" }, { kind: "failed", reason: "expired" }]);
  assert.equal(started.some(s => s[0] === "e"), false);
});

// Two-layer harness: real controller + scheduler + client + route-equivalent service.
function harness({ live = true, upstreamFor } = {}) {
  const clock = fakeClock(), memory = createStatsMemory(), upstreamCalls = [], workerCalls = [];
  const service = createStatsService(async url => { const id = new URL(url).searchParams.get("event"); upstreamCalls.push(id); return upstreamFor(id); }, clock.now);
  const worker = async url => {
    const params = new URL(url, "http://local").searchParams; workerCalls.push(Object.fromEntries(params));
    const result = await service.get(params.get("event"), params.get("phase"), params.get("refresh") === "1");
    return result.status === 200 ? json(result.stats) : json({ error: result.error }, result.status, { "Retry-After": String(result.retryAfter) });
  };
  const scheduler = createStatsScheduler(clock);
  const controller = (owner = "card") => new StatsController(owner, scheduler, (req, deadline, signal) => loadGameStats(req, deadline, signal, worker, clock.now), clock, memory, live);
  return { clock, service, upstreamCalls, workerCalls, controller, scheduler };
}
const open = (g, extra = {}) => ({ game: g, expanded: true, visible: true, online: true, ...extra });

test("TWO-LAYER kickoff: a warm 5-minute pregame Worker entry is revalidated when the scoreboard starts", async () => {
  let started = false;
  const h = harness({ upstreamFor: id => json(summary("pregame", id, started ? LIVE_STATUS : undefined)) });
  const g = cardGame("401100001", PREGAME_IDS), card = h.controller();
  card.update(open(g)); await h.clock.advance(0);
  assert.equal(card.state.snapshot.sourcePhase, "pregame");
  assert.equal(h.upstreamCalls.length, 1);
  // The scoreboard reports kickoff 60 seconds later; the Worker entry is still fresh.
  await h.clock.advance(60_000); started = true;
  const kicked = { ...g, state: "live", started: true };
  card.update(open(kicked));
  assert.equal(card.state.snapshot, null, "season averages are not carried into the started generation");
  await h.clock.advance(0);
  // Both the advisory phase and the client-observed status correction revalidate.
  assert.deepEqual(h.workerCalls.at(-1), { event: "401100001", phase: "started", refresh: "1" });
  assert.equal(h.upstreamCalls.length, 2, "Worker went upstream instead of serving the pregame entry");
  assert.equal(card.state.snapshot.sourcePhase, "started");
});

test("TWO-LAYER still-behind upstream yields catching-up without rewriting the source phase", async () => {
  const h = harness({ upstreamFor: id => json(summary("pregame", id)) });
  const g = cardGame("401100002", PREGAME_IDS), card = h.controller();
  card.update(open(g)); await h.clock.advance(0);
  card.update(open({ ...g, state: "live", started: true })); await h.clock.advance(0);
  assert.equal(h.upstreamCalls.length, 2);
  assert.equal(card.state.snapshot.sourcePhase, "pregame");
  const { statsDisplay } = await bundle("lib/game-stats.ts");
  assert.deepEqual(statsDisplay(card.state.snapshot, "started"), { mode: "catching-up", reason: "season-only" });
});

test("TWO-LAYER denied admission during a phase flip gives a retry state, never the old snapshot", async () => {
  const hold = [];
  const h = harness({ upstreamFor: id => id === "401100003" && !hold.length ? json(summary("final", id)) : new Promise(resolve => hold.push(() => resolve(json(summary("final", id))))) });
  const g = cardGame("401100003", FINAL_IDS, { state: "final", started: true }), card = h.controller("card-final");
  card.update(open(g)); await h.clock.advance(0);
  assert.equal(card.state.snapshot.sourcePhase, "final");
  hold.push(() => {});
  // Two other isolate fetches occupy admission.
  const busy = [h.service.get("401100004", "final", false), h.service.get("401100005", "final", false)];
  await flush();
  card.update(open({ ...g, state: "live" })); await h.clock.advance(0);
  assert.equal(card.state.snapshot, null);
  assert.equal(card.state.failure, "busy");
  assert.ok(card.state.retryAt > h.clock.now());
  hold.forEach(resolve => resolve()); await Promise.all(busy);
});

test("TWO-LAYER final-to-live correction and same-phase matchup/date correction revalidate upstream", async () => {
  const h = harness({ upstreamFor: id => json(summary("final", id)) });
  const g = cardGame("401100006", FINAL_IDS, { state: "final", started: true }), card = h.controller("card-correct");
  card.update(open(g)); await h.clock.advance(0);
  // Final → live correction: new generation with started hint and refresh.
  card.update(open({ ...g, state: "live" })); await h.clock.advance(0);
  assert.deepEqual(h.workerCalls.at(-1), { event: "401100006", phase: "started", refresh: "1" });
  assert.equal(h.upstreamCalls.length, 2);
  // Back to final within the five-minute TTL: the first final is not restored; the
  // warm final Worker entry is bypassed.
  card.update(open(g));
  assert.equal(card.state.snapshot, null);
  await h.clock.advance(0);
  assert.deepEqual(h.workerCalls.at(-1), { event: "401100006", phase: "final", refresh: "1" });
  assert.equal(h.upstreamCalls.length, 3);
  // A same-phase date correction also uses refresh=1.
  card.update(open({ ...g, date: "2026-10-10T23:30Z" }));
  assert.equal(card.state.snapshot, null);
  await h.clock.advance(0);
  assert.deepEqual(h.workerCalls.at(-1), { event: "401100006", phase: "final", refresh: "1" });
  assert.equal(h.upstreamCalls.length, 4);
  assert.equal(statsGeneration({ ...g, date: "2026-10-10T23:30Z" }) === statsGeneration(g), false);
});

test("ROUND TRIP: date A→B→A, matchup X→Y→X and exceptional detours never restore a prior observation", async () => {
  const h = harness({ upstreamFor: id => json(summary("final", id)) });
  const g = cardGame("401100090", FINAL_IDS, { state: "final", started: true }), card = h.controller("round");
  const loads = () => h.workerCalls.filter(c => c.event === "401100090");
  card.update(open(g)); await h.clock.advance(0);
  const first = card.state.snapshot;
  for (const detour of [{ date: "2026-10-10T16:30Z" }, { teams: [g.teams[1], g.teams[0]] }, { state: "other", status: "Postponed" }]) {
    const before = loads().length;
    card.update(open({ ...g, ...detour })); await h.clock.advance(0);
    card.update(open(g));
    assert.equal(card.state.snapshot, null, JSON.stringify(detour));
    await h.clock.advance(0);
    // The exceptional detour itself makes no request; every return revalidates once.
    assert.equal(loads().length, before + (detour.state === "other" ? 1 : 2), JSON.stringify(detour));
    assert.equal(loads().at(-1).refresh, "1");
    assert.notEqual(card.state.snapshot, first);
  }
  // The swapped matchup's Worker answer has reversed IDs; identity rejects it instead of showing it.
  const swapped = h.controller("swap");
  swapped.update(open({ ...g, teams: [g.teams[1], g.teams[0]] })); await h.clock.advance(0);
  assert.equal(swapped.state.snapshot, null);
  assert.equal(swapped.state.failure, "identity");
});

test("ROUND TRIP with denied admission and a still-behind source: no old snapshot returns", async () => {
  const hold = [];
  let behind = false;
  const h = harness({ upstreamFor: id => id !== "401100091" ? new Promise(resolve => hold.push(() => resolve(json(summary("final", id))))) : json(summary("final", id, behind ? LIVE_STATUS : undefined)) });
  const g = cardGame("401100091", FINAL_IDS, { state: "final", started: true }), card = h.controller("deny");
  card.update(open(g)); await h.clock.advance(0);
  card.update(open({ ...g, state: "live" })); await h.clock.advance(0);
  // Occupy admission, then return to final: denied, retry state, no restored final.
  const busy = [h.service.get("401100092", "final", false), h.service.get("401100093", "final", false)];
  await flush();
  card.update(open(g)); await h.clock.advance(0);
  assert.equal(card.state.snapshot, null);
  assert.equal(card.state.failure, "busy");
  hold.forEach(resolve => resolve()); await Promise.all(busy);
  // After backoff the source is still behind (reports live): catching up, not the old final.
  behind = true;
  await h.clock.advance(card.state.retryAt - h.clock.now());
  assert.equal(card.state.snapshot.sourcePhase, "started");
  assert.equal(h.workerCalls.at(-1).refresh, "1");
  const { statsDisplay } = await bundle("lib/game-stats.ts");
  assert.equal(statsDisplay(card.state.snapshot, "final").mode, "catching-up");
});

test("REMOUNT: an unchanged generation is reused across controllers; a correction survives remount until loaded", async () => {
  const resolvers = [];
  const h = harness({ upstreamFor: id => new Promise(resolve => resolvers.push(() => resolve(json(summary("final", id))))) });
  const g = cardGame("401100094", FINAL_IDS, { state: "final", started: true });
  const first = h.controller("mount-1");
  first.update(open(g)); await flush(); resolvers.shift()(); await flush();
  assert.ok(first.state.snapshot);
  first.dispose();
  // A section move remounts the card: unchanged generation within TTL, no request.
  const calls = h.workerCalls.length, second = h.controller("mount-2");
  second.update(open(g)); await h.clock.advance(0);
  assert.equal(second.state.snapshot, first.state.snapshot);
  assert.equal(h.workerCalls.length, calls);
  // Date correction observed, then the card remounts before its load completes.
  second.update(open({ ...g, date: "2026-10-10T16:30Z" })); await flush();
  second.dispose();
  const third = h.controller("mount-3");
  third.update(open({ ...g, date: "2026-10-10T16:30Z" })); await flush();
  assert.equal(third.state.snapshot, null);
  assert.equal(h.workerCalls.at(-1).refresh, "1", "the pending correction still asks for revalidation");
});

test("controller: live disabled and exceptional games make zero requests and no spinner", async () => {
  const h = harness({ live: false, upstreamFor: id => json(summary("live", id)) });
  const live = h.controller("live"); live.update(open(cardGame("401100010", ["251", "201"], { state: "live", started: true })));
  const delayed = h.controller("delayed"); delayed.update(open(cardGame("401100011", ["251", "201"], { state: "delayed", started: true })));
  const other = h.controller("other"); other.update(open(cardGame("401100012", ["251", "201"], { state: "other", status: "Postponed" })));
  await h.clock.advance(60_000);
  assert.deepEqual([live.state.mode, delayed.state.mode, other.state.mode], ["disabled", "disabled", "exception"]);
  assert.equal([live, delayed, other].some(c => c.state.pending), false);
  assert.equal(h.workerCalls.length, 0);
});

test("controller: collapsed cards never fetch; collapse/hide/offline cancel; resume loads once", async () => {
  const pending = [];
  const h = harness({ upstreamFor: id => new Promise(resolve => pending.push(() => resolve(json(summary("final", id))))) });
  const collapsed = h.controller("c0");
  collapsed.update(open(cardGame("401100020", FINAL_IDS, { state: "final", started: true }), { expanded: false })); await h.clock.advance(1000);
  assert.equal(h.workerCalls.length, 0);
  for (const [i, change] of [{ expanded: false }, { visible: false }, { online: false }].entries()) {
    const g = cardGame(String(401100021 + i), FINAL_IDS, { state: "final", started: true }), card = h.controller(`c${i + 1}`);
    card.update(open(g)); await flush();
    assert.equal(card.state.pending, "loading");
    card.update(open(g, change)); await flush();
    assert.equal(card.state.pending, null);
    assert.deepEqual(h.scheduler.stats(), { active: 0, queued: 0 });
    // A client abort does not cancel the Worker's own bounded upstream fetch, which may complete and cache.
    pending.splice(0).forEach(resolve => resolve()); await flush();
    assert.equal(card.state.snapshot, null, "a canceled request cannot deliver late data");
    assert.equal(card.state.failure, null);
    const calls = h.workerCalls.length;
    card.update(open(g)); card.update(open(g)); await flush();
    assert.equal(h.workerCalls.length, calls + 1, "resume starts exactly one load");
    assert.ok(card.state.snapshot, "resume is served from the completed Worker entry");
  }
});

test("controller: started polling every 30s, pregame revalidates at 5-minute TTL, finals wait for reopen or manual refresh", async () => {
  const h = harness({ upstreamFor: id => json(summary(id.endsWith("1") ? "live" : id.endsWith("2") ? "pregame" : "final", id)) });
  const live = h.controller("p1"), pre = h.controller("p2"), fin = h.controller("p3");
  live.update(open(cardGame("401100031", ["251", "201"], { state: "live", started: true })));
  pre.update(open(cardGame("401100032", PREGAME_IDS)));
  const finalGame = cardGame("401100033", FINAL_IDS, { state: "final", started: true });
  fin.update(open(finalGame));
  await h.clock.advance(0);
  const count = id => h.workerCalls.filter(c => c.event === id).length;
  await h.clock.advance(30_000);
  assert.deepEqual([count("401100031"), count("401100032"), count("401100033")], [2, 1, 1]);
  await h.clock.advance(270_000);
  assert.deepEqual([count("401100031"), count("401100032"), count("401100033")], [11, 2, 1]);
  // Final reopened after its 5-minute reuse window revalidates once.
  fin.update(open(finalGame, { expanded: false })); fin.update(open(finalGame)); await h.clock.advance(0);
  assert.equal(count("401100033"), 2);
  // Reopened within the window: reuse, no request.
  fin.update(open(finalGame, { expanded: false })); fin.update(open(finalGame)); await h.clock.advance(0);
  assert.equal(count("401100033"), 2);
  fin.retry(); await h.clock.advance(0);
  assert.equal(count("401100033"), 3);
  assert.equal(h.workerCalls.at(-1).refresh, "1");
});

test("controller: backoff 60/120/300 with bounded Retry-After; manual retry cannot bypass it and is one attempt", async () => {
  let mode = "fail";
  const h = harness({ upstreamFor: id => mode === "fail" ? json({}, 500) : json(summary("final", id)) });
  const g = cardGame("401100040", FINAL_IDS, { state: "final", started: true }), card = h.controller("b1");
  card.update(open(g)); await h.clock.advance(0);
  const gaps = [];
  let last = h.clock.now();
  for (let i = 0; i < 4; i++) {
    const at = card.state.retryAt;
    gaps.push(at - last);
    // Manual retry during backoff makes no request.
    const calls = h.workerCalls.length;
    assert.equal(card.retry(), false);
    await h.clock.advance(Math.floor((at - h.clock.now()) / 2));
    assert.equal(card.retry(), false);
    assert.equal(h.workerCalls.length, calls, "no early request");
    await h.clock.advance(at - h.clock.now()); last = at;
    assert.equal(h.workerCalls.length, calls + 1, "exactly one eligible attempt");
  }
  // Worker 502 Retry-After 30 is below each backoff step.
  assert.deepEqual(gaps, [60_000, 120_000, 300_000, 300_000]);
  // A failed revalidation of a final with a snapshot: once backoff passes, Retry is one attempt.
  mode = "ok"; await h.clock.advance(card.state.retryAt - h.clock.now());
  assert.ok(card.state.snapshot);
  await h.clock.advance(301_000);
  card.update(open(g, { expanded: false })); mode = "fail"; card.update(open(g)); await h.clock.advance(0);
  assert.equal(card.state.failure, "upstream"); assert.ok(card.state.snapshot, "old final stays visible with a warning");
  assert.equal(card.retry(), false);
  await h.clock.advance(card.state.retryAt - h.clock.now());
  const calls = h.workerCalls.length;
  mode = "ok";
  assert.equal(card.retry(), true); assert.equal(card.retry(), false);
  await h.clock.advance(0);
  assert.equal(h.workerCalls.length, calls + 1);
  assert.equal(h.workerCalls.at(-1).refresh, "1");
  assert.equal(card.state.failure, null);
});

test("controller: late generations are rejected and snapshots replace whole", async () => {
  const resolvers = [];
  const h = harness({ upstreamFor: id => new Promise(resolve => resolvers.push(() => resolve(json(summary("final", id))))) });
  const g = cardGame("401100050", FINAL_IDS, { state: "final", started: true }), card = h.controller("g1");
  card.update(open(g)); await flush();
  card.update(open({ ...g, state: "live" })); await flush();
  resolvers[0]?.(); await flush();
  assert.equal(card.state.snapshot, null, "the old final generation cannot populate the live generation");
  assert.equal(card.state.expected, "started");
});

test("opening several cards adds no scoreboard requests and holds at most two loads", async () => {
  const resolvers = [];
  const h = harness({ upstreamFor: id => new Promise(resolve => resolvers.push(() => resolve(json(summary("final", id))))) });
  const cards = Array.from({ length: 5 }, (_, i) => h.controller(`m${i}`));
  cards.forEach((card, i) => card.update(open(cardGame(String(401100060 + i), FINAL_IDS, { state: "final", started: true }))));
  await flush();
  assert.deepEqual(h.scheduler.stats(), { active: 2, queued: 3 });
  assert.equal(h.workerCalls.every(c => Object.keys(c).join() === "event,phase,refresh"), true);
  while (resolvers.length) { resolvers.shift()(); await flush(); }
  assert.equal(cards.every(card => card.state.snapshot), true);
});

test("controller: queue expiry is a local retry that does not advance upstream backoff", async () => {
  const clock = fakeClock(), memory = createStatsMemory(), outcomes = [{ kind: "failed", reason: "expired" }, { kind: "failed", reason: "upstream", retryAfter: 600 }];
  const scheduler = createStatsScheduler(clock);
  const card = new StatsController("q1", scheduler, async () => outcomes.shift(), clock, memory, true);
  const g = cardGame("401100070", FINAL_IDS, { state: "final", started: true });
  card.update(open(g)); await clock.advance(0);
  assert.equal(card.state.failure, "expired");
  assert.equal(card.state.retryAt - clock.now(), 30_000);
  await clock.advance(30_000);
  // First upstream failure is still the first backoff step; Retry-After is clamped to 300s.
  assert.equal(card.state.failure, "upstream");
  assert.equal(card.state.retryAt - clock.now(), 300_000);
  assert.equal(memory.observations.get("401100070").failures, 1);
  assert.equal(memory.observations.get("401100070").generation, statsGeneration(g));
});

test("REMOUNT after a failed refresh: live ↔ started-delay keeps the failure, backoff and snapshot until a success", async () => {
  let mode = "ok";
  const h = harness({ upstreamFor: id => mode === "ok" ? json(summary("live", id)) : json({}, 500) });
  const g = cardGame("401100095", ["251", "201"], { state: "live", started: true });
  const first = h.controller("live-section");
  first.update(open(g)); await h.clock.advance(0);
  assert.ok(first.state.snapshot);
  mode = "fail"; await h.clock.advance(30_000);
  assert.equal(first.state.failure, "upstream");
  const { retryAt, snapshot } = first.state;
  first.dispose();
  // The score now reports a pause: same generation (started), new section, new controller.
  const paused = { ...g, state: "delayed" };
  assert.equal(statsGeneration(paused), statsGeneration(g));
  const second = h.controller("delayed-section"), calls = h.workerCalls.length;
  second.update(open(paused)); await h.clock.advance(0);
  assert.deepEqual([second.state.failure, second.state.retryAt, second.state.snapshot], ["upstream", retryAt, snapshot]);
  assert.equal(h.workerCalls.length, calls, "the remount does not bypass backoff");
  assert.equal(second.retry(), false);
  second.dispose();
  // Back to live (same generation): still the failure; then a success clears it.
  const third = h.controller("live-again");
  third.update(open(g)); await h.clock.advance(0);
  assert.equal(third.state.failure, "upstream");
  mode = "ok"; await h.clock.advance(retryAt - h.clock.now());
  assert.equal(third.state.failure, null);
  assert.notEqual(third.state.snapshot, snapshot);
  third.dispose();
});

test("REMOUNT: a new generation (correction) clears a remembered failure", async () => {
  let mode = "ok";
  const h = harness({ upstreamFor: id => mode === "ok" ? json(summary("final", id)) : json({}, 500) });
  const g = cardGame("401100096", FINAL_IDS, { state: "final", started: true }), card = h.controller("corr");
  card.update(open(g)); await h.clock.advance(0);
  mode = "fail"; await h.clock.advance(301_000);
  card.update(open(g, { expanded: false })); card.update(open(g)); await h.clock.advance(0);
  assert.equal(card.state.failure, "upstream");
  mode = "ok";
  card.update(open({ ...g, date: "2026-10-10T16:30Z" }));
  assert.equal(card.state.failure, null);
  await h.clock.advance(0);
  assert.equal(card.state.failure, null); assert.ok(card.state.snapshot);
});
