import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { game, scoreboard } from "./helpers.mjs";

// Exercise the real page and game cards with controlled hook data and lightweight
// UI wrappers. The catalog primitives have separate tests; no browser/feed is used.
const output = await build({
  entryPoints: ["app/page.tsx"], bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
  plugins: [{ name: "score-page-runtime", setup(build) {
    build.onResolve({ filter: /^(react(?:\/jsx-runtime)?|lucide-react|@\/components\/.*|@\/lib\/use-scoreboard)$/ }, args => ({ path: args.path, namespace: "page-test" }));
    build.onLoad({ filter: /.*/, namespace: "page-test" }, args => {
      if (args.path === "react") return { contents: "export const useState=(...a)=>globalThis.scorePageTest.useState(...a),useRef=v=>({current:v}),useEffect=()=>{};" };
      if (args.path === "react/jsx-runtime") return { contents: "export const jsx=(...a)=>globalThis.scorePageTest.jsx(...a),jsxs=(...a)=>globalThis.scorePageTest.jsxs(...a),Fragment=globalThis.scorePageTest.Fragment;" };
      if (args.path === "@/lib/use-scoreboard") return { contents: "export const useScoreboard=scope=>globalThis.scorePageTest.scoreboard(scope);" };
      if (args.path === "lucide-react") return { contents: "export const ArrowUpRight=()=>null,CalendarDays=()=>null,ChevronLeft=()=>null,ChevronRight=()=>null,CircleHelp=()=>null,CloudOff=()=>null,Radio=()=>null,RefreshCw=()=>null,Signal=()=>null,TriangleAlert=()=>null,Tv=()=>null,Zap=()=>null;" };
      return { contents: `
        const wrapper=({children})=>globalThis.scorePageTest.element('div',null,children);
        export const Tabs=wrapper,TabsList=wrapper,Empty=wrapper,EmptyHeader=wrapper,EmptyMedia=wrapper,EmptyTitle=wrapper,EmptyDescription=wrapper,Sheet=wrapper,SheetTrigger=wrapper,SheetHeader=wrapper,SheetTitle=wrapper,SheetDescription=wrapper;
        export const TabsContent=({value,children})=>value===globalThis.scorePageTest.filter?wrapper({children}):null;
        export const TabsTrigger=({value,children})=>globalThis.scorePageTest.element('button',{'data-tab':value},children);
        export const SheetContent=()=>null,Skeleton=()=>null,Alerts=()=>null;
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
    acc: scoreboard([acc], "2026-09-03", { endDate: "2026-09-07" }),
    top25: scoreboard([...games, rankedAcc, focused], "2026-09-03", { endDate: "2026-09-07" }),
  };
}

function render(filter, { hideFinals = false, focusedGame = "", boards = fixtures() } = {}) {
  let state = 0, selectedScope;
  globalThis.scorePageTest = {
    ...jsxRuntime, filter, element: React.createElement,
    useState(initial) { return [[filter, hideFinals, focusedGame][state++] ?? initial, () => {}]; },
    scoreboard(scope) { selectedScope = scope; return { date: "2026-08-29", today: "2026-09-05", boards, data: boards[scope], error: "", refreshing: false, online: true, now: Date.now(), timezone: "EDT", refresh() {}, setDate() {}, followToday: true }; },
  };
  try { return { html: renderToStaticMarkup(React.createElement(Home)), scope: selectedScope }; }
  finally { delete globalThis.scorePageTest; }
}

function cardIds(html) { return [...html.matchAll(/<article id="game-([^"]+)"/g)].map(match => match[1]); }
function badge(html, filter) { return Number(new RegExp(`data-tab="${filter}"[^>]*>.*?<span class="tab-count">(\\d+)</span>`).exec(html)?.[1]); }

test("Top 25 renders its weekly sections, future non-ACC and ACC games, dates, and matching count", () => {
  const { html, scope } = render("top25");
  assert.equal(scope, "top25");
  assert.match(html, /Top 25 this week/); assert.match(html, /THU–MON · ET/);
  assert.doesNotMatch(html, /Scoreboard date, Eastern time|overnight-note/);
  const sections = [...html.matchAll(/<section class="score-section">(.*?)<\/section>/g)].map(match => match[1]);
  assert.equal(sections.length, 5);
  for (const [i, title] of ["On now", "Delayed", "Coming up", "Schedule updates", "Final"].entries()) assert.ok(sections[i].includes(title));
  assert.deepEqual(cardIds(sections[2]), ["ranked-acc", "top-upcoming"]);
  assert.match(sections[2], /class="game-day-label">Mon, Sep 7/);
  assert.deepEqual(cardIds(html), ["top-live", "top-delayed", "ranked-acc", "top-upcoming", "top-other", "top-final"]);
  assert.equal(badge(html, "top25"), cardIds(html).length);
  assert.equal(badge(html, "watch"), 1); assert.equal(badge(html, "acc"), 1);
});

test("Hide finals removes the Top 25 final section and adjusts the weekly count", () => {
  const { html } = render("top25", { hideFinals: true });
  assert.equal(badge(html, "top25"), 5); assert.equal(cardIds(html).length, 5);
  assert.doesNotMatch(html, /game-top-final|<h2>Final<\/h2>/); assert.match(html, /Coming up/);
});

test("daily views keep manual date navigation and focused games while weekly views stay separate", () => {
  const watch = render("watch", { focusedGame: "focused" });
  assert.equal(watch.scope, "daily");
  assert.deepEqual(cardIds(watch.html), ["daily-only", "focused"]); assert.equal(badge(watch.html, "watch"), 2);
  assert.match(watch.html, /value="2026-08-29"/); assert.match(watch.html, /overnight-note/);
  assert.doesNotMatch(watch.html, /game-day-label|THU–MON/);
  for (const filter of ["close", "upset"]) {
    const daily = render(filter); assert.equal(daily.scope, "daily");
    assert.deepEqual(cardIds(daily.html), ["daily-only"]);
  }
  const top25 = render("top25", { focusedGame: "focused" }); assert.ok(!cardIds(top25.html).includes("focused"));
  const acc = render("acc"); assert.equal(acc.scope, "acc"); assert.deepEqual(cardIds(acc.html), ["acc-only"]);
  assert.match(acc.html, /THU–MON/); assert.doesNotMatch(acc.html, /overnight-note/);
});

test("empty weekly Top 25 copy explains the weekly scope without offering hidden daily controls", () => {
  const boards = fixtures(); boards.top25.games = [];
  const { html } = render("top25", { boards });
  assert.match(html, /No Top 25 games this week/);
  assert.doesNotMatch(html, /Choose another date/); assert.equal(badge(html, "top25"), 0);
});
