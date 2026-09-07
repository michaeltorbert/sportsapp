import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { classify, easternDate, shiftDate, accWeek } = await bundle("lib/football.ts");
const { scoreboardScope } = await bundle("lib/scoreboard-views.ts");

// Drive hook lifecycle and controlled feed responses without a browser or network.
const output = await build({
  entryPoints: ["lib/use-scoreboard.ts"], bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "hook-test-runtime", setup(build) {
    build.onResolve({ filter: /^(react|\.\/score-client)$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "react"
      ? "export const useState=(...a)=>globalThis.scoreHookTest.useState(...a), useRef=(...a)=>globalThis.scoreHookTest.useRef(...a), useEffect=(...a)=>globalThis.scoreHookTest.useEffect(...a), useCallback=(...a)=>globalThis.scoreHookTest.useCallback(...a);"
      : "export const loadScores=(...a)=>globalThis.scoreHookTest.loadScores(...a);" }));
  } }],
});
const { useScoreboard } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);

function harness(t, loadScores, saved = {}) {
  const slots = [], pending = [];
  let cursor = 0, scope = "daily", value;
  const globals = new Map();
  const replace = (name, value) => { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value }); };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const runtime = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    loadScores,
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
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The controlled lifecycle harness supplies the hook runtime.
  const render = () => { cursor = 0; value = useScoreboard(scope); while (pending.length) pending.shift()(); return value; };
  t.after(() => { slots.forEach(slot => slot?.cleanup?.()); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { render, storage, switchTo(s) { scope = s; return render(); }, async settle() { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } return value; } };
}

const requestScope = (date, end, accOnly) => accOnly ? "acc" : date !== end ? "top25" : "daily";

test("switching every tab keeps daily, ACC, and Top 25 boards without new requests", async t => {
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), requests = [];
  const acc = game({ id: "acc" }); acc.teams[0].conferenceId = "1";
  const future = game({ id: "future-ranked", state: "upcoming", date: `${accWeek(calendar).end}T23:30:00Z` });
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    requests.push({ date, end, accOnly });
    const scope = requestScope(date, end, accOnly);
    return scoreboard(scope === "daily" && date === yesterday ? [] : [scope === "acc" ? acc : scope === "top25" ? future : game()], date, { endDate: end });
  });
  h.render(); const initial = await h.settle();
  assert.equal(initial.boards.daily.games.length, 1); assert.equal(initial.boards.acc.games[0].id, "acc");
  assert.equal(initial.boards.top25.games[0].id, "future-ranked");
  assert.equal(requests.length, 4);
  for (const filter of ["top25", "acc", "watch", "close", "upset", "top25", "acc"]) {
    const scope = scoreboardScope(filter), v = h.switchTo(scope);
    assert.equal(v.data, initial.boards[scope]);
    assert.deepEqual(v.boards, initial.boards);
    assert.equal(v.refresh, initial.refresh);
  }
  await h.settle(); assert.equal(requests.length, 4);
  initial.setDate(shiftDate(calendar, -3));
  const changed = h.render(); assert.equal(changed.boards.daily, null);
  assert.equal(changed.boards.acc, initial.boards.acc); assert.equal(changed.boards.top25, initial.boards.top25);
  const next = await h.settle(); assert.equal(next.boards.daily.date, shiftDate(calendar, -3));
  for (const scope of ["acc", "top25"]) assert.equal(h.switchTo(scope).data.date, accWeek(calendar).start);
  assert.equal(h.switchTo("daily").date, shiftDate(calendar, -3));
  assert.equal(next.followToday, false);
  next.setDate(null); h.render();
  const resumed = await h.settle(); assert.equal(resumed.date, calendar); assert.equal(resumed.followToday, true);
});

for (const failedScope of ["daily", "acc", "top25"]) test(`failed ${failedScope} refresh keeps its board and isolates its error until recovery`, async t => {
  const yesterday = shiftDate(easternDate(), -1); let failing = false;
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    const scope = requestScope(date, end, accOnly);
    if (scope === "daily" && date === yesterday) return scoreboard([], date);
    if (scope === failedScope && failing) throw new Error("feed unavailable");
    return scoreboard([game({ id: scope })], date, { endDate: end });
  });
  h.render(); const initial = await h.settle(); failing = true;
  await initial.refresh(); const refreshed = await h.settle();
  for (const scope of ["daily", "acc", "top25"]) {
    const v = h.switchTo(scope);
    if (scope === failedScope) { assert.equal(v.data, initial.boards[scope]); assert.match(v.error, /Could not refresh/); }
    else { assert.ok(v.data); assert.notEqual(v.data, initial.boards[scope]); assert.equal(v.error, ""); }
  }
  failing = false; await refreshed.refresh(); await h.settle();
  assert.equal(h.switchTo(failedScope).error, "");
});

