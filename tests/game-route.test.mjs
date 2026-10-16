import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./helpers.mjs";
const { parseGameRoute, gameUrl, gameHref, sectionUrl, boardUrl, readEntry, withEntry, ownedTraversal, createRouteHistory, EARLY_POPSTATE_SCRIPT } = await bundle("lib/game-route.ts");
const { initialView } = await bundle("lib/app-update.ts");

const view = (changes = {}) => ({ date: "2026-09-05", followToday: false, selection: ["acc", "upset"], period: "day", ...changes });
const snapshot = (changes = {}) => ({ date: "2026-09-05", selection: ["acc"], period: "week", hideFinals: true, scrollY: 812, origin: "401858481", ...changes });

test("game URLs round-trip the event and section and keep the scoreboard view and unrelated data", () => {
  const href = gameUrl("https://example.test/?keep=yes&tab=acc&_ss_update=x&_ss_focus=y&_ss_open=0#game-401858481", { id: "401858481", section: "players" }, view());
  const url = new URL(href);
  assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()].slice(0, 2), ["event", "section"]);
  assert.deepEqual(parseGameRoute(url.search), { id: "401858481", section: "players" });
  assert.equal(url.searchParams.get("keep"), "yes"); assert.equal(url.hash, "");
  for (const key of ["tab", "_ss_update", "_ss_focus", "_ss_open"]) assert.equal(url.searchParams.has(key), false, key);
  // The date/cats/period the scoreboard derives from the URL are unchanged by the game destination.
  assert.equal(url.searchParams.get("date"), "2026-09-05");
  assert.deepEqual(initialView(url.search), { selection: ["acc", "upset"], period: "day" });
  for (const v of [view({ followToday: true }), view({ selection: [], period: "week" }), view({ selection: ["acc", "top25", "close", "upset"], period: "week", followToday: true })]) {
    const u = new URL(gameUrl("https://example.test/", { id: "g1", section: "team" }, v));
    assert.deepEqual(initialView(u.search), { selection: v.selection, period: v.period });
    assert.equal(u.searchParams.has("date"), !v.followToday);
    assert.equal(u.searchParams.has("section"), false);
    const back = new URL(boardUrl(u.href, v));
    assert.equal(back.searchParams.has("event"), false);
    assert.deepEqual(initialView(back.search), { selection: v.selection, period: v.period });
  }
  assert.equal(gameHref({ id: "g1", section: "team" }, view({ followToday: true, selection: [] })), "/?event=g1");
  assert.equal(new URL(sectionUrl("https://example.test/?event=g1&date=2026-09-05", "players")).searchParams.get("section"), "players");
  assert.equal(new URL(sectionUrl("https://example.test/?event=g1&section=players", "team")).searchParams.has("section"), false);
  // An unrelated fragment is kept; only a legacy game hash is dropped.
  assert.equal(new URL(gameUrl("https://example.test/#other", { id: "g1", section: "team" }, view())).hash, "#other");
});

test("the Scoring section round-trips through the URL and history records; Team stays the parameter-free default", () => {
  const href = gameUrl("https://example.test/?keep=yes", { id: "401856717", section: "scoring" }, view());
  const url = new URL(href);
  assert.deepEqual([...url.searchParams.keys()].slice(0, 2), ["event", "section"]);
  assert.equal(url.searchParams.get("section"), "scoring");
  assert.deepEqual(parseGameRoute(url.search), { id: "401856717", section: "scoring" });
  assert.equal(gameHref({ id: "g1", section: "scoring" }, view({ followToday: true, selection: [] })), "/?event=g1&section=scoring");
  assert.equal(new URL(sectionUrl("https://example.test/?event=g1&date=2026-09-05", "scoring")).searchParams.get("section"), "scoring");
  for (const from of ["scoring", "players"]) {
    assert.equal(new URL(sectionUrl(`https://example.test/?event=g1&section=${from}`, "team")).searchParams.has("section"), false);
    assert.equal(new URL(sectionUrl(`https://example.test/?event=g1&section=${from}`, from === "scoring" ? "players" : "scoring")).searchParams.get("section"), from === "scoring" ? "players" : "scoring");
  }
  assert.deepEqual(parseGameRoute("?event=401856717&section=team"), { id: "401856717", section: "team" });
  const entry = { v: 1, kind: "game", key: "k3", id: "401856717", section: "scoring", from: false };
  assert.deepEqual(readEntry({ ss: entry }), entry);
  for (const section of ["Scoring", "score", "", null, 1]) assert.equal(readEntry({ ss: { ...entry, section } }), null, String(section));
  assert.equal(boardUrl("https://example.test/?event=g1&section=scoring", view()).includes("section"), false);
});

