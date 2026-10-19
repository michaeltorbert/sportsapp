import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { classify, easternDate, shiftDate, accWeek } = await bundle("lib/football.ts");
const { scoreboardScope } = await bundle("lib/scoreboard-views.ts");

// Drive hook lifecycle and controlled feed responses without a browser or network.
const root = fileURLToPath(new URL("..", import.meta.url));
async function hookModule(stubScores) {
  const output = await build({
    ...(stubScores ? { entryPoints: ["lib/use-scoreboard.ts"] }
      : { stdin: { contents: 'export { useScoreboard } from "./lib/use-scoreboard"; export { halftimeLabel, invalidateHalftime } from "./lib/halftime";', resolveDir: root, loader: "ts" } }),
    absWorkingDir: root, bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "hook-test-runtime", setup(build) {
      build.onResolve({ filter: stubScores ? /^(react|\.\/score-client)$/ : /^react$/ }, args => ({ path: args.path, namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "react"
        ? "export const useSyncExternalStore=(...a)=>globalThis.scoreHookTest.useSyncExternalStore(...a), useState=(...a)=>globalThis.scoreHookTest.useState(...a), useRef=(...a)=>globalThis.scoreHookTest.useRef(...a), useEffect=(...a)=>globalThis.scoreHookTest.useEffect(...a), useCallback=(...a)=>globalThis.scoreHookTest.useCallback(...a);"
        : "export const requestScores=(...a)=>globalThis.scoreHookTest.requestScores(...a), enrichScores=(...a)=>globalThis.scoreHookTest.enrichScores(...a);" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
}
const { useScoreboard } = await hookModule(true);
// Only React is replaced: the real score client, enrichment and halftime registry share one module graph.
const real = await hookModule(false);

function harness(t, loadScores, saved = {}, { hook = useScoreboard, enrich, fetch: fetcher, dailyOnly = false, controlledDate } = {}) {
  const slots = [], pending = [], requested = [], enriched = [];
  let cursor = 0, scope = "daily", value, generation = 0;
  const globals = new Map();
  const replace = (name, value) => { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value }); };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const runtime = {
    useSyncExternalStore(subscribe, snapshot) { return snapshot(); },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    // Stubbed score client: scores-only requests carry their own generation; enrichment is recorded.
    async requestScores(...args) { const request = { generation: ++generation, epoch: 0 }; request.board = await loadScores(...args); requested.push(request); return request; },
    async enrichScores(request, signal) { enriched.push(request); return enrich ? enrich(request, signal) : request.board; },
  };
  const storage = Object.assign(Object.create(null), saved);
  Object.defineProperties(storage, {
    getItem: { value: k => storage[k] ?? null },
    setItem: { value: (k, v) => { storage[k] = v; } },
    removeItem: { value: k => { delete storage[k]; } },
  });
  replace("scoreHookTest", runtime);
  replace("localStorage", storage);
  replace("location", { search: "" }); replace("navigator", { onLine: true });
  replace("document", { hidden: false, addEventListener() {}, removeEventListener() {} });
  replace("window", { setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} });
  if (fetcher) replace("fetch", fetcher);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The controlled lifecycle harness supplies the hook runtime.
  const render = () => { cursor = 0; value = hook(scope, dailyOnly, controlledDate); while (pending.length) pending.shift()(); return value; };
  // Each effect cleanup runs once, whether unmounted by the test or afterwards.
  const unmount = () => { for (const slot of slots) if (typeof slot?.cleanup === "function") { const cleanup = slot.cleanup; delete slot.cleanup; cleanup(); } };
  t.after(() => { unmount(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { render, storage, requested, enriched, unmount, switchTo(s) { scope = s; return render(); },
    async settle() { for (let i = 0; i < 6; i++) { await new Promise(resolve => setTimeout(resolve, 0)); render(); } return value; },
    // Real fetch/Response chains need a variable number of turns.
    async until(check, limit = 400) { for (let i = 0; i < limit; i++) { await new Promise(resolve => setTimeout(resolve, 0)); render(); if (check(value)) return value; } throw new Error("hook did not reach the expected state"); } };
}

const requestScope = (date, end) => date !== end ? "week" : "daily";

test("switching periods keeps the daily and weekly boards without new requests, and only the full-FBS week is fetched", async t => {
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), requests = [];
  const acc = game({ id: "acc" }); acc.teams[0].conferenceId = "1";
  const future = game({ id: "future-ranked", state: "upcoming", date: `${accWeek(calendar).end}T23:30:00Z` });
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    requests.push({ date, end, accOnly });
    const scope = requestScope(date, end);
    return scoreboard(scope === "daily" && date === yesterday ? [] : scope === "week" ? [acc, future] : [game()], date, { endDate: end });
  });
  h.render(); const initial = await h.settle();
  assert.equal(initial.boards.daily.games.length, 1);
  assert.deepEqual(initial.boards.week.games.map(g => g.id), ["acc", "future-ranked"]);
  assert.equal(requests.length, 3);
  // ORD-011: no ACC-only weekly request; ACC games come from the same full-FBS weekly board.
  assert.ok(requests.every(request => request.accOnly === false));
  assert.deepEqual(requests.filter(request => request.date !== request.end), [{ date: accWeek(calendar).start, end: accWeek(calendar).end, accOnly: false }]);
  for (const period of ["week", "day", "week", "day"]) {
    const scope = scoreboardScope(period), v = h.switchTo(scope);
    assert.equal(v.data, initial.boards[scope]);
    assert.deepEqual(v.boards, initial.boards);
    assert.equal(v.refresh, initial.refresh);
  }
  await h.settle(); assert.equal(requests.length, 3);
  initial.setDate(shiftDate(calendar, -3));
  const changed = h.render(); assert.equal(changed.boards.daily, null);
  assert.equal(changed.boards.week, initial.boards.week);
  const next = await h.settle(); assert.equal(next.boards.daily.date, shiftDate(calendar, -3));
  assert.equal(h.switchTo("week").data.date, accWeek(calendar).start);
  // Week to Day returns to the manually chosen day.
  assert.equal(h.switchTo("daily").date, shiftDate(calendar, -3));
  assert.equal(next.followToday, false);
  next.setDate(null); h.render();
  const resumed = await h.settle(); assert.equal(resumed.date, calendar); assert.equal(resumed.followToday, true);
});

for (const failedScope of ["daily", "week"]) test(`failed ${failedScope} refresh keeps its board and isolates its error until recovery`, async t => {
  const yesterday = shiftDate(easternDate(), -1); let failing = false;
  const h = harness(t, async (date, signal, fetcher, end = date) => {
    const scope = requestScope(date, end);
    if (scope === "daily" && date === yesterday) return scoreboard([], date);
    if (scope === failedScope && failing) throw new Error("feed unavailable");
    return scoreboard([game({ id: scope })], date, { endDate: end });
  });
  h.render(); const initial = await h.settle(); failing = true;
  await initial.refresh(); const refreshed = await h.settle();
  for (const scope of ["daily", "week"]) {
    const v = h.switchTo(scope);
    if (scope === failedScope) { assert.equal(v.data, initial.boards[scope]); assert.match(v.error, /Could not refresh/); }
    else { assert.ok(v.data); assert.notEqual(v.data, initial.boards[scope]); assert.equal(v.error, ""); }
  }
  failing = false; await refreshed.refresh(); await h.settle();
  assert.equal(h.switchTo(failedScope).error, "");
});

test("unfinished overnight board is reused only for daily counts while the week loads", async t => {
  const yesterday = shiftDate(easternDate(), -1), requests = [];
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    requests.push({ date, end, accOnly });
    return scoreboard([game({ id: requestScope(date, end) })], date, { endDate: end });
  });
  h.render(); const v = await h.settle();
  assert.equal(v.today, yesterday); assert.equal(v.boards.daily.date, yesterday);
  assert.equal(v.boards.week.date, accWeek(yesterday).start);
  assert.equal(v.boards.week.endDate, accWeek(yesterday).end);
  assert.equal(v.boards.week.games[0].id, "week");
  assert.equal(requests.length, 2);
});

test("saved daily and weekly history cannot cross-contaminate final categories or score changes", async t => {
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), week = accWeek(calendar);
  const dailyKey = `ss:board:${calendar}:${calendar}`, weekKey = `ss:board:week:${week.start}:${week.end}`;
  const earlier = game(); earlier.teams[0].score = 21; earlier.teams[1].score = 20;
  const later = game(); later.teams[0].score = 0;
  const final = { ...later, state: "final" };
  const h = harness(t, async (date, signal, fetcher, end = date) =>
    scoreboard(date === end && date === yesterday ? [] : [structuredClone(final)], date, { endDate: end }), {
    [dailyKey]: JSON.stringify(scoreboard([earlier], calendar)),
    [weekKey]: JSON.stringify(scoreboard([later], week.start, { endDate: week.end })),
    "ss:board:top25:2020-09-03:2020-09-07": "expired",
    "ss:board:week:2020-09-03:2020-09-07": "expired",
    "ss:board:2020-09-03:2020-09-07": "expired",
  });
  h.render(); const v = await h.settle();
  assert.equal(v.boards.daily.games[0].retainedCategories.close, true);
  assert.equal(v.boards.daily.games[0].retainedCategories.upset, true);
  assert.equal(v.boards.daily.games[0].teams[0].changed, true);
  assert.equal(v.boards.week.games[0].retainedCategories.close, false);
  assert.equal(v.boards.week.games[0].retainedCategories.upset, false);
  assert.equal(v.boards.week.games[0].teams[0].changed, false);
  assert.equal(JSON.parse(h.storage.getItem(dailyKey)).games[0].retainedCategories.close, true);
  assert.equal(JSON.parse(h.storage.getItem(weekKey)).games[0].retainedCategories.close, false);
  for (const expired of ["ss:board:top25:2020-09-03:2020-09-07", "ss:board:week:2020-09-03:2020-09-07", "ss:board:2020-09-03:2020-09-07"]) assert.equal(h.storage.getItem(expired), null);
  await v.refresh(); const again = await h.settle();
  assert.equal(again.boards.daily.games[0].retainedCategories.close, true);
  assert.equal(again.boards.week.games[0].retainedCategories.close, false);
});

