import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { bundle, game, scoreboard } from "./helpers.mjs";
const { retainFinalCategories, shiftDate } = await bundle("lib/football.ts");

// Exercise the real page and game cards with controlled hook data and lightweight
// UI wrappers. The catalog primitives have separate tests; no browser/feed is used.
const output = await build({
  entryPoints: ["app/page.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
  plugins: [{ name: "score-page-runtime", setup(build) {
    build.onResolve({ filter: /^(next\/link|react(?:\/jsx-runtime)?|lucide-react|@\/components\/.*|@\/lib\/(?:use-scoreboard|use-app-update|use-duke-visibility|use-team-season))$/ }, args => ({ path: args.path, namespace: "page-test" }));
    build.onLoad({ filter: /.*/, namespace: "page-test" }, args => {
      if (args.path === "@/components/halftime-status") return { contents: "export const HalftimeStatus=()=>\"Halftime\";" };
      if (args.path === "next/link") return { contents: "export default ({children,...props})=>globalThis.scorePageTest.element('a',props,children);" };
      if (args.path === "react") return { contents: "export const useMemo=fn=>fn(),useState=(...a)=>globalThis.scorePageTest.useState(...a),useRef=v=>({current:v}),useEffect=fn=>globalThis.scorePageTest.effect(fn),useLayoutEffect=()=>{},useSyncExternalStore=()=>null;" };
      if (args.path === "react/jsx-runtime") return { contents: "export const jsx=(...a)=>globalThis.scorePageTest.jsx(...a),jsxs=(...a)=>globalThis.scorePageTest.jsxs(...a),Fragment=globalThis.scorePageTest.Fragment;" };
      if (args.path === "@/lib/use-duke-visibility") return { contents: "export const useDukeVisibility=()=>({prefs:null,storageWarning:'',setHidden(){},setMode(){}});" };
      // Controlled like the other data hooks: no team page or team context in these scoreboard cases.
      if (args.path === "@/lib/use-team-season") return { contents: "export const useTeamSeason=()=>({season:null,pending:false,failure:null,online:true,retry(){}});" };
      if (args.path === "@/lib/use-app-update") return { contents: "export const LOADED_COMMIT=undefined,useAppUpdate=()=>({target:null,status:'',refreshing:false,check(){},refresh(){},dismiss(){}});" };
      if (args.path === "@/lib/use-scoreboard") return { contents: "export const useScoreboard=scope=>globalThis.scorePageTest.scoreboard(scope);" };
      if (args.path === "lucide-react") return { contents: "export const ArrowUpRight=()=>null,CalendarDays=()=>null,ChevronLeft=()=>null,ChevronRight=()=>null,CircleHelp=()=>null,CloudOff=()=>null,Radio=()=>null,RefreshCw=()=>null,Signal=()=>null,TriangleAlert=()=>null,Tv=()=>null,Zap=()=>null;" };
      return { contents: `
        const wrapper=({children})=>globalThis.scorePageTest.element('div',null,children);
        export const Tabs=wrapper,TabsList=wrapper,Empty=wrapper,EmptyHeader=wrapper,EmptyMedia=wrapper,EmptyTitle=wrapper,EmptyDescription=wrapper,Sheet=wrapper,SheetTrigger=wrapper,SheetHeader=wrapper,SheetTitle=wrapper,SheetDescription=wrapper;
        export const SheetContent=({children})=>globalThis.scorePageTest.showHelp?wrapper({children}):null,AppPanelContent=({title,description,children})=>globalThis.scorePageTest.showHelp?globalThis.scorePageTest.element('div',null,title,description,children):null,DisplayDetails=()=>null,Skeleton=()=>null,Alerts=()=>null,AppUpdateNotice=()=>null,AppNavigation=()=>null,DukeSettings=()=>null,DukeGameControls=()=>null;
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

// Home's useState order: selection, period, hideFinals, focusedGame, open game screen route, open intent,
// team page, team origin, All FBS scope, then the swipe pager's revealed side and leaving view (#172).
// Unset slots keep their initial values.
const SLOTS = { hideFinals: 2, focusedGame: 3, openIntent: 5, allFbs: 8 };
function render(selection, { period = "day", hideFinals = false, focusedGame = "", route, allFbs = false, showHelp = false, boards = fixtures(), stale = false, effects = [], changes = [], weekDate = null, week = weekDate ? { start: weekDate, end: shiftDate(weekDate, 4) } : { start: "2026-09-03", end: "2026-09-07" }, pager = [], neighbors = {}, neighborFailed = false } = {}) {
  let state = 0, selectedScope;
  globalThis.scorePageTest = {
    ...jsxRuntime, showHelp, element: React.createElement,
    effect(fn) { effects.push(fn); },
    useState(initial) { const slot = state++; return [[selection, period, hideFinals, focusedGame, route, undefined, undefined, undefined, allFbs, ...pager][slot] ?? initial, value => changes.push({ slot, value })]; },
    scoreboard(scope) { selectedScope = scope; return { date: "2026-08-29", today: "2026-09-05", boards, data: boards[scope] && (stale ? boards[scope] : { ...boards[scope], fetchedAt: new Date().toISOString() }), error: "", refreshing: false, online: true, now: Date.now(), timezone: "EDT", refresh() {}, setDate() {}, followToday: true, week, weekDate, setWeek() {}, followWeek: weekDate === null, peek: (s, start, end) => ({ board: neighbors[`${s}:${start}:${end}`] ?? null, failed: neighborFailed }), preview() {} }; },
  };
  try { return { html: renderToStaticMarkup(React.createElement(Home)), scope: selectedScope }; }
  finally { delete globalThis.scorePageTest; }
}

function cardIds(html) { return [...html.matchAll(/<article id="game-([^"]+)"/g)].map(match => match[1]); }
// The dedicated game screen for one game, rendered by the real page with that route open.
function screenOf(id, options = {}) { return render(options.selection || [], { ...options, route: { id, section: "team" } }).html.match(/<div class="game-screen[\s\S]*<\/div><\/main>$/)?.[0] || ""; }
// An ordinary chip's [in progress, total]; badge() is its parenthesized total.
function pair(html, category) { const match = new RegExp(`class="filter-tab filter-${category}"[^>]*><span>[^<]*</span><span class="tab-count count-pair" aria-hidden="true">(\\d+) <span class="count-total">\\((\\d+)\\)</span></span>`).exec(html); return match ? match.slice(1).map(Number) : null; }
function badge(html, category) { return pair(html, category)?.[1]; }
const unknownPair = category => new RegExp(`class="filter-tab filter-${category}"[^>]*><span>[^<]*</span><span class="tab-count count-pair" aria-hidden="true">– \\(–\\)</span>`);
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
  // In progress: live and delayed-after-kickoff games; totals keep upcoming, schedule updates and finals.
  assert.deepEqual(pair(html, "watch"), [3, 7]); assert.deepEqual(pair(html, "acc"), [1, 2]);
  assert.deepEqual(pair(html, "top25"), [2, 6]); assert.deepEqual(pair(html, "close"), [2, 3]);
  assert.match(html, /aria-label="Top 25, 2 in progress, 6 total"/);
  assert.match(html, /aria-label="All, 3 in progress, 7 total"/);
  assert.equal((html.match(/<section class="score-content"/g) || []).length, 1, "one results region");
});

test("Hide finals removes the weekly final section and adjusts every weekly count", () => {
  const { html } = render(["top25"], { period: "week", hideFinals: true });
  assert.equal(badge(html, "top25"), 5); assert.equal(cardIds(html).length, 5);
  assert.equal(badge(html, "watch"), 6);
  assert.deepEqual(pair(html, "top25"), [2, 5]); assert.deepEqual(pair(html, "watch"), [3, 6]);
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
  assert.deepEqual(cardIds(shown), ["brewing", "concluded"]);
  // All still lists the recovered favorite's final; only Upsets leaves it out.
  assert.deepEqual(pair(shown, "watch"), [1, 3]);
  const hidden = render(["upset"], { boards, hideFinals: true }).html;
  assert.deepEqual(upsetBadge(hidden), [1, 1]);
  assert.match(hidden, /aria-label="Upsets, 1 brewing, 1 brewing or completed upsets"/);
  assert.deepEqual(pair(hidden, "watch"), [1, 1]);
});

test("stale score cards remain visible while counts are unknown", () => {
  const fresh = render(["upset"]); const stale = render(["upset"], { stale: true });
  assert.deepEqual(cardIds(stale.html), cardIds(fresh.html));
  assert.match(stale.html, /Upsets, counts unavailable while scores are stale/);
  for (const label of ["All", "ACC", "Top 25", "One score"])
    assert.match(stale.html, new RegExp(`aria-label="${label}, counts unavailable while scores are stale"`));
  assert.match(stale.html, /class="tab-count upset-count" aria-hidden="true">– \(–\)/);
  assert.match(stale.html, /class="filter-tab filter-watch"[^>]*><span>All<\/span><span class="tab-count count-pair" aria-hidden="true">– \(–\)<\/span>/);
  for (const category of ["watch", "acc", "top25", "close"]) assert.match(stale.html, unknownPair(category));
  assert.doesNotMatch(stale.html, /class="(?:count-total|upset-total)"| in progress, \d+ total"/, "no fresh numbers while stale");
  assert.match(stale.html, /Waiting for a fresh score update/);
  const help = render(["upset"], { stale: true, showHelp: true }).html;
  assert.match(help, /When scores are stale, offline, or more than 90 seconds old/);
  assert.match(help, /previously loaded game cards remain visible with a warning/);
  assert.match(help, /category counts show dashes instead of fresh numbers/);
  assert.match(help, /Counts return after a successful refresh/);
});

test("Day keeps manual date navigation and the All-only focused game; Week hides daily controls for every selection", () => {
  const all = render([], { focusedGame: "focused" });
  assert.equal(all.scope, "daily");
  assert.deepEqual(pressed(all.html), ["watch"]);
  assert.deepEqual(cardIds(all.html), ["daily-only", "focused"]); assert.equal(badge(all.html, "watch"), 2);
  assert.deepEqual(pair(all.html, "watch"), [2, 2]);
  assert.deepEqual(pair(render([]).html, "watch"), [1, 1], "without focus, All counts only qualifying games");
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
  // A loaded empty week is a real zero, not unknown.
  for (const category of ["watch", "acc", "top25", "close"]) assert.deepEqual(pair(html, category), [0, 0], category);
  assert.match(html, /aria-label="Top 25, 0 in progress, 0 total"/);
  const combined = render(["acc", "upset"], { period: "week", boards }).html;
  assert.match(combined, /Nothing matches these categories this week\./); assert.doesNotMatch(combined, /Choose another date/);
  const day = render(["acc", "upset"], { boards: { ...fixtures(), daily: scoreboard([]) } }).html;
  assert.match(day, /Nothing matches these categories\./); assert.match(day, /Choose another date/);
  const unknown = render([], { boards: { ...fixtures(), daily: null } }).html;
  assert.equal((unknown.match(/<span class="tab-count count-pair" aria-hidden="true">– \(–\)<\/span>/g) || []).length, 4, "ordinary unloaded counts stay unknown, not zero");
  for (const category of ["watch", "acc", "top25", "close"]) assert.match(unknown, unknownPair(category));
  for (const label of ["All", "ACC", "Top 25", "One score"]) assert.match(unknown, new RegExp(`aria-label="${label}, counts loading"`));
  assert.doesNotMatch(unknown, /class="(?:count-total|upset-total)"| in progress, \d+ total"/, "no numbers while loading");
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
  assert.match(html, /class="compact-upset">Upset watch/);
  // The explanation moved with the other game details to the game screen.
  const screen = screenOf("florida-ecu", { boards, selection: ["upset"] });
  assert.match(screen, /class="upset-reason">.*East Carolina leads Florida · pregame favorite/);
  assert.match(screen, /class="badge upset-badge">Upset watch/);
  for (const out of [html, screen]) assert.doesNotMatch(out, /No\. (null|undefined)/);
});

test("validated lines stay with their favorite on the row and game screen", () => {
  // The scoreboard row is the whole card now; game details live on the game screen.
  const summaryOf = html => html.match(/<article id="game-[\s\S]*?<\/article>/)?.[0] || "";
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
  assert.match(favoriteCard, /Team b<\/span><span class="team-line"[^>]*><span class="sr-only">Pregame betting line: favored by 7\.5 points, ESPN/);
  assert.doesNotMatch(favoriteCard, /<small>Pregame<\/small>/);
  assert.match(pickemCard, /class="pickem-line"[^>]*>.*?PK<\/span><\/span>/);
  assert.doesNotMatch(pickemCard, /Pregame PK/);
  assert.doesNotMatch(pickemCard, /class="team-line"/);
  assert.doesNotMatch(missingCard, /class="(?:team-line|pickem-line)"/);
  for (const card of [favoriteCard, pickemCard, missingCard]) assert.doesNotMatch(card, /class="detail-line"/);
  // On the game screen the masthead is visual only, so the line row speaks its full context.
  // The game screen shows the line without its bookmaker, visibly and to screen readers (user request).
  assert.match(screenOf("favorite-line", { boards }), /class="detail-line"><span class="sr-only">Pregame betting line: Team b favored by 7\.5 points<\/span><span aria-hidden="true">Line<\/span><strong aria-hidden="true">Team b −7\.5<\/strong><\/p>/);
  assert.match(screenOf("pickem-line", { boards }), /class="detail-line"><span class="sr-only">Pregame pick’em line<\/span><span aria-hidden="true">Line<\/span><strong aria-hidden="true">PK<\/strong><\/p>/);
  assert.doesNotMatch(screenOf("missing-line", { boards }), /class="detail-line"/);
  for (const state of ["live", "final"]) {
    const gameWithLine = game({ id: `${state}-line`, state, pregameLine: { favoriteId: "b", spread: 7.5, source: "ESPN" } });
    boards.daily = scoreboard([gameWithLine]);
    const liveOrFinal = render([], { boards }).html;
    assert.match(summaryOf(liveOrFinal), /class="team-line"/);
    assert.match(screenOf(`${state}-line`, { boards }), /class="detail-line"><span class="sr-only">Pregame betting line: Team b favored by 7\.5 points<\/span><span aria-hidden="true">Line<\/span><strong aria-hidden="true">Team b −7\.5<\/strong><\/p>/);
    for (const [suffix, pregameLine] of [["missing", undefined], ["unknown-favorite", { favoriteId: "not-a-team", spread: 7.5, source: "ESPN" }]]) {
      boards.daily = scoreboard([game({ id: `${state}-${suffix}`, state, pregameLine })]);
      const unavailable = render([], { boards }).html;
      assert.doesNotMatch(summaryOf(unavailable), /class="team-line"/);
    }
    boards.daily = scoreboard([game({ id: `${state}-pickem`, state, pregameLine: { favoriteId: null, spread: 0, source: "ESPN" } })]);
    assert.match(summaryOf(render([], { boards }).html), /class="pickem-line"[^>]*>.*?PK/);
  }
  boards.daily = scoreboard([game({ id: "live-pickem", pregameLine: { favoriteId: null, spread: 0, source: "ESPN" } })]);
  const livePickem = render([], { boards }).html;
  assert.match(summaryOf(livePickem), /class="pickem-line"/);
  assert.match(screenOf("live-pickem", { boards }), /class="detail-line"><span class="sr-only">Pregame pick’em line<\/span><span aria-hidden="true">Line<\/span><strong aria-hidden="true">PK<\/strong><\/p>/);
  boards.daily = scoreboard([game({ id: "live-before-clock", state: "live", started: false, period: 0, pregameLine: { favoriteId: "b", spread: 7.5, source: "ESPN" } })]);
  const liveBeforeClock = render([], { boards }).html;
  assert.match(summaryOf(liveBeforeClock), /class="team-line"/);
  assert.match(screenOf("live-before-clock", { boards }), /class="detail-line"[^>]*>.*?Team b −7\.5/);
  boards.daily = scoreboard([game({ id: "live-pickem-before-clock", state: "live", started: false, period: 0, pregameLine: { favoriteId: null, spread: 0, source: "ESPN" } })]);
  const pickemBeforeClock = render([], { boards }).html;
  assert.match(summaryOf(pickemBeforeClock), /class="pickem-line"/);
  assert.match(screenOf("live-pickem-before-clock", { boards }), /class="detail-line"[^>]*>.*?<strong aria-hidden="true">PK<\/strong>/);
  for (const started of [true, false]) {
    boards.daily = scoreboard([game({ id: `delayed-${started}`, state: "delayed", started, pregameLine: { favoriteId: "b", spread: 7.5, source: "ESPN" } })]);
    const delayed = render([], { boards }).html;
    assert.equal(summaryOf(delayed).includes('class="team-line"'), true);
    assert.equal(screenOf(`delayed-${started}`, { boards }).includes('class="detail-line"'), true);
  }
  boards.daily = scoreboard([game({ id: "away-favorite", state: "upcoming", started: false, pregameLine: { favoriteId: "a", spread: 3.5, source: "ESPN" } })]);
  const awayCard = render([], { boards }).html.match(/<article id="game-away-favorite"[\s\S]*?<\/article>/)?.[0];
  assert.match(awayCard, /class="team-label">Team a<\/span><span class="team-line"[^>]*>.*?−3\.5<\/span>/);
  assert.doesNotMatch(awayCard, /class="team-label">Team b<\/span><span class="team-line"/);
});

test("screen readers hear pregame context for the line instead of the visible label and minus sign", () => {
  const cardOf = (html, id) => html.match(new RegExp(`<article id="game-${id}"[\\s\\S]*?<\\/article>`))?.[0];
  const line = { favoriteId: "a", spread: 1, source: "ESPN BET" };
  const boards = fixtures(); boards.daily = scoreboard([game({ id: "one-point-live", pregameLine: line }), game({ id: "one-point-upcoming", state: "upcoming", started: false, pregameLine: line })]);
  const { html } = render([], { boards });
  const detail = screenOf("one-point-live", { boards }).match(/<p class="detail-line">([\s\S]*?)<\/p>/)?.[1];
  assert.match(detail, /^<span class="sr-only">Pregame betting line: Team a favored by 1 point<\/span>/);
  assert.equal(detail.replace(/^<span class="sr-only">.*?<\/span>/, "").match(/<(?:span|strong)(?: [^>]*)?>/g).every(tag => tag.includes('aria-hidden="true"')), true);
  // The game screen's line names no bookmaker, visibly or to screen readers.
  assert.doesNotMatch(detail, /ESPN BET|ESPN/);
  // The scoreboard row keeps its existing source wording.
  assert.match(cardOf(html, "one-point-upcoming"), /<span class="sr-only">Pregame betting line: favored by 1 point, ESPN BET<\/span><span class="team-line-visible" aria-hidden="true">−1<\/span>/);
});

test("canceled, postponed and no-contest games omit a retained line from the row and details", () => {
  for (const [status, started] of [["Canceled", false], ["Postponed", false], ["No Contest", true]]) {
    for (const pregameLine of [{ favoriteId: "b", spread: 7.5, source: "ESPN" }, { favoriteId: null, spread: 0, source: "ESPN" }]) {
      const before = game({ id: "called-off", state: "upcoming", started: false, pregameLine });
      // ESPN parsing supplies no line once play or the schedule changes; retention carries the earlier one.
      const after = game({ id: "called-off", state: "other", status, started });
      const retained = retainFinalCategories(scoreboard([after]), scoreboard([before]));
      assert.deepEqual(retained.games[0].pregameLine, pregameLine, "the event keeps its betting evidence");
      const boards = fixtures(); boards.daily = retained;
      const card = render([], { boards }).html.match(/<article id="game-called-off"[\s\S]*?<\/article>/)?.[0];
      assert.match(card, new RegExp(`class="game-status status-other">${status}<`));
      const screen = screenOf("called-off", { boards });
      assert.match(screen, new RegExp(`<h2>${status}</h2>`), "status-first game screen");
      for (const out of [card, screen]) assert.doesNotMatch(out, /class="(?:team-line|pickem-line|detail-line)"|Pregame|−7\.5|>PK</);
    }
  }
});

test("shown teams display ESPN overall records without crowding the score label", () => {
  for (const state of ["upcoming", "live", "final"]) {
    const withRecords = game({ id: `records-${state}`, state, started: state !== "upcoming" });
    withRecords.teams[0].record = "3-1";
    withRecords.teams[1].record = "";
    const boards = fixtures(); boards.daily = scoreboard([withRecords]);
    const card = render([], { boards }).html.match(new RegExp(`<article id="game-records-${state}"[\\s\\S]*?<\\/article>`))?.[0];
    assert.match(card, /class="team-record" aria-hidden="true">3-1<\/span>/);
    assert.equal((card.match(/class="team-record"/g) || []).length, 1);
    assert.match(card, /aria-label="Team a, 3-1: (?:14|no score yet)"/);
    assert.match(card, /aria-label="Team b: (?:21|no score yet)"/);
  }
});

test("recovered finals leave Upsets while completed conference upsets remain", () => {
  const final = game({ id: "retained", state: "final", retainedCategories: { acc: false, top25: false, close: false, upset: true } });
  Object.assign(final.teams[0], { name: "Florida", conferenceId: "8", rank: null, score: 28 });
  Object.assign(final.teams[1], { name: "East Carolina", conferenceId: "151", rank: null, score: 21 });
  const boards = fixtures(); boards.daily = scoreboard([final]);
  const comeback = render(["upset"], { boards }).html;
  assert.deepEqual(cardIds(comeback), []);
  assert.doesNotMatch(comeback, /Earlier upset watch|Upset final|East Carolina beat Florida/);
  final.teams[0].score = 7;
  const upset = render(["upset"], { boards }).html;
  assert.match(upset, /class="compact-upset">Conference watch/);
  const screen = screenOf("retained", { boards, selection: ["upset"] });
  assert.match(screen, /class="badge upset-badge">Conference watch/);
  assert.match(screen, /East Carolina beat Florida · SEC conference watch/);
  for (const out of [upset, screen]) assert.doesNotMatch(out, /pregame favorite|No\. (null|undefined)/);
  // The recovered final's game screen has no earlier upset context either.
  final.teams[0].score = 28;
  assert.doesNotMatch(screenOf("retained", { boards }), /Earlier upset watch|Upset final|East Carolina beat Florida|class="upset-reason"/);
});

test("ORD-016/017 rendered Final puts ranked Power Four above unranked Group of Six without Virginia Tech's earlier watch", () => {
  const vt = game({ id: "vt-bc", state: "final", date: "2026-09-26T16:00:00Z",
    pregameLine: { favoriteId: "259", spread: 14.5, source: "fixture" },
    retainedCategories: { acc: true, top25: false, close: true, upset: true } });
  Object.assign(vt.teams[0], { id: "259", name: "Virginia Tech", conferenceId: "1", rank: null, score: 21 });
  Object.assign(vt.teams[1], { id: "103", name: "Boston College", conferenceId: "1", rank: null, score: 14 });
  const ranked = game({ id: "ole-miss-florida", state: "final", date: "2026-09-27T01:00:00Z" });
  Object.assign(ranked.teams[0], { name: "Ole Miss", conferenceId: "8", rank: 4, score: 28 });
  Object.assign(ranked.teams[1], { name: "Florida", conferenceId: "8", rank: 21, score: 52 });
  const group = game({ id: "hawaii-wyoming", state: "final", date: "2026-09-26T17:00:00Z",
    pregameLine: { favoriteId: "a", spread: 3, source: "fixture" } });
  Object.assign(group.teams[0], { name: "Hawai‘i", conferenceId: "17", rank: null, score: 10 });
  Object.assign(group.teams[1], { name: "Wyoming", conferenceId: "17", rank: null, score: 27 });
  const boards = fixtures(); boards.daily = scoreboard([group, vt, ranked]);
  const upsets = render(["upset"], { boards }).html;
  assert.deepEqual(cardIds(upsets), ["ole-miss-florida", "hawaii-wyoming"]);
  assert.deepEqual(upsetBadge(upsets), [0, 2]);
  assert.doesNotMatch(upsets, /Earlier upset watch|game-vt-bc/);
  const all = render([], { boards }).html;
  assert.deepEqual(cardIds(all), ["vt-bc", "ole-miss-florida", "hawaii-wyoming"]);
  const vtCard = all.match(/<article id="game-vt-bc"[\s\S]*?<\/article>/)?.[0];
  assert.ok(vtCard);
  assert.doesNotMatch(vtCard, /Earlier upset watch|Upset final|Conference watch|class="compact-upset"|class="badge upset-badge"/);
  assert.doesNotMatch(screenOf("vt-bc", { boards }), /Earlier upset watch|Upset final|Conference watch|class="badge upset-badge"|class="upset-reason"/);
});

test("Help separates selective alert policy from rank-or-line display categories", () => {
  const underdog = game({ id: "ranked-underdog", pregameLine: { favoriteId: "b", spread: 3, source: "ESPN" } });
  Object.assign(underdog.teams[0], { rank: 12, score: 17 });
  Object.assign(underdog.teams[1], { rank: 15, score: 20 });
  const boards = fixtures(); boards.daily = scoreboard([underdog]);
  const { html } = render([], { boards, showHelp: true });
  assert.deepEqual(cardIds(html), ["ranked-underdog"]);
  assert.match(html, /class="compact-upset">Upset watch/);
  const screen = screenOf("ranked-underdog", { boards });
  assert.match(screen, /class="badge upset-badge">Upset watch/);
  // The rank-based explanation moved with the game details to the game screen.
  assert.match(screen, /class="upset-reason">.*rank-based upset/);
  assert.match(html, /Phone alerts are separate from these display categories/);
  assert.match(html, /Game alerts are off when ESPN confirms both teams are unranked and from Group-of-Six conferences/);
  assert.match(html, /Selected categories do not filter notifications/);
  assert.match(html, /Upcoming games remain chronological within those pin tiers/);
  assert.match(html, /Day shows the selected Eastern date\. Week shows the current football week/);
  assert.match(html, /Each count shows that category’s games in progress, live or delayed after kickoff, then in parentheses every game it lists for the selected Day or Week, including upcoming, delayed and finished games\./);
  assert.match(html, /The first Upsets number is games brewing now; the number in parentheses adds completed games that finished as upsets/);
  assert.deepEqual(cardIds(render(["upset"], { boards }).html), ["ranked-underdog"]);
});

test("live conference watches use the same honest badge as conference finals", () => {
  const g = game({ id: "conference-live" });
  Object.assign(g.teams[0], { conferenceId: "8", rank: null, score: 7 });
  Object.assign(g.teams[1], { conferenceId: "151", rank: null, score: 21 });
  const boards = fixtures(); boards.daily = scoreboard([g]);
  const { html } = render(["upset"], { boards });
  assert.match(html, /class="compact-upset">Conference watch/);
  const screen = screenOf("conference-live", { boards, selection: ["upset"] });
  assert.match(screen, /class="badge upset-badge">Conference watch/);
  assert.match(screen, /SEC conference watch/);
  const paused = { ...g, state: "delayed", started: true };
  const final = structuredClone(g); final.state = "final"; final.teams[0].score = 35;
  boards.daily = retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(scoreboard([paused]))));
  const completed = render(["upset"], { boards }).html;
  assert.deepEqual(cardIds(completed), []);
  assert.doesNotMatch(completed, /Earlier upset watch/);
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
  assert.deepEqual(pair(delayed, "close"), [0, 0]);
  assert.deepEqual(pair(delayed, "top25"), [1, 1], "the delay after kickoff is in progress where it qualifies");
  const watched = render([], { boards, focusedGame: live.id }).html;
  assert.ok(cardIds(watched).includes(live.id));
  const pausedScreen = screenOf(live.id, { boards, focusedGame: live.id });
  assert.match(pausedScreen, /class="delay-note">Play paused\. Watching for an update\./);
  assert.match(pausedScreen, /Play is paused|You’re offline|Loading team stats/, "the stats section stays present while paused");
  assert.doesNotMatch(pausedScreen, /class="badge close-badge"/);
  const final = structuredClone(live); final.state = "final"; final.teams[1].score = 35;
  boards.daily = retainFinalCategories(scoreboard([final]), JSON.parse(JSON.stringify(paused)));
  const html = render(["close"], { boards }).html;
  assert.deepEqual(cardIds(html), [live.id]);
  assert.deepEqual(pair(html, "close"), [0, 1]);
  assert.match(screenOf(live.id, { boards, selection: ["close"] }), /class="badge close-badge">One-score watch/);
});

test("a card is a link to its game screen and the scoreboard does no stats work", () => {
  const { html } = render(["top25"], { period: "week" });
  const card = html.match(/<article id="game-top-live"[\s\S]*?<\/article>/)?.[0];
  assert.match(card, /<a class="game-summary" href="\/\?event=top-live&amp;cats=top25&amp;period=week" data-focus-key="summary"><span class="sr-only">Game details: <\/span>/);
  assert.doesNotMatch(html, /<details|<summary|game-details|stats-|view-nav|class="gamecast"|game-screen/, "no inline expansion, stats markup or work on the board");
  assert.match(html, /<div class="scores-view">/);
  assert.match(html, /<h1 class="sr-only" id="scoreboard-heading" tabindex="-1">/);
});

test("the open game screen keeps the scoreboard mounted but hidden and shows score and context in the app, with no external Gamecast link", () => {
  const g = game({ id: "screen-game", broadcast: "ACC Network", possession: "a", downDistance: "3rd & 2 at B 12", redZone: true });
  g.teams[0].record = "4-2"; g.teams[1].record = "3-3";
  const boards = fixtures(); boards.daily = scoreboard([g]);
  const { html } = render([], { boards, route: { id: "screen-game", section: "team" } });
  assert.match(html, /<div class="scores-view" hidden="">/);
  assert.deepEqual(cardIds(html), ["screen-game"], "the board stays rendered beneath");
  const screen = screenOf("screen-game", { boards });
  assert.match(screen, /aria-label="Back to scores, Sat, Aug 29"/);
  assert.match(screen, /<h1 class="game-title has-score" tabindex="-1"><span class="title-plain" aria-hidden="true">a <i>at<\/i> b<\/span><span class="title-score" aria-hidden="true">a <b>14<\/b><i>–<\/i><b>21<\/b> b<\/span><span class="sr-only">Team a at Team b<\/span><\/h1>/);
  assert.match(screen, /<p class="sr-only">Team a, 4-2, 14; No\. 20 Team b, 3-3, 21\. Team a has possession\.<\/p>/);
  assert.match(screen, /class="mh-score home leading /);
  assert.match(screen, /class="drive red-zone"><span>RED ZONE<\/span>3rd &amp; 2 at B 12/);
  // The user wants the game kept in this app: no Gamecast or other external link on the screen.
  assert.doesNotMatch(screen, /Gamecast|class="gamecast"|espn\.com|target="_blank"/);
  assert.match(screen, /<div class="game-context"><div class="badges">/);
  assert.match(screen, /aria-pressed="true">Team stats/);
  for (const forbidden of [/spread|moneyline|odds|win probability/i, /<details/]) assert.doesNotMatch(screen, forbidden);
  // The game's own Eastern calendar day leads the status line (02:30 UTC Sunday is Saturday evening in ET).
  assert.match(screen, /<div class="mh-status"><span class="mh-date">Sat, Sep 5<\/span><span class="mh-state live">/);
});

test("the game screen shows the selected game's own date in Week, and omits an invalid date rather than inventing one", () => {
  const sunday = game({ id: "sunday-game", state: "upcoming", started: false, date: "2026-09-07T00:00:00Z" });
  const monday = game({ id: "monday-game", state: "upcoming", started: false, date: "2026-09-07T23:00:00Z" });
  const boards = fixtures(); boards.week = scoreboard([sunday, monday, ...boards.week.games], "2026-09-03", { endDate: "2026-09-07" });
  for (const [id, day] of [["sunday-game", "Sun, Sep 6"], ["monday-game", "Mon, Sep 7"]]) {
    const { html } = render([], { period: "week", boards, route: { id, section: "team" } });
    const screen = html.match(/<div class="game-screen[\s\S]*<\/div><\/main>$/)?.[0];
    assert.match(screen, /aria-label="Back to scores, This week"/, "the Back context stays the generic week");
    assert.match(screen, new RegExp(`<span class="mh-date">${day}</span>`), id);
    // The same Eastern day the week card shows.
    assert.match(html.match(new RegExp(`<article id="game-${id}"[\\s\\S]*?</article>`))[0], new RegExp(`class="game-day-label">${day}<`));
  }
  const unknown = game({ id: "no-date", state: "upcoming", started: false, date: "TBD", timeValid: false });
  boards.daily = scoreboard([unknown]);
  assert.doesNotMatch(screenOf("no-date", { boards }), /mh-date|Invalid Date|NaN/);
});

test("unknown and Duke-protected games share one generic screen with no teams, score or stats", () => {
  const duke = game({ id: "duke-game" }); duke.teams[0] = { ...duke.teams[0], id: "150", name: "Duke", abbreviation: "DUKE" };
  const boards = fixtures(); boards.daily = scoreboard([duke, ...boards.daily.games]);
  const hidden = screenOf("duke-game", { boards }), unknown = screenOf("no-such-game", { boards });
  assert.ok(hidden.length > 0);
  assert.equal(hidden, unknown, "a protected game is indistinguishable from an unknown one");
  assert.doesNotMatch(hidden, /Duke|DUKE|masthead|mh-score|view-nav|panel-team|compare-table|player-table|Gamecast/);
  assert.match(hidden, /<h1 class="game-title" tabindex="-1">(?:Loading game|Game unavailable)<\/h1>/);
  assert.doesNotMatch(render([], { boards }).html, /game-duke-game/);
});

test("counts use the Duke-protected board, so a hidden Duke game is never counted", () => {
  const duke = game({ id: "duke-game" }); duke.teams[0] = { ...duke.teams[0], id: "150", name: "Duke", abbreviation: "DUKE", conferenceId: "1" };
  const boards = fixtures(); boards.daily = scoreboard([duke, ...boards.daily.games]);
  for (const focusedGame of ["", "duke-game"]) {
    const { html } = render([], { boards, focusedGame });
    assert.doesNotMatch(html, /game-duke-game/);
    // Unprotected, the live ranked ACC Duke game would make these [2, 2], [1, 1] and [2, 2].
    assert.deepEqual(pair(html, "watch"), [1, 1], focusedGame); assert.deepEqual(pair(html, "acc"), [0, 0]); assert.deepEqual(pair(html, "top25"), [1, 1]);
    assert.match(html, /aria-label="All, 1 in progress, 1 total"/); assert.match(html, /aria-label="ACC, 0 in progress, 0 total"/);
  }
});

test("issue 172: Week has Previous week, Next week and This week controls, and the current week keeps its wording", () => {
  const { html } = render(["top25"], { period: "week" });
  assert.match(html, /<button class="icon-button" aria-label="Previous week">.*?<div class="week-label">.*?<span>Sep 3 – Sep 7<\/span><span class="week-note">THU–MON<\/span><\/div><button class="icon-button" aria-label="Next week">/);
  assert.match(html, /<button class="today-button is-today">This week<\/button>/);
  assert.match(html, /Top 25 this week\./);
  assert.match(html, /href="\/\?event=top-live&amp;cats=top25&amp;period=week"/, "no week in links for the current week");
  const day = render([]).html;
  assert.doesNotMatch(day, /Previous week|Next week|This week</);
  assert.match(day, /aria-label="Previous day"/); assert.match(day, /aria-label="Next day"/);
  assert.equal((html.match(/<section class="score-content"/g) || []).length, 1, "one swipeable results region");
});

test("issue 172: a chosen other week names its range in the heading, empty states, Back labels and links", () => {
  const { html } = render(["top25"], { period: "week", weekDate: "2026-09-10" });
  assert.match(html, /<span>Sep 10 – Sep 14<\/span><span class="week-note">THU–MON<\/span>/);
  assert.match(html, /<button class="today-button ">This week<\/button>/);
  assert.match(html, /Top 25 in the week of Sep 10 – Sep 14\./);
  assert.match(html, /href="\/\?event=top-live&amp;cats=top25&amp;period=week&amp;weekDate=2026-09-10"/);
  const boards = fixtures(); boards.week.games = [];
  assert.match(render(["top25"], { period: "week", weekDate: "2026-09-10", boards }).html, /No Top 25 games in the week of Sep 10 – Sep 14\./);
  assert.match(render([], { period: "week", weekDate: "2026-09-10", boards }).html, /A quiet football week, Sep 10 – Sep 14\./);
  assert.match(render(["acc", "upset"], { period: "week", weekDate: "2026-09-10", boards }).html, /Nothing matches these categories in the week of Sep 10 – Sep 14\./);
  assert.match(render(["close"], { period: "week", weekDate: "2026-12-31", boards }).html, /No one-score games in the week of Dec 31 – Jan 4\./);
  const screen = render([], { period: "week", weekDate: "2026-09-10", route: { id: "top-live", section: "team" } }).html;
  assert.match(screen, /aria-label="Back to scores, Week of Sep 10"/);
  // Day keeps its own copy and controls; the chosen week is only carried along in links.
  const day = render(["acc"], { weekDate: "2026-09-10" }).html;
  assert.match(day, /No ACC games on this day\./); assert.match(day, /value="2026-08-29"/);
  assert.doesNotMatch(day, /Sep 10 – Sep 14|Previous week/);
});

test("issue 172: Help explains swiping, the week arrows and This week", () => {
  const { html } = render([], { showHelp: true });
  assert.match(html, /Day shows the selected Eastern date\. Week shows the current football week, Thursday through Monday, for every selected category, or the week you choose with its arrows; This week returns to the current one\./);
  assert.match(html, /swipe left across the games for the next day or week, or right for the previous one\. The arrows do the same\./);
});

// The inert pane beside the results (#172), from its opening tag to the end of the results track.
const paneOf = (html, side) => html.match(new RegExp(`<div class="pager-pane" data-side="${side}" aria-hidden="true" inert="">[\\s\\S]*?(?=<div class="pager-pane" data-side|</div></section>)`))?.[0] ?? "";
const paneCards = pane => (pane.match(/<div class="game-card /g) || []).length;

test("issue 172: a revealed neighbor is an inert, date-labeled picture of that range's own filtered games, never the current ones", () => {
  // Unranked, non-ACC and not One-score (21–0), so only All FBS lists it, like the `focused` fixture.
  const fbsOnly = game({ id: "neighbor-fbs" }); fbsOnly.teams.forEach(team => { team.rank = null; }); fbsOnly.teams[0].score = 0;
  const final = game({ id: "neighbor-final", state: "final" });
  const duke = game({ id: "neighbor-duke" }); duke.teams[0] = { ...duke.teams[0], id: "150", name: "Duke", abbreviation: "DUKE" };
  const neighbors = { "daily:2026-08-30:2026-08-30": scoreboard([game({ id: "neighbor-ranked" }), fbsOnly, final, duke], "2026-08-30") };
  const current = render([]).html;
  assert.equal(paneOf(current, 1), "", "no pane at rest");
  const { html } = render([], { pager: [1], neighbors });
  const pane = paneOf(html, 1);
  assert.match(pane, /<p class="pager-caption"><span class="pager-caption-date">Sun, Aug 30<\/span><span>2 games<\/span><\/p>/);
  assert.equal(paneCards(pane), 2, "the watchlist's ranked game and final; the unranked game and protected Duke game are left out");
  assert.doesNotMatch(pane, /id="|<a |href=|data-focus-key|role=|tabindex|DUKE/, "no IDs, links, focus targets, live regions or hidden Duke game");
  assert.deepEqual(cardIds(html), cardIds(current), "the live results are unchanged beside it");
  assert.equal((html.match(/id="game-/g) || []).length, cardIds(current).length, "no live ID is repeated");
  // The same scope, Hide finals and category filters as the results.
  assert.equal(paneCards(paneOf(render([], { pager: [1], neighbors, allFbs: true }).html, 1)), 3, "All FBS adds the unranked game");
  assert.match(paneOf(render([], { pager: [1], neighbors, hideFinals: true }).html, 1), /<span>1 game<\/span>/);
  assert.match(paneOf(render(["acc"], { pager: [1], neighbors }).html, 1), /<span>No ACC games on this day\.<\/span>[\s\S]*class="pager-empty-title">No ACC games on this day\./);
  // Unknown scores are an honest loading or unavailable state, never the current games.
  const loading = paneOf(render([], { pager: [1] }).html, 1);
  assert.match(loading, /<span class="pager-caption-date">Sun, Aug 30<\/span><span>Loading scores…<\/span>/);
  assert.equal(paneCards(loading), 0); assert.equal((loading.match(/class="loading-card"/g) || []).length, 3);
  const failed = paneOf(render([], { pager: [1], neighborFailed: true }).html, 1);
  assert.match(failed, /<span>Scores unavailable<\/span>[\s\S]*Scores are temporarily unavailable/);
  assert.equal(paneCards(failed), 0);
  // Week: the previous Thursday–Monday week, named by its dates.
  const week = paneOf(render(["top25"], { period: "week", pager: [-1], neighbors: { "week:2026-08-27:2026-08-31": scoreboard([], "2026-08-27", { endDate: "2026-08-31" }) } }).html, -1);
  assert.match(week, /<span class="pager-caption-date">Aug 27 – Aug 31<\/span><span>No Top 25 games in the week of Aug 27 – Aug 31\.<\/span>/);
});

test("issue 172: the view a committed swipe leaves is the same static picture on the side it leaves toward, without a caption", () => {
  const leaving = { label: "Sat, Aug 29", weekly: false, status: "games", games: [game({ id: "left-behind" })], title: "", description: "", upsets: false, step: 1 };
  const { html } = render([], { pager: [0, leaving] });
  const pane = paneOf(html, -1);
  assert.equal(paneCards(pane), 1); assert.doesNotMatch(pane, /pager-caption|id="|<a /);
  assert.equal(paneOf(render([], { pager: [0, { ...leaving, step: -1 }] }).html, 1).length > 0, true, "a backward swipe leaves toward the right");
});

test("restoration effect replay uses its captured snapshot after transient URL cleanup", () => {
  const effects = [], changes = [];
  render([], { effects, changes });
  const restorationEffect = effects.find(effect => effect.toString().includes('"_ss_update"'));
  assert.ok(restorationEffect, "the captured transient-update restoration effect is present");
  const original = new Map(["location", "history", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const url = new URL(`https://example.test/?_ss_update=${"b".repeat(40)}&_ss_hide_finals=1&_ss_focus=focused`);
  Object.defineProperty(globalThis, "location", { configurable: true, value: url });
  Object.defineProperty(globalThis, "history", { configurable: true, value: { state: { retained: true }, replaceState(state, title, next) { assert.deepEqual(state, { retained: true }); url.href = String(next); } } });
  // Hide finals comes only from the link. This pre-ORD-021 link has no scope, so the saved All FBS preference applies.
  const reads = [];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem(key) { reads.push(key); if (key !== "ss:all-fbs") throw Error("Restoration must not read stored preference"); return "true"; } } });
  try {
    restorationEffect(); assert.equal(url.search, ""); restorationEffect();
    // A 1.14.0 update link (no _ss_open) keeps its membership and opens that game once.
    const once = [{ slot: SLOTS.hideFinals, value: true }, { slot: SLOTS.focusedGame, value: "focused" }, { slot: SLOTS.openIntent, value: "focused" }, { slot: SLOTS.allFbs, value: true }];
    assert.deepEqual(changes, [...once, ...once]);
    assert.deepEqual(reads, ["ss:all-fbs", "ss:all-fbs"]);
  } finally { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});

test("ORD-021 an update link's explicit scope overrides the opposite saved preference and is cleaned up", () => {
  const original = new Map(["location", "history", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [scope, saved] of [["0", "true"], ["1", "false"], ["1", null]]) {
      const effects = [], changes = [];
      render([], { effects, changes });
      const restorationEffect = effects.find(effect => effect.toString().includes('"_ss_update"'));
      const url = new URL(`https://example.test/?keep=yes&_ss_update=${"b".repeat(40)}&_ss_hide_finals=0&_ss_all_fbs=${scope}&_ss_open=0`);
      Object.defineProperty(globalThis, "location", { configurable: true, value: url });
      Object.defineProperty(globalThis, "history", { configurable: true, value: { state: null, replaceState(state, title, next) { url.href = String(next); } } });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem(key) { if (key === "ss:all-fbs") throw Error(`An explicit scope must not read the saved ${saved}`); throw Error("Restoration must not read stored preference"); } } });
      restorationEffect();
      assert.deepEqual(changes.filter(change => change.slot === SLOTS.allFbs), [{ slot: SLOTS.allFbs, value: scope === "1" }], `${scope} over saved ${saved}`);
      assert.equal(url.search, "?keep=yes", "every update transient, including the scope, is removed");
    }
    // An ordinary entry (no update) reads the saved preference, off when none is saved.
    for (const [saved, expected] of [["true", true], ["false", false], [null, false]]) {
      const effects = [], changes = [];
      render([], { effects, changes });
      const restorationEffect = effects.find(effect => effect.toString().includes('"_ss_update"'));
      const url = new URL("https://example.test/?cats=acc&period=week");
      Object.defineProperty(globalThis, "location", { configurable: true, value: url });
      Object.defineProperty(globalThis, "history", { configurable: true, value: { state: null, replaceState() { throw Error("nothing to clean"); } } });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem(key) { return key === "ss:all-fbs" ? saved : null; } } });
      restorationEffect();
      assert.deepEqual(changes.filter(change => change.slot === SLOTS.allFbs), [{ slot: SLOTS.allFbs, value: expected }], String(saved));
    }
  } finally { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});