test("unfinished overnight board is reused only for daily counts while both weeks load", async t => {
  const yesterday = shiftDate(easternDate(), -1), requests = [];
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    requests.push({ date, end, accOnly });
    return scoreboard([game({ id: requestScope(date, end, accOnly) })], date, { endDate: end });
  });
  h.render(); const v = await h.settle();
  assert.equal(v.today, yesterday); assert.equal(v.boards.daily.date, yesterday);
  for (const scope of ["acc", "top25"]) {
    assert.equal(v.boards[scope].date, accWeek(yesterday).start);
    assert.equal(v.boards[scope].endDate, accWeek(yesterday).end);
    assert.equal(v.boards[scope].games[0].id, scope);
  }
  assert.equal(requests.length, 3);
});

test("saved ACC and full-FBS weekly history cannot cross-contaminate final categories or score changes", async t => {
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), week = accWeek(calendar);
  const accKey = `ss:board:${week.start}:${week.end}`, topKey = `ss:board:top25:${week.start}:${week.end}`;
  const earlier = game(); earlier.teams[0].score = 21; earlier.teams[1].score = 20;
  const later = game(); later.teams[0].score = 0;
  const final = { ...later, state: "final" };
  const h = harness(t, async (date, signal, fetcher, end = date) =>
    scoreboard(date === end && date === yesterday ? [] : [structuredClone(final)], date, { endDate: end }), {
    [accKey]: JSON.stringify(scoreboard([earlier], week.start, { endDate: week.end })),
    [topKey]: JSON.stringify(scoreboard([later], week.start, { endDate: week.end })),
    "ss:board:top25:2020-09-03:2020-09-07": "expired",
  });
  h.render(); const v = await h.settle();
  assert.equal(v.boards.acc.games[0].retainedCategories.close, true);
  assert.equal(v.boards.acc.games[0].retainedCategories.upset, true);
  assert.equal(v.boards.acc.games[0].teams[0].changed, true);
  assert.equal(v.boards.top25.games[0].retainedCategories.close, false);
  assert.equal(v.boards.top25.games[0].retainedCategories.upset, false);
  assert.equal(v.boards.top25.games[0].teams[0].changed, false);
  assert.equal(v.boards.daily.games[0].retainedCategories, undefined);
  assert.equal(JSON.parse(h.storage.getItem(accKey)).games[0].retainedCategories.close, true);
  assert.equal(JSON.parse(h.storage.getItem(topKey)).games[0].retainedCategories.close, false);
  assert.equal(h.storage.getItem("ss:board:top25:2020-09-03:2020-09-07"), null);
  await v.refresh(); const again = await h.settle();
  assert.equal(again.boards.acc.games[0].retainedCategories.close, true);
  assert.equal(again.boards.top25.games[0].retainedCategories.close, false);
});

test("switching tabs during a Top 25 request neither aborts it nor repeats polling", async t => {
  const yesterday = shiftDate(easternDate(), -1), requests = [];
  let finish, weeklySignal;
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    const scope = requestScope(date, end, accOnly); requests.push(scope);
    if (scope === "top25") { weeklySignal = signal; await new Promise(resolve => { finish = resolve; }); }
    return scoreboard(scope === "daily" && date === yesterday ? [] : [game()], date, { endDate: end });
  });
  h.render(); const loading = await h.settle();
  assert.ok(loading.boards.daily); assert.ok(loading.boards.acc); assert.equal(loading.boards.top25, null);
  for (const scope of ["top25", "daily", "acc", "top25"]) h.switchTo(scope);
  assert.equal(weeklySignal.aborted, false); assert.equal(requests.length, 4);
  finish(); const ready = await h.settle();
  assert.equal(ready.data, ready.boards.top25); assert.ok(ready.data); assert.equal(ready.refreshing, false);
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
  assert.equal(held.boards.acc.date, "2026-09-03"); assert.equal(held.boards.top25.endDate, "2026-09-07");
  unfinished = false; const refresh = held.refresh();
  const transitioning = await h.settle();
  assert.equal(transitioning.today, "2026-09-08");
  assert.equal(transitioning.boards.acc, null); assert.equal(transitioning.boards.top25, null);
  pendingWeeks.forEach(resolve => resolve()); await refresh;
  const next = await h.settle();
  assert.equal(next.boards.acc.date, "2026-09-10"); assert.equal(next.boards.top25.endDate, "2026-09-14");
});

test("actual hook delay writes survive opaque storage transfer into a fresh hook and isolate scopes", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T21:00:00Z") });
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), week = accWeek(calendar);
  let phase = "live", saved;
  const load = async (date, signal, fetcher, end = date, accOnly = false) => {
    if (date === yesterday && end === date) return scoreboard([], date);
    const g = game({ state: phase === "final" ? "final" : phase });
    // Only daily observes close live play; weekly scopes see a wide game.
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
    assert.equal(classify(final.boards.acc.games[0]).close, false);
    assert.equal(classify(final.boards.top25.games[0]).close, false);
    final.setDate("2026-09-03"); h.render(); const other = await h.settle();
    assert.equal(classify(other.boards.daily.games[0]).close, false);
    assert.equal(other.boards.acc.date, week.start);
  });
});
