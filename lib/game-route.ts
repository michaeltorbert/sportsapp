import { gameId, viewSearch } from "./app-update";
import { validDate } from "./football";
import { normalizeSelection, type Period, type Selection } from "./scoreboard-views";

// The dedicated game screen lives on the same root as the scoreboard:
// `/?event=<id>[&section=players]`, plus the scoreboard's own date/cats/period.
// History entries carry a versioned `ss` record merged into the framework's
// state. It holds UI state and IDs only, never game content.
export type Section = "team" | "players";
export type GameRoute = { id: string; section: Section };
export type BoardView = { date: string | null; selection: Selection; period: Period; hideFinals: boolean };
export type BoardSnapshot = BoardView & { scrollY: number; origin: string };
export type BoardEntry = { v: 1; kind: "board"; key: string; snapshot?: BoardSnapshot; consumed?: string };
// `from`: an entry of ours for the scoreboard sits directly behind this one.
export type GameEntry = { v: 1; kind: "game"; key: string; id: string; section: Section; from: boolean };
export type RouteEntry = BoardEntry | GameEntry;
export type UrlView = { date: string; followToday: boolean; selection: Selection; period: Period };

const TRANSIENT = ["_ss_update", "_ss_hide_finals", "_ss_focus", "_ss_open"];
const MAX_SCROLL = 10_000_000;