test("ORD-021 unfiltered All FBS lists every protected board game with a scope-correct heading, chip and counts", () => {
  // Day: the curated watchlist omits the unranked, non-ACC "focused" game; All FBS lists it.
  const curated = render([]).html, day = render([], { allFbs: true }).html;
  assert.deepEqual(cardIds(curated), ["daily-only"]); assert.deepEqual(cardIds(day), ["daily-only", "focused"]);
  assert.match(curated, /Your watchlist\./); assert.match(day, /id="scoreboard-heading" tabindex="-1">All FBS games\.<\/h1>/);
  assert.doesNotMatch(day, /Your watchlist/);
  assert.match(day, /class="filter-tab filter-watch" aria-pressed="true"[^>]*><span>All FBS<\/span>/);
  assert.match(curated, /class="filter-tab filter-watch" aria-pressed="true"[^>]*><span>All<\/span>/);
  assert.deepEqual(pair(day, "watch"), [2, 2]); assert.match(day, /aria-label="All FBS, 2 in progress, 2 total"/);
  assert.deepEqual(pair(curated, "watch"), [1, 1]);
  // Week: every game on the weekly board, in the shared order; Hide finals still applies.
  const week = render([], { period: "week", allFbs: true }).html, curatedWeek = render([], { period: "week" }).html;
  assert.match(week, /All FBS games this week\./);
  assert.equal(cardIds(week).length, 8); assert.equal(new Set(cardIds(week)).size, 8);
  const sections = [...week.matchAll(/<section class="score-section">(.*?)<\/section>/g)].map(match => match[1]);
  assert.deepEqual(sections.map(section => cardIds(section).length), [3, 1, 2, 1, 1], "the existing live, delayed, upcoming, schedule-update and final groups"); assert.ok(cardIds(week).includes("focused") && !cardIds(curatedWeek).includes("focused"));
  assert.deepEqual(cardIds(curatedWeek), cardIds(week).filter(id => cardIds(curatedWeek).includes(id)), "curated games keep their relative order");
  assert.deepEqual(pair(week, "watch"), [4, 8]); assert.deepEqual(pair(curatedWeek, "watch"), [3, 7]);
  const hidden = render([], { period: "week", allFbs: true, hideFinals: true }).html;
  assert.deepEqual(pair(hidden, "watch"), [4, 7]); assert.doesNotMatch(hidden, /game-top-final/);
  // Category chips keep their own counts in either scope.
  for (const category of ["acc", "top25", "close"]) assert.deepEqual(pair(week, category), pair(curatedWeek, category), category);
  assert.deepEqual(upsetBadge(week), upsetBadge(curatedWeek));
  // The checkbox: native, labeled, beside Hide finals, reflecting the displayed scope.
  assert.match(day, /<div class="scope-toggles"><label class="toggle-label"><input type="checkbox"\/><span>Hide finals<\/span><\/label><label class="toggle-label"><input type="checkbox" checked=""\/><span>All FBS games<\/span><\/label><\/div>/);
  assert.match(curated, /<label class="toggle-label"><input type="checkbox"\/><span>All FBS games<\/span><\/label>/);
  // Card links carry no scope; ordinary links follow the saved preference.
  assert.match(day, /<a class="game-summary" href="\/\?event=focused"/);
  assert.doesNotMatch(day, /href="[^"]*(?:fbs|_ss_)[^"]*"/i);
});