test("the weekly board restores retained categories from its pre-1.9 top25 key and then owns the week key", async t => {
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), week = accWeek(calendar);
  const legacyKey = `ss:board:top25:${week.start}:${week.end}`, weekKey = `ss:board:week:${week.start}:${week.end}`;
  const earlier = game(); earlier.teams[0].score = 21; earlier.teams[1].score = 20;
  const final = game({ state: "final" }); final.teams[0].score = 0;
  const h = harness(t, async (date, signal, fetcher, end = date) =>
    scoreboard(date === end && date === yesterday ? [] : [structuredClone(final)], date, { endDate: end }), {
    [legacyKey]: JSON.stringify(scoreboard([earlier], week.start, { endDate: week.end })),
  });
  h.render(); const v = await h.settle();
  assert.equal(v.boards.week.games[0].retainedCategories.close, true);
  assert.equal(v.boards.week.games[0].teams[0].changed, true);
  assert.equal(JSON.parse(h.storage.getItem(weekKey)).games[0].retainedCategories.close, true);
  assert.equal(v.boards.daily.games[0].retainedCategories, undefined);
});

test("switching periods during a weekly request neither aborts it nor repeats polling", async t => {
  const yesterday = shiftDate(easternDate(), -1), requests = [];
  let finish, weeklySignal;
  const h = harness(t, async (date, signal, fetcher, end = date) => {
    const scope = requestScope(date, end); requests.push(scope);
    if (scope === "week") { weeklySignal = signal; await new Promise(resolve => { finish = resolve; }); }
    return scoreboard(scope === "daily" && date === yesterday ? [] : [game()], date, { endDate: end });
  });
  h.render(); const loading = await h.settle();
  assert.ok(loading.boards.daily); assert.equal(loading.boards.week, null);
  for (const scope of ["week", "daily", "week"]) h.switchTo(scope);
  assert.equal(weeklySignal.aborted, false); assert.equal(requests.length, 3);
  finish(); const ready = await h.settle();
  assert.equal(ready.data, ready.boards.week); assert.ok(ready.data); assert.equal(ready.refreshing, false);
});

test("Tuesday rollover keeps Monday's week while unfinished and hides obsolete weekly boards once released", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T06:00:00Z") });
  let unfinished = true; const pendingWeeks = [];
  const h = harness(t, async (date, signal, fetcher, end = date) => {
    if (date === end && date === "2026-09-07") return scoreboard(unfinished ? [game()] : [], date);
    if (!unfinished && date !== end) await new Promise(resolve => pendingWeeks.push(resolve));
    return scoreboard([game()], date, { endDate: end });
  });
  h.render(); const held = await h.settle();
  assert.equal(held.today, "2026-09-07");
  assert.equal(held.boards.week.date, "2026-09-03"); assert.equal(held.boards.week.endDate, "2026-09-07");
  unfinished = false; const refresh = held.refresh();
  const transitioning = await h.settle();
  assert.equal(transitioning.today, "2026-09-08");
  assert.equal(transitioning.boards.week, null);
  pendingWeeks.forEach(resolve => resolve()); await refresh;
  const next = await h.settle();
  assert.equal(next.boards.week.date, "2026-09-10"); assert.equal(next.boards.week.endDate, "2026-09-14");
});