export function parseGameRoute(search: string | null): GameRoute | null {
  const params = new URLSearchParams(search || ""), id = gameId(params.get("event"));
  return id ? { id, section: params.get("section") === "players" ? "players" : "team" } : null;
}
function applyView(url: URL, view: UrlView) {
  if (view.followToday) url.searchParams.delete("date");
  else if (validDate(view.date)) url.searchParams.set("date", view.date);
  viewSearch(url, view);
}
/** The game destination. Unrelated parameters survive; a legacy `#game-` hash and update keys do not. */
export function gameUrl(href: string, route: GameRoute, view: UrlView): string {
  const url = new URL(href);
  for (const key of ["event", "section", ...TRANSIENT]) url.searchParams.delete(key);
  applyView(url, view);
  const params = new URLSearchParams({ event: route.id, ...(route.section === "players" ? { section: "players" } : {}) });
  for (const [key, value] of url.searchParams) params.append(key, value);
  url.search = params.toString();
  if (/^#game-/.test(url.hash)) url.hash = "";
  return url.href;
}
/** Same-root relative link for a scoreboard card (a new tab opens it as a direct link). */
export function gameHref(route: GameRoute, view: UrlView): string {
  const url = new URL(gameUrl("https://app.invalid/", route, view));
  return url.pathname + url.search;
}
export function sectionUrl(href: string, section: Section): string {
  const url = new URL(href);
  if (section === "players") url.searchParams.set("section", "players"); else url.searchParams.delete("section");
  return url.href;
}
/** The scoreboard fallback for a game entry with no scoreboard entry of ours behind it. */
export function boardUrl(href: string, view: UrlView): string {
  const url = new URL(href);
  for (const key of ["event", "section", ...TRANSIENT]) url.searchParams.delete(key);
  applyView(url, view);
  return url.href;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const validKey = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{1,16}$/.test(value);
function readSnapshot(value: unknown): BoardSnapshot | null {
  const s = record(value);
  if (!s || !Array.isArray(s.selection) || !(s.date === null || (typeof s.date === "string" && validDate(s.date)))) return null;
  const selection = normalizeSelection(s.selection);
  if (selection.length !== s.selection.length || (s.period !== "day" && s.period !== "week") || typeof s.hideFinals !== "boolean") return null;
  if (typeof s.scrollY !== "number" || !Number.isFinite(s.scrollY) || s.scrollY < 0 || s.scrollY > MAX_SCROLL) return null;
  if (typeof s.origin !== "string" || (s.origin !== "" && !gameId(s.origin))) return null;
  return { date: s.date as string | null, selection, period: s.period, hideFinals: s.hideFinals, scrollY: s.scrollY, origin: s.origin };
}
/** Validates the app-owned record in a history state. Anything else is not ours. */
export function readEntry(state: unknown): RouteEntry | null {
  const e = record(record(state)?.ss);
  if (!e || e.v !== 1 || !validKey(e.key)) return null;
  if (e.kind === "board") {
    const snapshot = e.snapshot === undefined ? undefined : readSnapshot(e.snapshot);
    const consumed = e.consumed === undefined ? undefined : gameId(typeof e.consumed === "string" ? e.consumed : null);
    if (snapshot === null || consumed === "") return null;
    return { v: 1, kind: "board", key: e.key, ...(snapshot ? { snapshot } : {}), ...(consumed ? { consumed } : {}) };
  }
  if (e.kind === "game") {
    const id = gameId(typeof e.id === "string" ? e.id : null);
    if (!id || (e.section !== "team" && e.section !== "players") || typeof e.from !== "boolean") return null;
    return { v: 1, kind: "game", key: e.key, id, section: e.section, from: e.from };
  }
  return null;
}
/**
 * Merges our record into the framework's state. `__vinext_scrollX/Y` are what
 * vinext's own popstate restoration reads (shims/navigation.js
 * restoreScrollPosition) for traversals it handles, such as a return from the Guide.
 */
export function withEntry(state: unknown, entry: RouteEntry, scrollY?: number) {
  return { ...(record(state) || {}), ss: entry, ...(scrollY === undefined ? {} : { __vinext_scrollX: 0, __vinext_scrollY: Math.max(0, Math.round(scrollY)) }) };
}
export function newKey() { return Math.random().toString(36).slice(2, 12) || "k"; }

/** Ours only when the root path, the entry being left and the target entry are all app-owned. */
export function ownedTraversal(pathname: string, source: RouteEntry | null, target: RouteEntry | null) {
  return pathname === "/" && !!source && !!target;
}

type HistoryLike = { readonly state: unknown; pushState(data: unknown, unused: string, url?: string | null): void; replaceState(data: unknown, unused: string, url?: string | null): void };
type Target = { addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void; removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void };
type Listener = (event: Event) => void;
export type RouteWindow = Target & { location: { pathname: string; href: string }; history: HistoryLike; navigation?: Target; __ssPopstate?: unknown; __ssPopstateHandler?: Listener | null };
export type Traversal = { target: RouteEntry | null; source: RouteEntry | null; owned: boolean };

/**
 * Registered from the root layout's HTML on every route, before the framework's
 * entry script runs. Why: in browser runs, owned Back traversals reached the
 * framework's popstate handler in Chromium but not WebKit, although our listener
 * was a capture listener added after hydration. That is consistent with Chromium
 * running window-targeted listeners in registration order, but it was inferred
 * from outcomes, not observed in a listener timeline, and is not claimed as
 * general browser behavior. Registering first does not depend on that ordering
 * rule either way; the browser tests prove this mitigation, not the cause.
 * It is still a capture listener and inert by itself: it forwards only to the
 * handler the mounted Scores page installs, which acts only when both entries
 * are its own validated root entries. History is not patched.
 */
export const EARLY_POPSTATE_SCRIPT = "(()=>{const w=window;if(w.__ssPopstate)return;w.__ssPopstate=e=>{const h=w.__ssPopstateHandler;if(typeof h===\"function\")h(e)};w.addEventListener(\"popstate\",w.__ssPopstate,true)})();";

/**
 * Root-owned history for the scoreboard and game screen. One capture-phase
 * `popstate` listener on window runs before the framework's listeners: the
 * early one from the root layout's HTML (any first route), else one added on
 * mount as a fallback for a document without it. It
 * handles a traversal only when both the entry being left and the target are
 * validated entries of ours on `/`; it then stops the event so no RSC
 * navigation or document load runs, and re-commits the URL through the public
 * `history.replaceState`, which the framework patches to keep its own URL
 * consumers current. Every other traversal, including the Guide and framework
 * entries, is left untouched. Nothing about `history` is patched.
 */
export function createRouteHistory(win: RouteWindow, onTraverse: (traversal: Traversal) => void) {
  // The early hook is in every server-rendered document; the late listener is only a fallback.
  const early = typeof win.__ssPopstate === "function";
  let current = readEntry(win.history.state);
  const resync = () => { current = readEntry(win.history.state); };
  const popstate = (event: Event) => {
    const target = readEntry((event as PopStateEvent).state), source = current;
    const root = win.location.pathname === "/";
    current = root ? target : null;
    if (!root) return;
    const owned = ownedTraversal(win.location.pathname, source, target);
    if (owned) event.stopImmediatePropagation();
    onTraverse({ target, source, owned });
    if (owned) win.history.replaceState(win.history.state, "", win.location.href);
  };
  // Pushes outside our control (a framework Link, a fragment) leave an entry without our record.
  // A traversal's own entry change is handled by popstate, never here.
  const entryChange = (event: Event) => { if ((event as Event & { navigationType?: string }).navigationType !== "traverse") resync(); };
  return {
    install() {
      if (early) win.__ssPopstateHandler = popstate; else win.addEventListener("popstate", popstate, { capture: true });
      win.addEventListener("hashchange", resync);
      win.navigation?.addEventListener("currententrychange", entryChange);
    },
    dispose() {
      if (early) { if (win.__ssPopstateHandler === popstate) win.__ssPopstateHandler = null; }
      else win.removeEventListener("popstate", popstate, { capture: true });
      win.removeEventListener("hashchange", resync);
      win.navigation?.removeEventListener("currententrychange", entryChange);
    },
    current: () => current,
    resync,
    // A new entry starts from no framework state, as the framework's own pushes do.
    push(entry: RouteEntry, url: string, scrollY = 0) { win.history.pushState(withEntry(null, entry, scrollY), "", url); current = entry; },
    // Without a scroll position the framework's saved one is kept.
    replace(entry: RouteEntry, url: string, scrollY?: number) { win.history.replaceState(withEntry(win.history.state, entry, scrollY), "", url); current = entry; },
  };
}
export type RouteHistory = ReturnType<typeof createRouteHistory>;
