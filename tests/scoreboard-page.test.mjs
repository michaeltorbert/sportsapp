import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { retainFinalCategories } = await bundle("lib/football.ts");

// Exercise the real page and game cards with controlled hook data and lightweight
// UI wrappers. The catalog primitives have separate tests; no browser/feed is used.
const output = await build({
  entryPoints: ["app/page.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
  plugins: [{ name: "score-page-runtime", setup(build) {
    build.onResolve({ filter: /^(next\/link|react(?:\/jsx-runtime)?|lucide-react|@\/components\/.*|@\/lib\/(?:use-scoreboard|use-app-update|use-duke-visibility))$/ }, args => ({ path: args.path, namespace: "page-test" }));
    build.onLoad({ filter: /.*/, namespace: "page-test" }, args => {
      if (args.path === "@/components/halftime-status") return { contents: "export const HalftimeStatus=()=>\"Halftime\";" };
      if (args.path === "next/link") return { contents: "export default ({children,...props})=>globalThis.scorePageTest.element('a',props,children);" };
      if (args.path === "react") return { contents: "export const useMemo=fn=>fn(),useState=(...a)=>globalThis.scorePageTest.useState(...a),useRef=v=>({current:v}),useEffect=fn=>globalThis.scorePageTest.effect(fn),useSyncExternalStore=()=>null;" };
      if (args.path === "react/jsx-runtime") return { contents: "export const jsx=(...a)=>globalThis.scorePageTest.jsx(...a),jsxs=(...a)=>globalThis.scorePageTest.jsxs(...a),Fragment=globalThis.scorePageTest.Fragment;" };
      if (args.path === "@/lib/use-duke-visibility") return { contents: "export const useDukeVisibility=()=>({prefs:null,storageWarning:'',setHidden(){},setMode(){}});" };
      if (args.path === "@/lib/use-app-update") return { contents: "export const LOADED_COMMIT=undefined,useAppUpdate=()=>({target:null,status:'',refreshing:false,check(){},refresh(){},dismiss(){}});" };
      if (args.path === "@/lib/use-scoreboard") return { contents: "export const useScoreboard=scope=>globalThis.scorePageTest.scoreboard(scope);" };
      if (args.path === "lucide-react") return { contents: "export const ArrowUpRight=()=>null,CalendarDays=()=>null,ChevronLeft=()=>null,ChevronRight=()=>null,CircleHelp=()=>null,CloudOff=()=>null,Radio=()=>null,RefreshCw=()=>null,Signal=()=>null,TriangleAlert=()=>null,Tv=()=>null,Zap=()=>null;" };
      return { contents: `
        const wrapper=({children})=>globalThis.scorePageTest.element('div',null,children);
        export const Tabs=wrapper,TabsList=wrapper,Empty=wrapper,EmptyHeader=wrapper,EmptyMedia=wrapper,EmptyTitle=wrapper,EmptyDescription=wrapper,Sheet=wrapper,SheetTrigger=wrapper,SheetHeader=wrapper,SheetTitle=wrapper,SheetDescription=wrapper;
        export const SheetContent=({children})=>globalThis.scorePageTest.showHelp?wrapper({children}):null,Skeleton=()=>null,Alerts=()=>null,AppUpdateNotice=()=>null,AppNavigation=()=>null,DukeSettings=()=>null,DukeGameControls=()=>null;
      ` };
    });
  } }],
});
// The JSX runtime captures Fragment at import; other fixture fields are read per render.
globalThis.scorePageTest = jsxRuntime;
const { default: Home } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
delete globalThis.scorePageTest;

beforeEach(t => t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-06T06:00:00Z") }));

function fixtures() {
  const focused = game({ id: "focused" });
  focused.teams.forEach(team => { team.rank = null; }); focused.teams[0].score = 0;
  const acc = game({ id: "acc-only" }); acc.teams[0].conferenceId = "1";
  acc.teams.forEach(team => { team.rank = null; });
  const games = ["live", "delayed", "upcoming", "other", "final"].map(state => game({ id: `top-${state}`, state, date: state === "upcoming" ? "2026-09-08T02:00:00Z" : "2026-09-06T02:30:00Z" }));
  const rankedAcc = game({ id: "ranked-acc", state: "upcoming", date: "2026-09-06T22:00:00Z" });
  rankedAcc.teams[0].conferenceId = "1";
  const daily = game({ id: "daily-only" }); daily.teams[0].rank = 5;
  return {
    daily: scoreboard([daily, focused]),
    week: scoreboard([...games, rankedAcc, acc, focused], "2026-09-03", { endDate: "2026-09-07" }),
  };
}

// Home's useState order: selection, period, hideFinals, focusedGame, expanded games.
function render(selection, { period = "day", hideFinals = false, focusedGame = "", showHelp = false, boards = fixtures(), effects = [], changes = [] } = {}) {
  let state = 0, selectedScope;
  globalThis.scorePageTest = {
    ...jsxRuntime, showHelp, element: React.createElement,
    effect(fn) { effects.push(fn); },
    useState(initial) { const slot = state++; return [[selection, period, hideFinals, focusedGame][slot] ?? initial, value => changes.push({ slot, value })]; },
    scoreboard(scope) { selectedScope = scope; return { date: "2026-08-29", today: "2026-09-05", boards, data: boards[scope], error: "", refreshing: false, online: true, now: Date.now(), timezone: "EDT", refresh() {}, setDate() {}, followToday: true }; },
  };
  try { return { html: renderToStaticMarkup(React.createElement(Home)), scope: selectedScope }; }
  finally { delete globalThis.scorePageTest; }
}

function cardIds(html) { return [...html.matchAll(/<article id="game-([^"]+)"/g)].map(match => match[1]); }
function badge(html, category) { return Number(new RegExp(`class="filter-tab filter-${category}"[^>]*>.*?<span class="tab-count">(\\d+)</span>`).exec(html)?.[1]); }
function upsetBadge(html) { const match = /class="tab-count upset-count" aria-hidden="true">(\d+) <span class="upset-total">\((\d+)\)<\/span>/.exec(html); return match ? match.slice(1).map(Number) : null; }
function pressed(html) { return [...html.matchAll(/class="filter-tab filter-([a-z0-9]+)" aria-pressed="(true|false)"/g)].filter(m => m[2] === "true").map(m => m[1]); }

test("Week with Top 25 renders weekly sections, future non-ACC and ACC games, dates, and period-relative counts", () => {
  const { html, scope } = render(["top25"], { period: "week" });
  assert.equal(scope, "week");
  assert.match(html, /Top 25 this week\./); assert.match(html, /THU–MON/);
  assert.doesNotMatch(html, /Scoreboard date, Eastern time|overnight-note/);
  assert.deepEqual(pressed(html), ["top25"]);
  assert.match(html, /aria-label="Scoreboard period"><button aria-pressed="false">Day<\/button><button aria-pressed="true">Week<\/button>/);
  const sections = [...html.matchAll(/<section class="score-section">(.*?)<\/section>/g)].map(match => match[1]);
  assert.equal(sections.length, 5);
  for (const [i, title] of ["On now", "Delayed", "Coming up", "Schedule updates", "Final"].entries()) assert.ok(sections[i].includes(title));
  assert.deepEqual(cardIds(sections[2]), ["ranked-acc", "top-upcoming"]);
  assert.match(sections[2], /class="game-day-label">Mon, Sep 7/);
  assert.deepEqual(cardIds(html), ["top-live", "top-delayed", "ranked-acc", "top-upcoming", "top-other", "top-final"]);
  assert.equal(badge(html, "top25"), cardIds(html).length);
  // Every count describes the week: All is the deduplicated union and ACC includes the ranked ACC game.
  assert.equal(badge(html, "watch"), 7); assert.equal(badge(html, "acc"), 2);
  assert.equal((html.match(/<section class="score-content"/g) || []).length, 1, "one results region");
});

test("Hide finals removes the weekly final section and adjusts every weekly count", () => {
  const { html } = render(["top25"], { period: "week", hideFinals: true });
  assert.equal(badge(html, "top25"), 5); assert.equal(cardIds(html).length, 5);
  assert.equal(badge(html, "watch"), 6);
  assert.doesNotMatch(html, /game-top-final|<h2>Final<\/h2>/); assert.match(html, /Coming up/);
});

test("Upsets shows brewing first, completed upset results in the total, and an accessible label", () => {
  const live = game({ id: "brewing" });
  live.teams[0].rank = 5; live.teams[1].rank = null;
  const final = game({ id: "concluded", state: "final", retainedCategories: { acc: false, top25: false, close: false, upset: true } });
  final.teams[0].rank = 5; final.teams[1].rank = null;
  const recovered = game({ id: "recovered", state: "final", retainedCategories: { acc: false, top25: false, close: false, upset: true } });
  const boards = fixtures(); boards.daily = scoreboard([live, final, recovered]);
  const shown = render(["upset"], { boards }).html;
  assert.deepEqual(upsetBadge(shown), [1, 2]);
  assert.match(shown, /aria-label="Upsets, 1 brewing, 2 brewing or completed upsets"/);
  const hidden = render(["upset"], { boards, hideFinals: true }).html;
  assert.deepEqual(upsetBadge(hidden), [1, 1]);
  assert.match(hidden, /aria-label="Upsets, 1 brewing, 1 brewing or completed upsets"/);
});

test("Day keeps manual date navigation and the All-only focused game; Week hides daily controls for every selection", () => {
  const all = render([], { focusedGame: "focused" });
  assert.equal(all.scope, "daily");
  assert.deepEqual(pressed(all.html), ["watch"]);
  assert.deepEqual(cardIds(all.html), ["daily-only", "focused"]); assert.equal(badge(all.html, "watch"), 2);
  assert.match(all.html, /Your watchlist\./);
  assert.match(all.html, /value="2026-08-29"/); assert.match(all.html, /overnight-note/);
  assert.doesNotMatch(all.html, /game-day-label|THU–MON/);
  for (const selection of [["close"], ["upset"], ["acc", "top25"], ["top25"]]) {
    const daily = render(selection, { focusedGame: "focused" }); assert.equal(daily.scope, "daily");
    assert.deepEqual(cardIds(daily.html), ["daily-only"], JSON.stringify(selection));
    assert.deepEqual(pressed(daily.html), selection);
    assert.match(daily.html, /value="2026-08-29"/); assert.doesNotMatch(daily.html, /THU–MON/);
  }
  assert.match(render(["acc"]).html, /No ACC games on this day\./);
  const week = render(["top25"], { period: "week", focusedGame: "focused" }); assert.ok(!cardIds(week.html).includes("focused"));
  const acc = render(["acc"], { period: "week" }); assert.equal(acc.scope, "week"); assert.deepEqual(cardIds(acc.html), ["acc-only", "ranked-acc"]);
  assert.match(acc.html, /ACC this week\./); assert.match(acc.html, /THU–MON/); assert.doesNotMatch(acc.html, /overnight-note|Scoreboard date, Eastern time/);
  const weekAll = render([], { period: "week", focusedGame: "focused" });
  assert.match(weekAll.html, /Your watchlist this week\./); assert.ok(cardIds(weekAll.html).includes("focused"));
});

test("ORD-011 combined categories show each matching game once in shared order with a combined heading", () => {
  const { html } = render(["acc", "top25"], { period: "week" });
  assert.deepEqual(pressed(html), ["acc", "top25"]);
  assert.match(html, /ACC and Top 25 this week\./);
  assert.deepEqual(cardIds(html), ["acc-only", "top-live", "top-delayed", "ranked-acc", "top-upcoming", "top-other", "top-final"]);
  assert.equal(new Set(cardIds(html)).size, cardIds(html).length);
  const all = cardIds(render([], { period: "week" }).html);
  assert.deepEqual(cardIds(html), all.filter(id => cardIds(html).includes(id)), "combined selection preserves the shared All ordering");
  const upsetOnly = render(["acc", "close", "upset"], { period: "week" });
  assert.match(upsetOnly.html, /ACC, One-score, and Upset watch this week\./);
  assert.deepEqual(pressed(upsetOnly.html), ["acc", "close", "upset"]);
  const four = render(["acc", "top25", "close", "upset"]);
  assert.deepEqual(pressed(four.html), ["acc", "top25", "close", "upset"], "four manual selections do not collapse to All");
});

test("empty weekly copy explains the weekly scope without offering hidden daily controls, for one or several categories", () => {
  const boards = fixtures(); boards.week.games = [];
  const { html } = render(["top25"], { period: "week", boards });
  assert.match(html, /No Top 25 games this week/);
  assert.doesNotMatch(html, /Choose another date/); assert.equal(badge(html, "top25"), 0);
  const combined = render(["acc", "upset"], { period: "week", boards }).html;
  assert.match(combined, /Nothing matches these categories this week\./); assert.doesNotMatch(combined, /Choose another date/);
  const day = render(["acc", "upset"], { boards: { ...fixtures(), daily: scoreboard([]) } }).html;
  assert.match(day, /Nothing matches these categories\./); assert.match(day, /Choose another date/);
  const unknown = render([], { boards: { ...fixtures(), daily: null } }).html;
  assert.equal((unknown.match(/<span class="tab-count">–<\/span>/g) || []).length, 4, "ordinary unloaded counts stay unknown, not zero");
  assert.match(unknown, /aria-label="Upsets, counts loading"[^>]*>.*?<span class="tab-count upset-count" aria-hidden="true">– \(–\)<\/span>/);
});

test("unranked SEC upset cards explain the favorite without inventing a ranking", () => {
  const florida = game({ id: "florida-ecu" });
  Object.assign(florida.teams[0], { name: "Florida", conferenceId: "8", rank: null, score: 7 });
  Object.assign(florida.teams[1], { name: "East Carolina", conferenceId: "151", rank: null, score: 21 });
  florida.pregameLine = { favoriteId: "a", spread: 14, source: "ESPN" };
  const boards = fixtures(); boards.daily = scoreboard([florida]);
  const { html } = render(["upset"], { boards });
  assert.deepEqual(cardIds(html), ["florida-ecu"]);
  assert.match(html, /East Carolina leads Florida · pregame favorite/);
  assert.match(html, /Upset watch/);
  assert.doesNotMatch(html, /No\. (null|undefined)/);
});

test("validated pregame lines appear inline with the favorite and pick’em remains neutral", () => {
  const favorite = game({ id: "favorite-line", state: "upcoming", started: false, pregameLine: { favoriteId: "b", spread: 7.5, source: "ESPN" } });
  const pickem = game({ id: "pickem-line", state: "upcoming", started: false, pregameLine: { favoriteId: null, spread: 0, source: "ESPN" } });
  const missing = game({ id: "missing-line", state: "upcoming", started: false });
  const boards = fixtures(); boards.daily = scoreboard([favorite, pickem, missing]);
  const { html } = render([], { boards });
  const favoriteCard = html.match(/<article id="game-favorite-line"[\s\S]*?<\/article>/)?.[0];
  const pickemCard = html.match(/<article id="game-pickem-line"[\s\S]*?<\/article>/)?.[0];
  const missingCard = html.match(/<article id="game-missing-line"[\s\S]*?<\/article>/)?.[0];
  assert.match(favoriteCard, /class="team-label">Team b<\/span><span class="team-line"[^>]*>.*?−7\.5<\/span><\/span><\/span>/);
  assert.equal((favoriteCard.match(/class="team-line"/g) || []).length, 1);
  assert.match(favoriteCard, /Team b favored by 7\.5 points before kickoff, ESPN/);
  assert.doesNotMatch(favoriteCard, /<small>Pregame<\/small>/);
  assert.match(pickemCard, /class="pickem-line"[^>]*>.*?PK<\/span><\/span>/);
  assert.doesNotMatch(pickemCard, /class="team-line"/);
  assert.doesNotMatch(missingCard, /class="(?:team-line|pickem-line)"/);
  for (const state of ["live", "final"]) {
    const gameWithLine = game({ id: `${state}-line`, state, pregameLine: { favoriteId: "b", spread: 7.5, source: "ESPN" } });
    boards.daily = scoreboard([gameWithLine]);
    assert.match(render([], { boards }).html, /class="team-label">Team b<\/span><span class="team-line"[^>]*>.*?<small>Pregame<\/small><span>−7\.5<\/span>/);
  }
  boards.daily = scoreboard([game({ id: "live-pickem", pregameLine: { favoriteId: null, spread: 0, source: "ESPN" } })]);
  assert.match(render([], { boards }).html, /class="pickem-line"[^>]*>.*?Pregame PK<\/span>/);
  boards.daily = scoreboard([game({ id: "live-before-clock", state: "live", started: false, period: 0, pregameLine: { favoriteId: "b", spread: 7.5, source: "ESPN" } })]);
  assert.match(render([], { boards }).html, /class="team-line-visible"[^>]*><small>Pregame<\/small><span>−7\.5<\/span>/);
  boards.daily = scoreboard([game({ id: "live-pickem-before-clock", state: "live", started: false, period: 0, pregameLine: { favoriteId: null, spread: 0, source: "ESPN" } })]);
  assert.match(render([], { boards }).html, /class="pickem-line"[^>]*>.*?Pregame PK<\/span>/);
});

test("retained upset finals distinguish a comeback from a completed conference upset", () => {
  const final = game({ id: "retained", state: "final", retainedCategories: { acc: false, top25: false, close: false, upset: true } });
  Object.assign(final.teams[0], { name: "Florida", conferenceId: "8", rank: null, score: 28 });
  Object.assign(final.teams[1], { name: "East Carolina", conferenceId: "151", rank: null, score: 21 });
  const boards = fixtures(); boards.daily = scoreboard([final]);
  const comeback = render(["upset"], { boards }).html;
  assert.match(comeback, /Earlier upset watch/);
  assert.doesNotMatch(comeback, /Upset final|East Carolina beat Florida/);
  final.teams[0].score = 7;
  const upset = render(["upset"], { boards }).html;
  assert.match(upset, /Conference watch/);
  assert.match(upset, /East Carolina beat Florida · SEC conference watch/);
  assert.doesNotMatch(upset, /pregame favorite|No\. (null|undefined)/);
});

test("Help separates selective alert policy from line-based display categories", () => {
  const underdog = game({ id: "ranked-underdog", pregameLine: { favoriteId: "b", spread: 3, source: "ESPN" } });
  Object.assign(underdog.teams[0], { rank: 12, score: 17 });
  Object.assign(underdog.teams[1], { rank: 15, score: 20 });
  const boards = fixtures(); boards.daily = scoreboard([underdog]);
  const { html } = render([], { boards, showHelp: true });
  assert.deepEqual(cardIds(html), ["ranked-underdog"]);
  assert.doesNotMatch(html, /class="badge upset-badge"|class="upset-reason"/);
  assert.match(html, /Phone alerts are separate from these display categories/);
  assert.match(html, /Close-game alerts prioritize stronger live games and may skip two-unranked Group-of-Six matchups/);
  assert.match(html, /Selected categories do not filter notifications/);
  assert.match(html, /Upcoming games remain chronological within those pin tiers/);
  assert.match(html, /Day shows the selected Eastern date\. Week shows the current football week/);
  assert.deepEqual(cardIds(render(["upset"], { boards }).html), []);
});

test("live conference watches use the same honest badge as conference finals", () => {
  const g = game({ id: "conference-live" });
  Object.assign(g.teams[0], { conferenceId: "8", rank: null, score: 7 });
  Object.assign(g.teams[1], { conferenceId: "151", rank: null, score: 21 });
  const boards = fixtures(); boards.daily = scoreboard([g]);
  const { html } = render(["upset"], { boards });
  assert.match(html, /class="badge upset-badge">Conference watch/);
  assert.match(html, /SEC conference watch/);
  const paused = { ...g, state: "delayed", started: true };
  const final = structuredClone(g); final.state = "final"; final.teams[0].score = 35;
  boards.daily = retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(scoreboard([paused]))));
  const completed = render(["upset"], { boards }).html;
  assert.deepEqual(cardIds(completed), [g.id]);
  assert.match(completed, /Earlier upset watch/);
  assert.doesNotMatch(completed, /class="upset-reason"/);
});

test("a delayed close observation stays out of One score until its retained final", () => {
  const live = game({ id: "delay-close" });
  const delay = { ...live, state: "delayed" };
  const paused = retainFinalCategories(scoreboard([delay]), scoreboard([live]));
  const boards = fixtures(); boards.daily = paused;
  const delayed = render(["close"], { boards }).html;
  assert.deepEqual(cardIds(delayed), []);
  assert.equal(badge(delayed, "close"), 0);
  const watched = render([], { boards, focusedGame: live.id }).html;
  assert.match(watched, /Play paused\. Watching for an update\./);
  assert.doesNotMatch(watched, /class="badge close-badge"/);
  const final = structuredClone(live); final.state = "final"; final.teams[1].score = 35;
  boards.daily = retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(paused)));
  const html = render(["close"], { boards }).html;
  assert.deepEqual(cardIds(html), [live.id]);
  assert.match(html, /One-score watch/);
});

test("restoration effect replay uses its captured snapshot after transient URL cleanup", () => {
  const effects = [], changes = [];
  render([], { effects, changes });
  const original = new Map(["location", "history", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const url = new URL(`https://example.test/?_ss_update=${"b".repeat(40)}&_ss_hide_finals=1&_ss_focus=focused`);
  Object.defineProperty(globalThis, "location", { configurable: true, value: url });
  Object.defineProperty(globalThis, "history", { configurable: true, value: { state: { retained: true }, replaceState(state, title, next) { assert.deepEqual(state, { retained: true }); url.href = String(next); } } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem() { throw Error("Restoration must not read stored preference"); } } });
  try {
    effects[0](); assert.equal(url.search, ""); effects[0]();
    assert.deepEqual(changes, [{ slot: 2, value: true }, { slot: 3, value: "focused" }, { slot: 2, value: true }, { slot: 3, value: "focused" }]);
  } finally { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});