test("actual hook delay writes survive opaque storage transfer into a fresh hook and isolate scopes", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T21:00:00Z") });
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), week = accWeek(calendar);
  let phase = "live", saved;
  const load = async (date, signal, fetcher, end = date) => {
    if (date === yesterday && end === date) return scoreboard([], date);
    const g = game({ state: phase === "final" ? "final" : phase });
    // Only daily observes close live play; the weekly board sees a wide game.
    if (phase === "final" || (phase === "live" && end !== date)) g.teams[1].score = 35;
    return scoreboard([g], date, { endDate: end });
  };
  await t.test("first mount observes live then writes started delay", async sub => {
    const h = harness(sub, load); h.render(); const live = await h.settle();
    assert.equal(classify(live.boards.daily.games[0]).close, true);
    phase = "delayed"; await live.refresh(); const delayed = await h.settle();
    assert.equal(classify(delayed.boards.daily.games[0]).close, false);
    saved = { ...h.storage }; // Opaque persisted strings, no reconstruction of metadata.
    assert.equal(typeof saved[`ss:board:${calendar}:${calendar}`], "string");
  });
  phase = "final";
  await t.test("fresh mount restores the persisted observation only for its own scope", async sub => {
    const h = harness(sub, load, saved); h.render(); const final = await h.settle();
    assert.equal(classify(final.boards.daily.games[0]).close, true);
    assert.equal(classify(final.boards.week.games[0]).close, false);
    final.setDate("2026-09-03"); h.render(); const other = await h.settle();
    assert.equal(classify(other.boards.daily.games[0]).close, false);
    assert.equal(other.boards.week.date, week.start);
  });
});

test("overnight probes are scores-only; only a displayed daily board is enriched, with its original request", async t => {
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1);
  const isPrior = board => board.date === yesterday && board.endDate === yesterday;
  await t.test("an unfinished probe is reused and enriched once with its own generation", async sub => {
    const h = harness(sub, async (date, signal, fetcher, end = date) => scoreboard([game({ id: requestScope(date, end) })], date, { endDate: end }));
    h.render(); const v = await h.settle();
    assert.equal(v.today, yesterday);
    const daily = h.enriched.filter(request => isPrior(request.board));
    assert.equal(daily.length, 1);
    assert.equal(daily[0].generation, h.requested[0].generation, "no fresh generation is minted for the deferred enrichment");
  });
  await t.test("a failed probe keeps the held day and warning; the daily board's own request is enriched", async sub => {
    let probes = 0;
    const h = harness(sub, async (date, signal, fetcher, end = date) => {
      if (date === yesterday && end === date && probes++ === 0) throw new Error("feed unavailable");
      return scoreboard([game({ id: requestScope(date, end) })], date, { endDate: end });
    }, { "ss:game-day": yesterday });
    h.render(); const v = await h.settle();
    assert.equal(v.today, yesterday); assert.equal(v.boards.daily.date, yesterday);
    assert.match(v.overnightError, /Could not verify overnight games/);
    const daily = h.enriched.filter(request => isPrior(request.board));
    assert.equal(daily.length, 1);
    assert.equal(daily[0].generation, h.requested.find(request => isPrior(request.board)).generation);
  });
  await t.test("an incomplete probe is not game-day evidence and is never enriched", async sub => {
    const h = harness(sub, async (date, signal, fetcher, end = date) =>
      scoreboard([game({ id: requestScope(date, end) })], date, { endDate: end, ...(date === yesterday && end === date ? { warnings: ["incomplete"] } : {}) }));
    h.render(); const v = await h.settle();
    assert.equal(v.today, calendar); assert.equal(v.boards.daily.date, calendar);
    assert.equal(h.enriched.some(request => isPrior(request.board)), false);
    assert.equal(h.enriched.length, 2, "maintained Day and Week boards are still enriched");
  });
});

// Real score-client fixtures. Every scoreboard request returns the same events;
// normalization keeps only those in the requested Eastern range.
function espnGame(id, date, { phase = "live", away = `${id}-away`, home = `${id}-home`, scores = [21, 7], period, odds } = {}) {
  const status = {
    pre: { period: 0, clock: 0, type: { name: "STATUS_SCHEDULED", state: "pre" } },
    live: { period: period ?? 4, clock: 120, type: { name: "STATUS_IN_PROGRESS", state: "in" } },
    halftime: { period: 2, clock: 0, type: { name: "STATUS_HALFTIME", state: "in" } },
    delayed: { period: period ?? 3, clock: 300, type: { name: "STATUS_DELAYED", state: "in" } },
    final: { period: 4, clock: 0, type: { name: "STATUS_FINAL", state: "post", completed: true } },
  }[phase];
  const team = (teamId, homeAway, score) => ({ id: teamId, homeAway, score: String(phase === "pre" ? 0 : score), curatedRank: { current: 99 }, team: { id: teamId, conferenceId: "1" } });
  return { id, date, status, competitions: [{ ...(odds ? { odds } : {}), competitors: [team(away, "away", scores[0]), team(home, "home", scores[1])] }] };
}
// Home-oriented spread: negative favors home, positive favors away, zero is pick'em.
function espnOdds(away, home, spread) {
  return [{ spread, provider: { id: "1", name: "fixture", priority: 1 }, awayTeamOdds: { favorite: spread > 0, team: { id: away } }, homeTeamOdds: { favorite: spread < 0, team: { id: home } } }];
}
function espnSummary(event, { odds = [], halftimeAnchor } = {}) {
  const [away, home] = event.competitions[0].competitors;
  return { header: { id: event.id, competitions: [{ competitors: [{ homeAway: "away", team: { id: away.team.id } }, { homeAway: "home", team: { id: home.team.id } }],
    status: halftimeAnchor ? { period: 2, type: { name: "STATUS_HALFTIME", state: "in" } } : event.status }] }, pickcenter: odds,
    ...(halftimeAnchor ? { drives: { current: { plays: [{ id: `${event.id}-half`, type: { id: "2" }, period: { number: 2 }, clock: { displayValue: "0:00" }, wallclock: new Date(halftimeAnchor).toISOString() }] } } } : {}) };
}
function espnFeed(events, summaries = new Map()) {
  const feed = { summaries: [], scoreboards: [], gates: [], late: [], hold: () => false, delay: 0, active: 0, peak: 0 };
  feed.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/summary")) {
      const id = u.searchParams.get("event"), body = summaries.get(id);
      feed.summaries.push({ id, signal: options.signal });
      if (body === "hang") return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("canceled", "AbortError")), { once: true }));
      // Controlled fixture: ignores abort and settles only when the test releases it.
      if (body === "late") return new Promise(resolve => feed.late.push(resolve));
      if (feed.delay) { feed.peak = Math.max(feed.peak, ++feed.active); await new Promise(resolve => setTimeout(resolve, feed.delay)); feed.active--; }
      return body ? Response.json(body) : new Response(null, { status: 404 });
    }
    const dates = u.searchParams.get("dates"); feed.scoreboards.push(dates);
    if (feed.hold(dates)) await new Promise(resolve => feed.gates.push(resolve));
    return Response.json({ events: typeof events === "function" ? events() : events });
  };
  feed.count = id => feed.summaries.filter(request => request.id === id).length;
  return feed;
}
const loaded = v => v.boards.daily && v.boards.week && !v.refreshing;
async function mount(t, feed, saved = {}, options = {}) {
  const h = harness(t, null, saved, { hook: real.useScoreboard, fetch: feed.fetch, ...options });
  h.render();
  return { h, value: await h.until(loaded) };
}
const lineOf = (board, id) => board.games.find(g => g.id === id)?.pregameLine;
const boardKeys = storage => Object.keys(storage).filter(key => key.startsWith("ss:board:"));

