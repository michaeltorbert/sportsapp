import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const { validCommit, metadata, observe, refreshUrl, updateRestoration, initialTab } = await bundle("lib/app-update.ts");
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
test("only full commits with descriptive versions are deployment metadata", () => {
  for (const commit of [null, "", "development", "abc1234", "g".repeat(40), 123]) assert.equal(metadata({ commit, version: "1" }), null);
  assert.equal(validCommit(A.toUpperCase()), A);
  assert.equal(metadata({ commit: B, version: "1" }).commit, B);
  assert.equal(metadata({ commit: B }), null);
});
test("confirmation needs two observations separated by ten seconds; hashes have no order", () => {
  let c = observe(null, A, B, 100);
  assert.equal(observe(c, A, B, 10099).confirmed, false);
  c = observe(c, A, B, 10100); assert.equal(c.confirmed, true);
  assert.equal(observe(c, A, A, 10200), null);
  c = observe(c, A, C, 10200); assert.equal(c.since, 10200); assert.equal(c.confirmed, false);
  assert.equal(observe(null, B, A, 0).commit, A); // Rollback.
  assert.equal(observe(null, A, metadata({ commit: A, version: "99" }).commit, 0), null);
});
test("refresh URL preserves actual view and unrelated URL data without replaying notification", () => {
  const url = new URL(refreshUrl("https://example.test/?other=keep#game-abc", B, { date: "2026-09-05", followToday: false, filter: "acc", hideFinals: true, focusedGame: "abc" }));
  assert.equal(url.hash, ""); assert.equal(url.searchParams.get("other"), "keep"); assert.equal(url.searchParams.get("date"), "2026-09-05");
  assert.equal(initialTab(url.search), "acc"); assert.deepEqual(updateRestoration(url.search), { hideFinals: true, focusedGame: "abc" });
  const home = new URL(refreshUrl(url.href + "#unrelated", B, { date: "2026-09-05", followToday: true, filter: "watch", hideFinals: false, focusedGame: "" }));
  assert.equal(home.hash, "#unrelated"); assert.equal(home.searchParams.has("date"), false); assert.equal(home.searchParams.has("_ss_focus"), false);
  assert.deepEqual(updateRestoration(home.search), { hideFinals: false, focusedGame: "" });
  assert.equal(updateRestoration(`?_ss_update=${B}`), null);
  assert.equal(updateRestoration(`?_ss_update=${B}&_ss_hide_finals=1&_ss_focus=%3Cscript%3E`), null);
  assert.equal(initialTab("?tab=invalid"), "watch");
});

const { createAppUpdater } = await bundle("lib/app-update-controller.ts");
function environment(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 100000 });
  const window = new EventTarget(), document = new EventTarget(); document.hidden = false;
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ commit: B, version: "1" }) }));
  const originals = new Map();
  for (const [key, value] of Object.entries({ window, document, navigator: { onLine: true }, sessionStorage: { getItem: () => null, setItem() {} } })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  t.after(() => { updater.dispose(); for (const [key, desc] of originals) { if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key]; } });
  const states = [], navigations = [], updater = createAppUpdater(A, s => states.push(s), c => navigations.push(c));
  return { updater, states, navigations, window };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test("single flight shares manual result; refresh waits then verifies anew and guards repeated taps", async t => {
  const { updater, navigations } = environment(t);
  let release; const requests = [];
  fetch.mock.mockImplementation((_url, options) => { requests.push(options); return new Promise(resolve => { release = resolve; }); });
  const check = updater.check(); const shared = updater.check(); assert.equal(requests.length, 1);
  const refresh = updater.refresh(); await updater.refresh(); assert.equal(requests.length, 1);
  release({ ok: true, json: async () => ({ commit: B, version: "1" }) }); await settle(); assert.equal(requests.length, 2);
  assert.equal(requests[0].cache, "no-store");
  release({ ok: true, json: async () => ({ commit: B, version: "1" }) }); await Promise.all([check, shared, refresh]);
  await updater.refresh(); assert.deepEqual(navigations, [B]);
});
test("timeout aborts request; disposed controller suppresses late output and clears timers", async t => {
  const { updater, states } = environment(t); let release, signal;
  fetch.mock.mockImplementation((_url, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); });
  const check = updater.check(); t.mock.timers.tick(10000); assert.equal(signal.aborted, true);
  updater.dispose(); const count = states.length;
  release({ ok: true, json: async () => ({ commit: B, version: "1" }) }); await check;
  t.mock.timers.tick(600000); assert.equal(states.length, count); assert.equal(fetch.mock.callCount(), 1);
});
test("manual request in throttle gap is scheduled rather than swallowed", async t => {
  const { updater, states } = environment(t);
  await updater.check(); await updater.check(); assert.equal(fetch.mock.callCount(), 1);
  t.mock.timers.tick(2000); await settle(); assert.equal(fetch.mock.callCount(), 2);
  assert.equal(states.at(-1).status, "An app update is being verified.");
});
test("session dismissal remembers every target and manual override survives first confirmation", async t => {
  const { updater, states, window } = environment(t);
  await updater.check(); t.mock.timers.tick(10000); await settle(); updater.dismiss();
  assert.equal(states.at(-1).target, null);
  fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ commit: C, version: "1" }) }));
  t.mock.timers.tick(2000); window.dispatchEvent(new Event("focus")); await settle();
  t.mock.timers.tick(10000); await settle(); updater.dismiss();
  fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ commit: B, version: "1" }) }));
  t.mock.timers.tick(2000); window.dispatchEvent(new Event("focus")); await settle();
  t.mock.timers.tick(10000); await settle(); assert.equal(states.at(-1).target, null);
  updater.dispose();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => JSON.stringify([B]), setItem() {} } });
  const freshStates = [], fresh = createAppUpdater(A, s => freshStates.push(s), () => {});
  await fresh.check(); t.mock.timers.tick(10000); await settle(); assert.equal(freshStates.at(-1).target, B); fresh.dispose();
});
test("storage denial does not prevent dismissal, checking, or explicit navigation", async t => {
  const { updater } = environment(t); updater.dispose();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } } });
  const states = [], navigations = [], fresh = createAppUpdater(A, s => states.push(s), c => navigations.push(c));
  await fresh.check(); t.mock.timers.tick(10000); await settle(); fresh.dismiss(); assert.equal(states.at(-1).target, null);
  t.mock.timers.tick(2000); await fresh.check(); assert.equal(states.at(-1).target, B);
  await fresh.refresh(); assert.deepEqual(navigations, [B]); fresh.dispose();
});