test("bad event IDs and sections fall back safely", () => {
  for (const search of ["", "?event=", "?event=%3Cscript%3E", `?event=${"a".repeat(129)}`, "?event=a/b"]) assert.equal(parseGameRoute(search), null, search);
  assert.deepEqual(parseGameRoute("?event=401858481&section=bogus"), { id: "401858481", section: "team" });
  assert.deepEqual(parseGameRoute("?event=401858481&section=SCORING"), { id: "401858481", section: "team" });
  assert.deepEqual(parseGameRoute("?event=401858481&section=__proto__"), { id: "401858481", section: "team" });
  assert.equal(parseGameRoute(null), null);
});

test("history records validate strictly and carry UI state and IDs only", () => {
  const board = { v: 1, kind: "board", key: "abc123", snapshot: snapshot(), consumed: "401858481" };
  assert.deepEqual(readEntry({ ss: board, other: 1 }), board);
  assert.deepEqual(readEntry({ ss: { v: 1, kind: "board", key: "k1" } }), { v: 1, kind: "board", key: "k1" });
  const game = { v: 1, kind: "game", key: "k2", id: "401858481", section: "players", from: true };
  assert.deepEqual(readEntry({ ss: game }), game);
  assert.deepEqual(readEntry({ ss: { ...snapshot(), ...game, extra: "dropped" } }), game);
  for (const bad of [null, undefined, "ss", [], {}, { ss: null }, { ss: { ...game, v: 2 } }, { ss: { ...game, key: "NOT valid" } }, { ss: { ...game, kind: "guide" } },
    { ss: { ...game, id: "<x>" } }, { ss: { ...game, section: "overview" } }, { ss: { ...game, from: "yes" } },
    { ss: { ...board, consumed: "<x>" } }, { ss: { ...board, snapshot: snapshot({ date: "2026-13-45" }) } }, { ss: { ...board, snapshot: snapshot({ selection: ["acc", "bogus"] }) } },
    { ss: { ...board, snapshot: snapshot({ period: "month" }) } }, { ss: { ...board, snapshot: snapshot({ hideFinals: "1" }) } }, { ss: { ...board, snapshot: snapshot({ scrollY: -1 }) } },
    { ss: { ...board, snapshot: snapshot({ scrollY: Infinity }) } }, { ss: { ...board, snapshot: snapshot({ origin: "<x>" }) } }]) assert.equal(readEntry(bad), null, JSON.stringify(bad));
  assert.deepEqual(readEntry({ ss: { ...board, snapshot: snapshot({ date: null, selection: [], origin: "" }) } }).snapshot, snapshot({ date: null, selection: [], origin: "" }));
  // Our record merges with framework state; the framework's scroll keys are written only when given.
  assert.deepEqual(withEntry({ __vinext_previousNextUrl: "/x", __vinext_scrollY: 40 }, game), { __vinext_previousNextUrl: "/x", __vinext_scrollY: 40, ss: game });
  assert.deepEqual(withEntry(null, game, 812.4), { ss: game, __vinext_scrollX: 0, __vinext_scrollY: 812 });
});

test("ownership needs the root path, a validated source and a validated target", () => {
  const a = { v: 1, kind: "board", key: "a" }, b = { v: 1, kind: "game", key: "b", id: "g", section: "team", from: true };
  assert.equal(ownedTraversal("/", a, b), true);
  assert.equal(ownedTraversal("/", b, a), true);
  assert.equal(ownedTraversal("/guide", a, b), false);
  assert.equal(ownedTraversal("/", null, b), false);
  assert.equal(ownedTraversal("/", a, null), false);
});

function fakeWindow(path = "/") {
  const target = new EventTarget(), calls = [];
  const win = {
    location: { pathname: path, href: `https://example.test${path}` },
    history: { state: null, pushState(state, _, url) { calls.push(["push", url]); this.state = state; }, replaceState(state, _, url) { calls.push(["replace", url]); this.state = state; } },
    navigation: new EventTarget(),
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target),
  };
  return { win, calls };
}
function pop(win, state) {
  const event = new Event("popstate"); Object.defineProperty(event, "state", { value: state });
  win.history.state = state;
  // A later framework listener: it must not run for an owned traversal.
  let framework = 0; const later = () => { framework++; };
  win.addEventListener("popstate", later);
  win.dispatchEvent(event);
  win.removeEventListener("popstate", later);
  return framework;
}