test("real client: a discarded finished overnight board requests no summaries, while maintained boards and manual yesterday enrich", async t => {
  // Thursday 5pm ET: Wednesday is outside the Thursday–Monday week, so its games are prior-only.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-03T21:00:00Z") });
  const wed = espnGame("wed-final", "2026-09-02T23:00:00Z", { phase: "final" }), thu = espnGame("thu-live", "2026-09-03T19:30:00Z");
  const feed = espnFeed([wed, thu], new Map([wed, thu].map(e => [e.id, espnSummary(e, { odds: espnOdds(`${e.id}-away`, `${e.id}-home`, -7) })])));
  const { h, value } = await mount(t, feed);
  assert.equal(value.today, "2026-09-03"); assert.equal(feed.scoreboards[0], "20260902");
  assert.equal(feed.count("wed-final"), 0, "the discarded probe does no optional summary work");
  for (const scope of ["daily", "week"]) assert.equal(lineOf(value.boards[scope], "thu-live").favoriteId, "thu-live-home");
  assert.ok(feed.count("thu-live") >= 1 && feed.count("thu-live") <= 2, "each maintained board owns its bounded recovery");
  value.setDate("2026-09-02"); h.render();
  const manual = await h.until(v => v.boards.daily?.date === "2026-09-02" && !v.refreshing);
  assert.equal(lineOf(manual.boards.daily, "wed-final").favoriteId, "wed-final-home");
  assert.equal(feed.count("wed-final"), 1, "manual yesterday reuses the probe and enriches it once");
  assert.equal(feed.scoreboards.filter(dates => dates === "20260902").length, 2, "one Wednesday score request per refresh");
});

test("real client: a held unfinished overnight board becomes the daily board and enriches once while Week is selected", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-03T06:00:00Z") });
  const wed = espnGame("wed-live", "2026-09-03T01:00:00Z"), thu = espnGame("thu-later", "2026-09-04T23:00:00Z", { phase: "pre", odds: espnOdds("thu-later-away", "thu-later-home", -3) });
  const feed = espnFeed([wed, thu], new Map([[wed.id, espnSummary(wed, { odds: espnOdds("wed-live-away", "wed-live-home", -7) })]]));
  const h = harness(t, null, {}, { hook: real.useScoreboard, fetch: feed.fetch });
  h.switchTo("week"); const v = await h.until(loaded);
  assert.equal(v.today, "2026-09-02"); assert.equal(v.data, v.boards.week);
  assert.equal(v.boards.daily.date, "2026-09-02");
  assert.equal(lineOf(v.boards.daily, "wed-live").favoriteId, "wed-live-home");
  assert.equal(feed.count("wed-live"), 1);
  assert.deepEqual(feed.scoreboards, ["20260902", "20260903-20260908"], "the probe is reused rather than requested again");
});

test("real client: the Guide's selected daily board enriches while its informational overnight check does not", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-03T21:00:00Z") });
  const wed = espnGame("guide-final", "2026-09-02T23:00:00Z", { phase: "final" });
  const feed = espnFeed([wed], new Map([[wed.id, espnSummary(wed, { odds: espnOdds("guide-final-away", "guide-final-home", -7) })]]));
  const h = harness(t, null, {}, { hook: real.useScoreboard, fetch: feed.fetch, dailyOnly: true, controlledDate: "2026-09-02" });
  h.render(); const v = await h.until(v => v.data && !v.refreshing);
  assert.equal(v.today, "2026-09-03"); assert.equal(v.overnightError, "");
  assert.equal(lineOf(v.data, "guide-final").favoriteId, "guide-final-home");
  assert.deepEqual(feed.scoreboards, ["20260902", "20260902"], "daily board and overnight check each read scores");
  assert.equal(feed.count("guide-final"), 1, "only the selected board requests its summary");
});

// Saturday 5pm ET. Friday has no games, so the overnight probe is discarded.
const saturday = new Date("2026-09-05T21:00:00Z");
const satDaily = "ss:board:2026-09-05:2026-09-05", satWeek = "ss:board:week:2026-09-03:2026-09-07";
const original = { favoriteId: "sat-home", spread: 3, source: "fixture" };
async function observePregame(t, events = () => [espnGame("sat", "2026-09-05T22:00:00Z", { phase: "pre", odds: espnOdds("sat-away", "sat-home", -3) })]) {
  let saved;
  await t.test("first mount observes the pregame line", async sub => {
    const { h, value } = await mount(sub, espnFeed(events));
    for (const scope of ["daily", "week"]) assert.deepEqual(lineOf(value.boards[scope], "sat"), original);
    saved = { ...h.storage }; // Opaque persisted strings only.
  });
  return saved;
}

test("real client: an opaque saved baseline survives kickoff against a contrary summary or pick'em with a cold cache", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const saved = await observePregame(t);
  for (const phase of ["live", "delayed", "final"]) for (const [label, spread] of [["contrary", 10], ["pick'em", 0]]) {
    await t.test(`${phase} with a ${label} summary keeps the saved original`, async sub => {
      const after = espnGame("sat", "2026-09-05T22:00:00Z", { phase });
      const feed = espnFeed([after], new Map([["sat", espnSummary(after, { odds: espnOdds("sat-away", "sat-home", spread) })]]));
      const { value } = await mount(sub, feed, saved);
      for (const scope of ["daily", "week"]) assert.deepEqual(lineOf(value.boards[scope], "sat"), original, scope);
      assert.equal(feed.count("sat"), 0, "a retained baseline is not an odds recovery candidate");
      assert.deepEqual(value.boards.daily.games[0].teams.map(team => team.score), [21, 7]);
    });
  }
});