test("ORD-021 narrowed categories keep their own membership and copy; empty, stale and loading states stay truthful", () => {
  for (const [selection, heading] of [[["acc"], "ACC this week."], [["acc", "top25"], "ACC and Top 25 this week."], [["acc", "top25", "close", "upset"], "ACC, Top 25, One-score, and Upset watch this week."]]) {
    const scoped = render(selection, { period: "week", allFbs: true }).html, curated = render(selection, { period: "week" }).html;
    assert.deepEqual(cardIds(scoped), cardIds(curated), JSON.stringify(selection));
    assert.match(scoped, new RegExp(`>${heading.replace(/[.]/g, "\\.")}</h1>`));
    assert.deepEqual(pressed(scoped), selection);
    assert.match(scoped, /class="filter-tab filter-watch" aria-pressed="false"[^>]*><span>All FBS<\/span>/);
  }
  assert.ok(!cardIds(render(["acc", "top25", "close", "upset"], { period: "week", allFbs: true }).html).includes("focused"), "four categories are their union, not every FBS game");
  // Empty boards: scope-correct unfiltered copy; category copy unchanged.
  const empty = { ...fixtures(), daily: scoreboard([]) }, emptyWeek = { ...fixtures(), week: scoreboard([], "2026-09-03", { endDate: "2026-09-07" }) };
  const day = render([], { allFbs: true, boards: empty }).html, week = render([], { period: "week", allFbs: true, boards: emptyWeek }).html;
  assert.match(day, /No FBS games on this day\./); assert.match(day, /Choose another date to check the schedule\. New games appear automatically\./);
  assert.match(week, /No FBS games this week\./); assert.match(week, /New games appear automatically as the schedule updates\./);
  for (const html of [day, week]) { assert.doesNotMatch(html, /qualifying|Your watchlist|A quiet/); assert.deepEqual(pair(html, "watch"), [0, 0]); }
  const curatedDay = render([], { boards: empty }).html;
  assert.match(curatedDay, /A quiet scoreboard\./); assert.match(curatedDay, /New qualifying games appear automatically\./);
  const acc = render(["acc"], { allFbs: true, boards: empty }).html;
  assert.match(acc, /No ACC games on this day\./); assert.match(acc, /New qualifying games appear automatically\./);
  // Stale and loading counts stay unknown under the new label.
  const stale = render([], { allFbs: true, stale: true }).html;
  assert.match(stale, /aria-label="All FBS, counts unavailable while scores are stale"/);
  assert.match(stale, /class="filter-tab filter-watch"[^>]*><span>All FBS<\/span><span class="tab-count count-pair" aria-hidden="true">– \(–\)<\/span>/);
  assert.deepEqual(cardIds(stale), cardIds(render([], { allFbs: true }).html), "stale cards stay visible");
  assert.match(stale, /Waiting for a fresh score update/);
  const loading = render([], { allFbs: true, boards: { ...fixtures(), daily: null } }).html;
  assert.match(loading, /aria-label="All FBS, counts loading"/);
  assert.doesNotMatch(loading, /class="count-total"/);
});