test("an owned traversal stops the framework listener and re-commits the URL through replaceState; others pass through", () => {
  const { win, calls } = fakeWindow(), seen = [];
  const routes = createRouteHistory(win, traversal => seen.push(traversal));
  routes.install();
  const board = { v: 1, kind: "board", key: "a", snapshot: snapshot() }, game = { v: 1, kind: "game", key: "b", id: "g", section: "team", from: true };
  routes.replace(board, "https://example.test/", 0);
  routes.push(game, "https://example.test/?event=g", 0);
  assert.equal(win.history.state.ss, game); assert.equal(win.history.state.__vinext_scrollY, 0);
  // A pushed entry does not inherit the previous entry's framework state.
  assert.equal(Object.keys(win.history.state).includes("__vinext_previousNextUrl"), false);
  calls.length = 0;
  assert.equal(pop(win, withEntry(null, board, 812)), 0, "Back to our scoreboard is ours");
  assert.deepEqual(seen.at(-1), { target: board, source: game, owned: true });
  assert.deepEqual(calls, [["replace", "https://example.test/"]], "public replaceState re-commit");
  assert.equal(pop(win, withEntry(null, game, 0)), 0, "Forward to the game is ours");
  // A framework entry (no record) as target or source is never ours.
  assert.equal(pop(win, { __vinext_scrollY: 10 }), 1);
  assert.equal(seen.at(-1).owned, false);
  assert.equal(pop(win, withEntry(null, board, 0)), 1, "leaving a framework entry is the framework's");
  // Anything off the root path is untouched and not reported.
  const count = seen.length;
  win.location.pathname = "/guide";
  assert.equal(pop(win, withEntry(null, board, 0)), 1);
  assert.equal(seen.length, count);
  routes.dispose();
  win.location.pathname = "/";
  assert.equal(pop(win, withEntry(null, game, 0)), 1, "disposed: nothing is intercepted");
});

test("the early hook registered before the framework forwards to the mounted handler, and only while mounted", () => {
  const { win, calls } = fakeWindow(), seen = [];
  // A framework listener registered before the app mounts, as in the real page load order.
  let framework = 0; const before = () => { framework++; };
  new Function("window", EARLY_POPSTATE_SCRIPT)(win);
  win.addEventListener("popstate", before);
  assert.equal(typeof win.__ssPopstate, "function");
  new Function("window", EARLY_POPSTATE_SCRIPT)(win); // Idempotent.
  const routes = createRouteHistory(win, traversal => seen.push(traversal));
  routes.install();
  assert.equal(typeof win.__ssPopstateHandler, "function", "uses the early hook instead of a late listener");
  const board = { v: 1, kind: "board", key: "a" }, game = { v: 1, kind: "game", key: "b", id: "g", section: "team", from: true };
  routes.replace(board, "https://example.test/"); routes.push(game, "https://example.test/?event=g");
  const dispatch = state => { const event = new Event("popstate"); Object.defineProperty(event, "state", { value: state }); win.history.state = state; win.dispatchEvent(event); };
  calls.length = 0;
  dispatch(withEntry(null, board, 0));
  assert.equal(framework, 0, "the owned traversal never reaches the earlier-registered framework listener");
  assert.equal(seen.at(-1).owned, true);
  assert.deepEqual(calls, [["replace", "https://example.test/"]]);
  dispatch({ __vinext_scrollY: 0 });
  assert.equal(framework, 1, "foreign traversals still reach it");
  routes.dispose();
  assert.equal(win.__ssPopstateHandler, null);
  dispatch(withEntry(null, game, 0));
  assert.equal(framework, 2, "unmounted: the hook is inert");
});

test("framework pushes and fragments invalidate ownership; traversals are judged by popstate alone", () => {
  const { win } = fakeWindow(), seen = [];
  const routes = createRouteHistory(win, traversal => seen.push(traversal));
  routes.install();
  const board = { v: 1, kind: "board", key: "a" };
  routes.replace(board, "https://example.test/");
  // A framework Link push leaves state without our record.
  win.history.state = null;
  const push = new Event("currententrychange"); Object.defineProperty(push, "navigationType", { value: "push" });
  win.navigation.dispatchEvent(push);
  assert.equal(routes.current(), null);
  routes.replace(board, "https://example.test/");
  win.history.state = null;
  win.dispatchEvent(new Event("hashchange"));
  assert.equal(routes.current(), null);
  // A traversal's entry change does not pre-empt the popstate ownership check.
  routes.replace(board, "https://example.test/");
  win.history.state = { __vinext_scrollY: 0 };
  const traverse = new Event("currententrychange"); Object.defineProperty(traverse, "navigationType", { value: "traverse" });
  win.navigation.dispatchEvent(traverse);
  assert.equal(routes.current(), board);
  routes.dispose();
});