test("real client: a current pre-kickoff line or pick'em wins; absent or mismatched history recovers normally", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const saved = await observePregame(t);
  const contrary = { favoriteId: "sat-away", spread: 10, source: "fixture" };
  for (const [label, spread, expected] of [["pick'em", 0, { favoriteId: null, spread: 0, source: "fixture" }], ["crossing line", 10, contrary]]) {
    await t.test(`a current pre-kickoff ${label} replaces the saved line`, async sub => {
      const { value } = await mount(sub, espnFeed([espnGame("sat", "2026-09-05T22:00:00Z", { phase: "pre", odds: espnOdds("sat-away", "sat-home", spread) })]), saved);
      for (const scope of ["daily", "week"]) assert.deepEqual(lineOf(value.boards[scope], "sat"), expected);
    });
  }
  const cases = [
    ["without saved history the summary recovers the line", {}, {}],
    ["a changed kickoff rejects the saved baseline", saved, { date: "2026-09-05T23:00:00Z" }],
    ["changed participants reject the saved baseline", saved, { home: "sat-new-home" }],
  ];
  for (const [label, history, change] of cases) {
    await t.test(label, async sub => {
      const home = change.home ?? "sat-home";
      const after = espnGame("sat", change.date ?? "2026-09-05T22:00:00Z", { home });
      const feed = espnFeed([after], new Map([["sat", espnSummary(after, { odds: espnOdds("sat-away", home, 10) })]]));
      const { value } = await mount(sub, feed, history);
      for (const scope of ["daily", "week"]) assert.deepEqual(lineOf(value.boards[scope], "sat"), contrary, scope);
      assert.ok(feed.count("sat") >= 1);
    });
  }
  await t.test("a cold cache with a missing summary keeps scores and no line", async sub => {
    const feed = espnFeed([espnGame("sat", "2026-09-05T22:00:00Z")]);
    const { value } = await mount(sub, feed);
    assert.equal(lineOf(value.boards.daily, "sat"), undefined);
    assert.deepEqual(value.boards.daily.games[0].teams.map(team => team.score), [21, 7]);
    assert.equal(value.error, "", "an unavailable summary is not a score failure");
  });
  await t.test("history for a different board range is not inherited, and scopes stay separate", async sub => {
    const after = espnGame("sat", "2026-09-05T22:00:00Z");
    const feed = espnFeed([after], new Map([["sat", espnSummary(after, { odds: espnOdds("sat-away", "sat-home", 10) })]]));
    // The saved daily board placed under the week key has a different date range.
    const { value } = await mount(sub, feed, { [satDaily]: saved[satDaily], [satWeek]: saved[satDaily] });
    assert.deepEqual(lineOf(value.boards.daily, "sat"), original);
    assert.deepEqual(lineOf(value.boards.week, "sat"), contrary);
  });
});

test("real client: one saved snapshot supplies the line, final categories and score-change flags", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  let phase = "pre", saved;
  const events = () => [espnGame("sat", "2026-09-05T22:00:00Z", phase === "pre" ? { phase, odds: espnOdds("sat-away", "sat-home", -3) } : { phase: "live", scores: [21, 24] })];
  await t.test("first mount observes the line, then close live play", async sub => {
    const { h, value } = await mount(sub, espnFeed(events));
    phase = "live"; await value.refresh();
    const live = await h.until(v => v.boards.daily?.games[0].state === "live" && !v.refreshing);
    assert.deepEqual(lineOf(live.boards.daily, "sat"), original);
    assert.equal(classify(live.boards.daily.games[0]).close, true);
    saved = { ...h.storage };
  });
  await t.test("a fresh mount at a wide final keeps all evidence from that snapshot", async sub => {
    const final = espnGame("sat", "2026-09-05T22:00:00Z", { phase: "final", scores: [21, 45] });
    const feed = espnFeed([final], new Map([["sat", espnSummary(final, { odds: espnOdds("sat-away", "sat-home", 10) })]]));
    const { value } = await mount(sub, feed, saved);
    const g = value.boards.daily.games[0];
    assert.deepEqual(g.pregameLine, original);
    assert.equal(g.retainedCategories.close, true);
    assert.deepEqual(g.teams.map(team => team.changed), [false, true]);
    assert.equal(feed.count("sat"), 0);
  });
});

test("real client: more than twelve recoveries stay bounded while staggered Day and Week completions keep their own boards", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const events = Array.from({ length: 30 }, (_, i) => espnGame(`many-${String(i).padStart(2, "0")}`, "2026-09-05T19:30:00Z"));
  const feed = espnFeed(events, new Map(events.map(e => [e.id, espnSummary(e, { odds: espnOdds(`${e.id}-away`, `${e.id}-home`, -7) })])));
  feed.delay = 1; feed.hold = dates => dates.includes("-");
  const h = harness(t, null, {}, { hook: real.useScoreboard, fetch: feed.fetch });
  h.render();
  const day = await h.until(v => v.boards.daily && feed.gates.length === 1);
  const lines = board => board.games.filter(g => g.pregameLine).length;
  assert.equal(lines(day.boards.daily), 12); assert.equal(feed.summaries.length, 12); assert.ok(feed.peak <= 4);
  t.mock.timers.tick(5000); feed.gates.shift()();
  const v = await h.until(loaded);
  assert.equal(feed.summaries.length, 24, "the week reuses finished lines and recovers the next twelve");
  assert.equal(lines(v.boards.week), 24); assert.ok(feed.peak <= 4);
  assert.equal(v.boards.daily.fetchedAt, day.boards.daily.fetchedAt, "a later week completion does not rewrite the daily board");
  assert.equal(lines(v.boards.daily), 12);
  assert.ok(Date.parse(v.boards.week.fetchedAt) > Date.parse(v.boards.daily.fetchedAt));
  assert.equal(lines(JSON.parse(h.storage[satDaily])), 12); assert.equal(lines(JSON.parse(h.storage[satWeek])), 24);
});

