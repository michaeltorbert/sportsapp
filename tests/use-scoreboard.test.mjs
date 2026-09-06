import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { easternDate, shiftDate, accWeek } = await bundle("lib/football.ts");

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

function harness(t, loadScores) {
  const slots = [], pending = [];
  let cursor = 0, weekly = false, value;
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
  const storage = new Map();
  replace("scoreHookTest", runtime);
  replace("localStorage", { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) });
  replace("location", { search: "" }); replace("navigator", { onLine: true });
  replace("document", { hidden: false, addEventListener() {}, removeEventListener() {} });
  replace("window", { setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} });
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The controlled lifecycle harness supplies the hook runtime.
  const render = () => { cursor = 0; value = useScoreboard(weekly); while (pending.length) pending.shift()(); return value; };
  t.after(() => { slots.forEach(slot => slot?.cleanup?.()); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { render, switchTo(w) { weekly = w; return render(); }, async settle() { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } return value; } };
}

test("switching ACC and daily tabs keeps both counts without new requests", async t => {
  const calendar = easternDate(), yesterday = shiftDate(calendar, -1), requests = [];
  const acc = game({ id: "acc" }); acc.teams[0].conferenceId = "1";
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    requests.push({ date, end, accOnly });
    return scoreboard(date === yesterday && !accOnly ? [] : [accOnly ? acc : game()], date, { endDate: end });
  });
  h.render(); const initial = await h.settle();
  assert.equal(initial.dailyData.games.length, 1); assert.equal(initial.weeklyData.games[0].id, "acc");
  assert.equal(requests.length, 3);
  for (const weekly of [true, false, true, false]) {
    const v = h.switchTo(weekly);
    assert.equal(v.data, weekly ? initial.weeklyData : initial.dailyData);
    assert.equal(v.dailyData, initial.dailyData); assert.equal(v.weeklyData, initial.weeklyData);
  }
  await h.settle(); assert.equal(requests.length, 3);
  initial.setDate(shiftDate(calendar, -3));
  const changed = h.render(); assert.equal(changed.dailyData, null); assert.equal(changed.weeklyData, initial.weeklyData);
  const next = await h.settle(); assert.equal(next.dailyData.date, shiftDate(calendar, -3));
  assert.equal(h.switchTo(true).data.date, accWeek(calendar).start);
  assert.equal(h.switchTo(false).date, shiftDate(calendar, -3));
});

test("failed ACC refresh preserves its previous board and healthy daily scores", async t => {
  const yesterday = shiftDate(easternDate(), -1); let failWeekly = false;
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    if (accOnly && failWeekly) throw new Error("feed unavailable");
    return scoreboard(date === yesterday && !accOnly ? [] : [game()], date, { endDate: end });
  });
  h.render(); const initial = await h.settle(); failWeekly = true;
  await initial.refresh(); const refreshed = await h.settle();
  assert.ok(refreshed.dailyData); assert.equal(refreshed.error, "");
  assert.equal(refreshed.weeklyData, initial.weeklyData);
  assert.match(h.switchTo(true).error, /Could not refresh/);
});

test("unfinished overnight board is reused for daily counts while ACC loads its week", async t => {
  const yesterday = shiftDate(easternDate(), -1), requests = [];
  const h = harness(t, async (date, signal, fetcher, end = date, accOnly = false) => {
    requests.push({ date, end, accOnly });
    return scoreboard([game()], date, { endDate: end });
  });
  h.render(); const v = await h.settle();
  assert.equal(v.today, yesterday); assert.equal(v.dailyData.date, yesterday);
  assert.equal(v.weeklyData.date, accWeek(yesterday).start);
  assert.equal(requests.length, 2);
});