test("ORD-021 a protected Duke game is neither listed nor counted under All FBS, in Day or Week", () => {
  const duke = game({ id: "duke-game", state: "upcoming", started: false, period: 0 });
  duke.teams[0] = { ...duke.teams[0], id: "150", name: "Duke", abbreviation: "DUKE", rank: null }; duke.teams[1].rank = null;
  const boards = fixtures(); boards.daily = scoreboard([duke, ...boards.daily.games]); boards.week = scoreboard([duke, ...boards.week.games], "2026-09-03", { endDate: "2026-09-07" });
  for (const [period, expected] of [["day", [2, 2]], ["week", [4, 8]]]) for (const focusedGame of ["", "duke-game"]) {
    const { html } = render([], { period, allFbs: true, boards, focusedGame });
    assert.doesNotMatch(html, /game-duke-game|DUKE/, `${period} ${focusedGame}`);
    // Unprotected, the Duke game would add one to each total.
    assert.deepEqual(pair(html, "watch"), expected, `${period} ${focusedGame}`);
  }
});

test("ORD-021 Help explains the conditional All FBS scope without promising provider completeness", () => {
  const html = render([], { showHelp: true }).html;
  assert.match(html, /All combines the four categories without repeating games\./);
  assert.match(html, /With All FBS games checked, All becomes All FBS: every game ESPN’s FBS scoreboard returns for the selected Day or Week, including games against FCS opponents, after your Duke settings and Hide finals\./);
  assert.match(html, /It adds no separate FCS coverage\./);
  assert.match(html, /This device remembers that choice; the Guide keeps its own All games and Watchlist choice\./);
  assert.match(html, /Hide finals remembers your choice on this device\./);
  assert.doesNotMatch(html, /every FBS game in existence|complete list of|all games are guaranteed/i);
});