test("real client: Week-first then Day completion keeps per-board bounds and reuses only finished lines", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const events = Array.from({ length: 30 }, (_, i) => espnGame(`wk-${String(i).padStart(2, "0")}`, "2026-09-05T19:30:00Z"));
  const feed = espnFeed(events, new Map(events.map(e => [e.id, espnSummary(e, { odds: espnOdds(`${e.id}-away`, `${e.id}-home`, -7) })])));
  feed.delay = 1; feed.hold = dates => dates === "20260905";
  const h = harness(t, null, {}, { hook: real.useScoreboard, fetch: feed.fetch });
  h.render();
  const lines = board => board.games.filter(g => g.pregameLine).length;
  const week = await h.until(v => v.boards.week && feed.gates.length === 1);
  assert.equal(lines(week.boards.week), 12); assert.equal(feed.summaries.length, 12, "Week's own twelve lookups");
  assert.ok(feed.peak <= 4);
  t.mock.timers.tick(5000); feed.gates.shift()();
  const v = await h.until(loaded);
  assert.equal(feed.summaries.length - 12, 12, "Day makes its own bounded twelve lookups");
  assert.equal(new Set(feed.summaries.map(request => request.id)).size, 24, "Day reuses Week's finished lines instead of repeating them");
  assert.equal(lines(v.boards.daily), 24); assert.ok(feed.peak <= 4);
  assert.equal(v.boards.week.fetchedAt, week.boards.week.fetchedAt, "a later Day completion does not rewrite the weekly board");
  assert.equal(lines(v.boards.week), 12);
  assert.ok(Date.parse(v.boards.daily.fetchedAt) > Date.parse(v.boards.week.fetchedAt));
  assert.equal(lines(JSON.parse(h.storage[satWeek])), 12); assert.equal(lines(JSON.parse(h.storage[satDaily])), 24);
});

test("real client: a superseded refresh's late enrichment writes nothing, and its cancellation leaves retry immediate", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  let scores = [21, 7], holdWeek = false;
  const late = () => espnGame("late", "2026-09-05T19:30:00Z", { scores });
  const summaries = new Map([["late", "late"]]);
  const feed = espnFeed(() => [late()], summaries);
  feed.hold = dates => holdWeek && dates === "20260903-20260908";
  const h = harness(t, null, {}, { hook: real.useScoreboard, fetch: feed.fetch });
  h.render();
  // The first refresh's Day and Week enrichments are both waiting on summaries.
  const first = await h.until(() => feed.late.length === 2);
  const canceled = feed.summaries.map(request => request.signal);
  holdWeek = true; first.setDate("2026-09-04"); h.render();
  // The superseding refresh has written Friday's Day board; its Week score request waits.
  await h.until(v => v.boards.daily?.date === "2026-09-04" && feed.gates.length === 1);
  assert.ok(canceled.every(signal => signal.aborted), "supersession cancels the old refresh's summaries");
  // The old responses arrive after supersession as failures, despite the abort.
  feed.late.splice(0).forEach(resolve => resolve(new Response(null, { status: 500 })));
  const after = await h.settle();
  assert.equal(after.boards.week, null, "late old work cannot set current React state");
  assert.deepEqual(boardKeys(h.storage), ["ss:board:2026-09-04:2026-09-04"], "late old work saves neither Saturday nor Week");
  assert.equal(after.error, "", "cancellation is not a score failure");
  scores = [28, 7]; summaries.set("late", espnSummary(late(), { odds: espnOdds("late-away", "late-home", -7) }));
  feed.gates.shift()();
  const v = await h.until(loaded);
  const g = v.boards.week.games[0];
  assert.equal(feed.count("late"), 3, "the canceled failures armed no retry backoff");
  assert.equal(g.pregameLine.favoriteId, "late-home");
  assert.deepEqual(g.teams.map(team => [team.score, team.changed]), [[28, false], [7, false]], "no superseded board entered the in-memory or saved history");
  assert.deepEqual(JSON.parse(h.storage[satWeek]).games[0].teams.map(team => team.score), [28, 7]);
});

test("real client: unmounting during enrichment aborts its summaries and saves nothing", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const feed = espnFeed([espnGame("sat", "2026-09-05T22:00:00Z")], new Map([["sat", "hang"]]));
  const h = harness(t, null, {}, { hook: real.useScoreboard, fetch: feed.fetch });
  h.render(); await h.until(() => feed.summaries.length === 2);
  h.unmount(); const v = await h.settle();
  assert.ok(feed.summaries.every(request => request.signal.aborted));
  assert.deepEqual(boardKeys(h.storage), []);
  assert.equal(v.boards.daily, null); assert.equal(v.boards.week, null); assert.equal(v.error, "");
});

test("real client: a retained-line halftime game still refreshes timing under its request epoch and Q3 stays terminal", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const now = saturday.getTime(), kickoff = "2026-09-05T19:30:00Z";
  const saved = await observePregame(t, () => [espnGame("sat", kickoff, { phase: "pre", odds: espnOdds("sat-away", "sat-home", -3) })]);
  await t.test("halftime with a retained line", async sub => {
    let phase = "halftime";
    const half = espnGame("sat", kickoff, { phase: "halftime" });
    const feed = espnFeed(() => [phase === "halftime" ? half : espnGame("sat", kickoff, { period: 3 })],
      new Map([["sat", espnSummary(half, { odds: espnOdds("sat-away", "sat-home", 10), halftimeAnchor: now - 300000 })]]));
    let holding = true; feed.hold = () => holding;
    const h = harness(sub, null, saved, { hook: real.useScoreboard, fetch: feed.fetch });
    h.render();
    await h.until(() => feed.gates.length === 1); feed.gates.shift()();
    // Day and Week score requests have captured their epoch before this visibility boundary.
    await h.until(() => feed.gates.length === 2); real.invalidateHalftime();
    holding = false; feed.gates.splice(0).forEach(release => release());
    const label = v => real.halftimeLabel(v.boards.daily.games[0], v.boards.daily, false, Date.now(), true, true);
    const boundary = await h.until(loaded);
    assert.ok(feed.count("sat") >= 1, "the halftime extra still runs for a game with a retained line");
    assert.deepEqual(lineOf(boundary.boards.daily, "sat"), original, "the halftime pickcenter cannot replace the baseline");
    assert.equal(label(boundary), "Halftime", "old-epoch work cannot authorize the new visibility period");
    await boundary.refresh(); const current = await h.until(loaded);
    assert.equal(label(current), "Halftime 15:00");
    assert.deepEqual(lineOf(current.boards.daily, "sat"), original);
    const halftimeGame = current.boards.daily.games[0], halftimeBoard = current.boards.daily;
    phase = "q3"; await current.refresh(); await h.until(v => v.boards.daily.games[0].period === 3 && !v.refreshing);
    assert.equal(real.halftimeLabel(halftimeGame, halftimeBoard, false, Date.now(), true, true), "Halftime", "observed Q3 resumption is terminal");
  });
});

// Browser CDN fallback: the primary scoreboard is refused, so every scope reads ESPN's backup CDN.
// ESPN weeks run Tuesday 07:00Z to the next Tuesday 06:59Z; the default document is the selected week.
const cdnCalendar = [
  { value: "1", startDate: "2026-08-25T07:00Z", endDate: "2026-09-01T06:59Z" },
  { value: "2", startDate: "2026-09-01T07:00Z", endDate: "2026-09-08T06:59Z" },
  { value: "3", startDate: "2026-09-08T07:00Z", endDate: "2026-09-15T06:59Z" },
];
const cdnWeek = (week, events) => ({ content: { sbData: { season: { year: 2026, type: 2 }, week: { number: week }, leagues: [{ calendar: [{ value: "2", entries: cdnCalendar }] }], events } } });
function cdnSource(documents, summaries = new Map()) {
  const feed = { cdn: [], hosted: [], primary: [], owners: new Map(), hostedStatus: 503, onPrimary() {}, holdPrimary: () => false, held: [], holdCdn: () => false, heldCdn: [] };
  feed.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.startsWith("/api/scores?")) { feed.hosted.push(text); return new Response(null, { status: feed.hostedStatus }); }
    const u = new URL(text);
    if (u.pathname.endsWith("/summary")) { const body = summaries.get(u.searchParams.get("event")); return body ? Response.json(body) : new Response(null, { status: 404 }); }
    if (u.hostname === "site.api.espn.com") {
      // Each caller's CDN requests share its direct controller signal, which identifies the scope.
      const dates = u.searchParams.get("dates"); feed.primary.push(dates); feed.owners.set(options.signal, dates); feed.onPrimary(dates);
      if (feed.holdPrimary(dates)) await new Promise(resolve => feed.held.push(resolve));
      return new Response(null, { status: 403 });
    }
    const week = u.searchParams.get("week") ?? "default";
    const owner = feed.owners.get(options.signal);
    feed.cdn.push({ url: text, week, owner });
    // Bounded late completion: ignores abort and settles only when the test releases it.
    if (feed.holdCdn(week, owner)) await new Promise(resolve => feed.heldCdn.push({ resolve, signal: options.signal }));
    const body = documents(week);
    return body instanceof Response ? body : Response.json(body);
  };
  feed.urls = () => feed.cdn.map(request => request.week);
  return feed;
}
const cdnMount = (t, feed, options = {}) => harness(t, null, {}, { hook: real.useScoreboard, fetch: feed.fetch, ...options });
const gameIds = board => board.games.map(g => g.id).sort();

test("real client CDN: an interior Saturday downloads the selected week once per refresh, and the next refresh downloads again", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  let satScores = [21, 7];
  const docs = week => week === "default" ? cdnWeek(2, [
    espnGame("fri-final", "2026-09-04T23:00:00Z", { phase: "final" }), espnGame("sat-live", "2026-09-05T19:30:00Z", { scores: satScores }),
    espnGame("sat-late", "2026-09-05T23:30:00Z", { phase: "pre" }), espnGame("mon-night", "2026-09-08T00:00:00Z", { phase: "pre" }),
  ]) : new Response(null, { status: 404 });
  const feed = cdnSource(docs), h = cdnMount(t, feed);
  h.render(); const v = await h.until(loaded);
  assert.deepEqual(feed.urls(), ["default"], "probe, Day and Week reuse one completed download");
  assert.equal(feed.primary.length, 3); assert.deepEqual(feed.hosted, []);
  assert.equal(v.today, "2026-09-05");
  assert.deepEqual(gameIds(v.boards.daily), ["sat-late", "sat-live"]);
  assert.deepEqual(gameIds(v.boards.week), ["fri-final", "mon-night", "sat-late", "sat-live"], "all categories read the one full-FBS week");
  assert.equal(v.boards.daily.fetchedAt, saturday.toISOString()); assert.equal(v.boards.week.fetchedAt, saturday.toISOString());
  satScores = [28, 7]; await v.refresh();
  const next = await h.until(value => loaded(value) && feed.cdn.length === 2);
  assert.deepEqual(feed.urls(), ["default", "default"], "a later refresh never reuses an earlier refresh's documents");
  assert.deepEqual(next.boards.daily.games.find(g => g.id === "sat-live").teams.map(team => team.score), [28, 7]);
  assert.deepEqual(feed.hosted, []);
});

test("real client CDN: a Tuesday boundary downloads each needed week once and keeps independent Day and Week ranges", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T20:00:00Z") });
  const docs = week => ({
    default: cdnWeek(3, [espnGame("tue", "2026-09-08T23:00:00Z", { phase: "pre" }), espnGame("thu", "2026-09-10T23:30:00Z", { phase: "pre" })]),
    2: cdnWeek(2, [espnGame("mon-final", "2026-09-08T00:00:00Z", { phase: "final" }), espnGame("overnight", "2026-09-08T05:00:00Z", { phase: "final" })]),
  })[week] ?? new Response(null, { status: 404 });
  const feed = cdnSource(docs), h = cdnMount(t, feed);
  h.render(); const v = await h.until(loaded);
  assert.deepEqual(feed.urls(), ["default", "2"], "Day reuses the probe's selected and adjacent weeks; Week reuses the selected week");
  assert.equal(new Set(feed.cdn.map(request => request.url)).size, feed.cdn.length);
  assert.deepEqual(feed.hosted, []);
  assert.equal(v.today, "2026-09-08");
  assert.deepEqual(gameIds(v.boards.daily), ["overnight", "tue"]);
  assert.equal(v.boards.week.date, "2026-09-10"); assert.deepEqual(gameIds(v.boards.week), ["thu"]);
});

test("real client CDN: an unfinished overnight board is held and reused while Week reads the same stored week", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T06:00:00Z") });
  const docs = week => week === "default" ? cdnWeek(2, [espnGame("mon-live", "2026-09-08T02:30:00Z"), espnGame("sat-final", "2026-09-05T19:30:00Z", { phase: "final" })]) : new Response(null, { status: 404 });
  const feed = cdnSource(docs), h = cdnMount(t, feed);
  h.render(); const v = await h.until(loaded);
  assert.equal(v.today, "2026-09-07"); assert.equal(v.boards.daily.date, "2026-09-07");
  assert.deepEqual(gameIds(v.boards.daily), ["mon-live"]); assert.deepEqual(gameIds(v.boards.week), ["mon-live", "sat-final"]);
  assert.deepEqual(feed.urls(), ["default"]); assert.deepEqual(feed.primary, ["20260907", "20260903-20260908"]);
  assert.deepEqual(feed.hosted, []);
});

test("real client CDN: a manual Guide date loads while its informational overnight check is still waiting", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const docs = week => week === "default" ? cdnWeek(2, [espnGame("thu-final", "2026-09-03T23:30:00Z", { phase: "final" }), espnGame("fri-final", "2026-09-04T23:00:00Z", { phase: "final" })]) : new Response(null, { status: 404 });
  const feed = cdnSource(docs);
  feed.holdPrimary = dates => dates === "20260904";
  const h = cdnMount(t, feed, { dailyOnly: true, controlledDate: "2026-09-03" });
  h.render();
  const shown = await h.until(v => v.data?.date === "2026-09-03" && feed.held.length === 1);
  assert.equal(shown.refreshing, true, "the overnight check is still pending");
  assert.deepEqual(gameIds(shown.data), ["thu-final"]);
  feed.held.shift()();
  const v = await h.until(value => value.data && !value.refreshing);
  assert.equal(v.today, "2026-09-05"); assert.equal(v.overnightError, "");
  assert.deepEqual(feed.urls(), ["default"], "the later overnight check reuses the selected board's completed download");
  assert.deepEqual(feed.hosted, []);
});

test("real client CDN: a failed adjacent week fails only the scopes needing it while the healthy Week renders", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T20:00:00Z") });
  const docs = week => week === "default" ? cdnWeek(3, [espnGame("tue", "2026-09-08T23:00:00Z", { phase: "pre" }), espnGame("thu", "2026-09-10T23:30:00Z", { phase: "pre" })]) : new Response(null, { status: 503 });
  const feed = cdnSource(docs), h = cdnMount(t, feed);
  h.render(); const v = await h.until(value => value.boards.week && !value.refreshing);
  assert.deepEqual(gameIds(v.boards.week), ["thu"]); assert.equal(h.switchTo("week").scopeError, "");
  const day = h.switchTo("daily");
  assert.equal(day.boards.daily, null); assert.match(day.scopeError, /Could not refresh/);
  assert.match(day.overnightError, /Could not verify overnight games/);
  assert.deepEqual(feed.hosted.map(url => new URL(url, "https://app.test").searchParams.get("date")).sort(), ["2026-09-07", "2026-09-08"], "the healthy Week makes no hosted request");
  assert.ok(feed.cdn.length <= 5, "never more CDN downloads than the five the same refresh needed before reuse");
  assert.ok(h.storage["ss:board:week:2026-09-10:2026-09-14"]);
});

// Board-age provenance only: the mocked Date jumps 95 seconds between the probe and Day, without elapsed timers.
// This proves how a reused document's age is reported and gated, not real refresh duration or deadlines.
test("real client CDN: reused documents keep their original acquisition time through enrichment and halftime gating", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const T0 = saturday.getTime(), half = espnGame("cdn-half", "2026-09-05T19:30:00Z", { phase: "halftime" });
  const docs = week => week === "default" ? cdnWeek(2, [half]) : new Response(null, { status: 404 });
  const feed = cdnSource(docs, new Map([[half.id, espnSummary(half, { halftimeAnchor: T0 - 300000 })]]));
  // The probe finishes at T0; Day and Week normalize at a Date 95 seconds later from the stored document.
  let skew = true; feed.onPrimary = dates => { if (skew && dates === "20260905") t.mock.timers.setTime(T0 + 95000); };
  const h = cdnMount(t, feed);
  h.render(); const v = await h.until(loaded);
  assert.deepEqual(feed.urls(), ["default"]);
  for (const scope of ["daily", "week"]) assert.equal(v.boards[scope].fetchedAt, new Date(T0).toISOString(), scope);
  const label = value => real.halftimeLabel(value.boards.daily.games[0], value.boards.daily, false, Date.now(), true, true);
  assert.equal(label(v), "Halftime", "a 95-second-old scoreboard cannot authorize a countdown even though it was normalized just now");
  skew = false; await v.refresh();
  const fresh = await h.until(value => loaded(value) && feed.cdn.length === 2);
  assert.equal(fresh.boards.daily.fetchedAt, new Date(T0 + 95000).toISOString());
  assert.equal(label(fresh), "Halftime 13:25", "a freshly downloaded document restores the countdown");
});

test("real client CDN: the unchanged 40-second refresh deadline cancels a late CDN body, which is neither stored nor published", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: saturday });
  const docs = week => week === "default" ? cdnWeek(2, [espnGame("sat-live", "2026-09-05T19:30:00Z")]) : new Response(null, { status: 404 });
  const feed = cdnSource(docs);
  // The probe's CDN response is a bounded late completion: it ignores abort and settles only when released.
  let holding = true; feed.holdCdn = (week, owner) => holding && owner === "20260904";
  const h = cdnMount(t, feed);
  // Controlled refresh deadline: capture the hook's own 40-second timer; every other window timer stays real.
  const deadlines = [], hookWindow = globalThis.window, realTimeout = hookWindow.setTimeout, realClear = hookWindow.clearTimeout;
  hookWindow.setTimeout = (callback, milliseconds) => milliseconds === 40000 ? (deadlines.push(callback), -deadlines.length) : realTimeout(callback, milliseconds);
  hookWindow.clearTimeout = id => { if (id > 0) realClear(id); };
  h.render();
  await h.until(() => feed.heldCdn.length === 1);
  assert.equal(deadlines.length, 1, "one 40-second deadline per refresh");
  const held = feed.heldCdn.shift();
  assert.equal(held.signal.aborted, false);
  deadlines[0](); // The 40-second deadline expires while the probe's CDN body is outstanding.
  assert.equal(held.signal.aborted, true, "the parent deadline reaches the probe's own direct controller");
  holding = false; held.resolve(); // The late body now completes despite the abort.
  const canceled = await h.until(v => !v.refreshing);
  assert.equal(canceled.boards.daily, null); assert.equal(canceled.boards.week, null);
  assert.deepEqual(boardKeys(h.storage), [], "no board or history is published from the canceled refresh");
  assert.deepEqual(feed.hosted, [], "parent cancellation starts no hosted fallback");
  assert.deepEqual(feed.urls(), ["default"], "no other scope ran after the deadline");
  assert.match(canceled.error, /Could not refresh/);
  // The next refresh starts immediately with its own documents and downloads again: the late body was not kept.
  await canceled.refresh();
  const next = await h.until(loaded);
  assert.deepEqual(feed.urls(), ["default", "default"]);
  assert.deepEqual(gameIds(next.boards.daily), ["sat-live"]); assert.deepEqual(feed.hosted, []);
  assert.equal(deadlines.length, 2);
});
