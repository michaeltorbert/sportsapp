import { readFileSync } from "node:fs";
import { test, expect, event, NOW, ALERT_ORIGIN } from "./fixtures.mjs";
import { bundle } from "../helpers.mjs";

// Team seasons (issue #166). /api/team answers are the real Worker service's output for the
// minimized genuine captures (fixtures/team-season-provenance.json), built here in Node and served
// through the intercepted same-origin route; real upstream is checked separately (docs/team-season.md).
const { createTeamSeasonService, teamScheduleUrl, teamStatsUrl } = await bundle("lib/team-season-server.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/espn-team-season-${name}.json`, import.meta.url), "utf8"));
const DUKE = fixture("duke-2026"), UNC = fixture("unc-2026");
const json = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const routes = {
  [teamScheduleUrl("150")]: DUKE.default, [teamScheduleUrl("150", { year: 2026, type: 3 })]: DUKE.postseason, [teamStatsUrl("150", 2026)]: DUKE.stats,
  // UNC's postseason was not captured, so it is genuinely unavailable here: its page shows incomplete coverage.
  [teamScheduleUrl("153")]: UNC.schedule, [teamStatsUrl("153", 2026)]: UNC.stats,
};
const service = createTeamSeasonService(async url => routes[url] ? json(routes[url]) : new Response("{}", { status: 503 }), () => Date.parse(NOW) - 5000);
const SEASONS = { 150: (await service.get("150")).season, 153: (await service.get("153")).season };
const TULANE_GAME = "401858209", SHARED = "401858266";
const tulaneId = DUKE.regular.events[0].competitions[0].competitors.find(c => c.team.id !== "150").team.id;
// A Duke game on no other captured schedule and outside the board's dates.
const DUKE_ONLY = SEASONS[150].regular.entries.find(e => e.game.state === "upcoming" && !SEASONS[153].regular.entries.some(u => u.game.id === e.game.id)).game.id;

function serveTeams(harness) {
  harness.state.team = (url, route) => {
    const season = SEASONS[url.searchParams.get("team")];
    return season ? route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(season) })
      : route.fulfill({ status: 502, contentType: "application/json", headers: { "Retry-After": "30" }, body: "{}" });
  };
}
// The genuine Tulane at Duke final on the board for Saturday, September 5.
function board(harness) {
  const e = event(TULANE_GAME, { state: "final", scores: [3, 17], date: "2026-09-05T19:30:00Z" });
  const [away, home] = e.competitions[0].competitors;
  Object.assign(away, { id: tulaneId }); Object.assign(away.team, { id: tulaneId, shortDisplayName: "Tulane", abbreviation: "TULN" });
  // Duke is an ACC team (the capture's team.groups.id "1"), which is why the default All view lists this final.
  Object.assign(home, { id: "150" }); Object.assign(home.team, { id: "150", shortDisplayName: "Duke", abbreviation: "DUKE", conferenceId: "1" });
  e.competitions[0].neutralSite = false;
  harness.state.events = [...harness.state.events, e];
}
const gameScreen = page => page.locator(".game-screen:not(.team-screen)");
const teamScreen = page => page.locator(".team-screen");
const scores = page => page.locator(".scores-view");
const scrollY = page => page.evaluate(() => Math.round(scrollY));
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const params = page => Object.fromEntries(new URL(page.url()).searchParams);
const entry = page => page.evaluate(() => history.state?.ss ?? null);
function recordNavigation(page) {
  const seen = [];
  page.on("request", request => { const url = new URL(request.url()); if (request.resourceType() === "document" || url.pathname.endsWith(".rsc") || request.headers().rsc === "1") seen.push(`${request.resourceType()} ${url.pathname}${url.search}`); });
  return seen;
}
// After load, vinext's Link shim (node_modules/vinext/dist/shims/link.js) prefetches each visible framework
// Link's RSC payload once, on idle: here the Scores wordmark/nav link and Guide link (/.rsc, /guide.rsc).
// That startup prefetch is not a navigation, so it must finish before the no-navigation record starts, as
// tests/browser/game-screen.spec.mjs does. Every RSC or document request after that still counts.
function trackFinished(page) {
  const finished = [];
  page.on("requestfinished", request => finished.push(new URL(request.url())));
  return finished;
}
async function settleStartupPrefetches(page, finished) {
  const expected = await page.evaluate(() => {
    if (!window.__VINEXT_LINK_PREFETCH_ROUTES__) return [];
    return [...new Set([...document.querySelectorAll(".app-header a.wordmark, .destination-nav a")].filter(a => {
      const box = a.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom >= -250 && box.top <= innerHeight + 250 && box.right >= -250 && box.left <= innerWidth + 250;
    }).map(a => { const url = new URL(a.href); return `${url.pathname === "/" ? "/.rsc" : `${url.pathname}.rsc`}${url.search}`; }))];
  });
  const done = path => finished.some(url => { const search = new URLSearchParams(url.search); search.delete("_rsc"); const q = search.toString(); return `${url.pathname}${q ? `?${q}` : ""}` === path; });
  await expect.poll(() => expected.filter(path => !done(path)), "startup Link prefetches finished before recording").toEqual([]);
  return expected;
}

test("board → game → team → schedule game: in-app links, owned Back and Forward with focus and scroll, and no framework navigation", async ({ page, harness }, info) => {
  serveTeams(harness); board(harness);
  await page.setViewportSize({ width: 393, height: 852 });
  const finished = trackFinished(page);
  await harness.open();
  expect(harness.state.teamRequests, "the scoreboard does no team work").toEqual([]);
  await page.evaluate(() => { window.__main = document.querySelector("main"); });
  await info.attach("startup-prefetches", { contentType: "application/json", body: JSON.stringify(await settleStartupPrefetches(page, finished)) });
  const navigation = recordNavigation(page);
  await page.locator(`#game-${TULANE_GAME} a.game-summary`).tap();
  await expect(gameScreen(page)).toBeVisible();
  const nav = gameScreen(page).getByRole("navigation", { name: "Team seasons" });
  await expect(nav.getByRole("link")).toHaveText(["Tulane", "Duke"]);
  await expect(nav.getByRole("link", { name: "Duke season and schedule" })).toHaveAttribute("href", "/?team=150");
  for (const link of await nav.getByRole("link").all()) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await nav.evaluate(el => !!el.closest('[aria-hidden="true"]'))).toBe(false);
  expect(harness.state.teamRequests, "opening a game does no team work").toEqual([]);
  await page.screenshot({ path: info.outputPath("game-team-links-393.png"), animations: "disabled" });

  await nav.getByRole("link", { name: "Duke season and schedule" }).tap();
  await expect(teamScreen(page)).toBeVisible(); await expect(scores(page)).toBeHidden();
  expect(params(page)).toEqual({ team: "150" });
  await expect(teamScreen(page).locator("h1.team-title")).toHaveText("Duke Blue Devils");
  await expect(teamScreen(page).locator("h1.team-title")).toBeFocused();
  await expect(teamScreen(page).locator(".team-meta")).toContainText("2026 season");
  await expect(teamScreen(page).locator(".team-meta")).toContainText("Record 4–2");
  await expect(teamScreen(page).locator(".team-averages tbody tr")).toHaveCount(4);
  await expect(teamScreen(page).getByRole("row", { name: /Points/ })).toContainText("31.7");
  await expect(teamScreen(page).locator("a.sched-row")).toHaveCount(12);
  await expect(teamScreen(page).getByText("No postseason games are listed yet.")).toBeVisible();
  await expect(teamScreen(page).getByRole("button", { name: "Back to game, Tulane at Duke" })).toBeVisible();
  expect(await entry(page)).toMatchObject({ kind: "team", team: "150", from: true, origin: TULANE_GAME });
  expect(harness.state.teamRequests).toEqual(["?team=150"]);

  const row = teamScreen(page).locator(`[data-focus-key="sched-${SHARED}"]`);
  await row.scrollIntoViewIfNeeded();
  const left = await scrollY(page);
  await row.tap();
  await expect(gameScreen(page)).toBeVisible(); await expect(teamScreen(page)).toHaveCount(0);
  expect(params(page)).toEqual({ event: SHARED, team: "150" });
  await expect(gameScreen(page).locator("h1.game-title")).toBeFocused();
  await expect(gameScreen(page).locator(".schedule-source")).toContainText("From the Duke schedule, checked");
  await expect(gameScreen(page).getByRole("button", { name: "Back to Duke schedule" })).toBeVisible();
  await expect(gameScreen(page).locator(".game-bar .back-text")).toHaveText("DukeSchedule");
  // A team schedule never offers an external Gamecast; the only links are team pages.
  for (const href of await gameScreen(page).getByRole("link").evaluateAll(as => as.map(a => a.getAttribute("href")))) expect(href).toMatch(/^\/\?team=\d+$/);

  // Browser Back and Forward traverse the genuine screens, restoring focus and scroll.
  await page.goBack();
  await expect(teamScreen(page)).toBeVisible();
  await expect(row).toBeFocused();
  await expect.poll(async () => Math.abs((await scrollY(page)) - left)).toBeLessThanOrEqual(2);
  await page.goBack();
  await expect(gameScreen(page).locator("h1.game-title")).toBeFocused();
  expect(params(page)).toEqual({ event: TULANE_GAME });
  await page.goBack();
  await expect(scores(page)).toBeVisible();
  await expect(page.locator(`#game-${TULANE_GAME} a.game-summary`)).toBeFocused();
  for (let i = 0; i < 3; i++) await page.goForward();
  await expect(gameScreen(page)).toBeVisible();
  expect(params(page)).toEqual({ event: SHARED, team: "150" });
  // On-screen Back follows the same entries.
  await gameScreen(page).getByRole("button", { name: "Back to Duke schedule" }).tap();
  await expect(teamScreen(page)).toBeVisible();
  await teamScreen(page).getByRole("button", { name: "Back to game, Tulane at Duke" }).tap();
  await expect(gameScreen(page)).toBeVisible();
  await gameScreen(page).getByRole("button", { name: /^Back to scores/ }).tap();
  await expect(scores(page)).toBeVisible();
  expect(navigation, "owned traversals make no RSC or document request").toEqual([]);
  expect(await page.evaluate(() => window.__main === document.querySelector("main"))).toBe(true);
});

test("a schedule game opened directly or reloaded is found only in its team's checked schedule; Back returns to the team, then Scores", async ({ page, harness }) => {
  serveTeams(harness);
  await harness.open({ path: `/?event=${DUKE_ONLY}&team=150`, waitForScores: false });
  await expect(gameScreen(page).locator(".masthead")).toBeVisible();
  await expect(gameScreen(page).locator(".schedule-source")).toContainText("From the Duke schedule");
  expect(await entry(page)).toMatchObject({ kind: "game", id: DUKE_ONLY, team: "150", from: false });
  await page.reload();
  await expect(gameScreen(page).locator(".masthead")).toBeVisible();
  const length = await page.evaluate(() => history.length);
  await gameScreen(page).getByRole("button", { name: "Back to Duke schedule" }).tap();
  await expect(teamScreen(page)).toBeVisible();
  expect(params(page)).toEqual({ team: "150" });
  expect(await entry(page)).toMatchObject({ kind: "team", team: "150", from: false });
  await expect(teamScreen(page).locator(`[data-focus-key="sched-${DUKE_ONLY}"]`)).toBeFocused();
  await teamScreen(page).getByRole("button", { name: /^Back to scores/ }).tap();
  await expect(scores(page)).toBeVisible();
  await expect(page.locator("#scoreboard-heading")).toBeFocused();
  expect(await page.evaluate(() => history.length), "fallbacks replace; they never leave the app").toBe(length);
});

test("a team URL opened directly works from the URL alone", async ({ page, harness }) => {
  serveTeams(harness);
  await harness.open({ path: "/?team=150", waitForScores: false });
  await expect(teamScreen(page).locator("h1.team-title")).toHaveText("Duke Blue Devils");
  expect(await entry(page)).toMatchObject({ kind: "team", team: "150", from: false });
});

test("a schedule game outside the context team's membership is unavailable", async ({ page, harness }) => {
  serveTeams(harness);
  await harness.open({ path: `/?event=${DUKE_ONLY}&team=153`, waitForScores: false });
  await expect(gameScreen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  await expect(gameScreen(page).locator(".masthead")).toHaveCount(0);
});

test("an unknown schedule game is unavailable", async ({ page, harness }) => {
  serveTeams(harness);
  await harness.open({ path: "/?event=401999999&team=150", waitForScores: false });
  await expect(gameScreen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
});

test("a malformed team URL is no team page and makes no team request", async ({ page, harness }) => {
  serveTeams(harness);
  const requests = harness.state.teamRequests.length;
  await harness.open({ path: "/?team=abc" });
  await expect(page.getByRole("button", { name: "Refresh scores" })).toBeEnabled();
  await expect(teamScreen(page)).toHaveCount(0);
  expect(harness.state.teamRequests).toHaveLength(requests);
});

// A genuinely new page (tab) in the same context. Its own interception is installed on the context
// before the page exists, so every request is answered or blocked before the network: the team API,
// direct and hosted scores, stats, alerts and its config, ESPN data and logo hosts. Only the app's
// own documents and assets reach the local Worker.
async function newTab(context, appOrigin, { teamRequests, blocked, unexpected }) {
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    const fulfill = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store", ...headers }, body: JSON.stringify(body) });
    if (url.origin === ALERT_ORIGIN) { blocked.push(`${req.method()} ${url.origin}${url.pathname}`); return fulfill({ error: "simulated alerts unavailable" }, 503); }
    if (["espn.com", "espncdn.com"].some(base => url.hostname === base || url.hostname.endsWith(`.${base}`))) { blocked.push(`${req.method()} ${url.hostname}${url.pathname}`); return route.abort("blockedbyclient"); }
    if (url.origin !== appOrigin) { unexpected.push(req.url()); return route.abort("blockedbyclient"); }
    if (url.pathname === "/alerts-config.json") return fulfill({ serviceUrl: ALERT_ORIGIN });
    if (url.pathname === "/api/scores") return fulfill({ error: "simulated feed unavailable" }, 503);
    if (url.pathname === "/api/stats") return fulfill({ error: "simulated stats unavailable" }, 503, { "Retry-After": "300" });
    if (url.pathname === "/api/team") {
      teamRequests.push(url.search);
      const season = SEASONS[url.searchParams.get("team")];
      return season ? fulfill(season) : fulfill({}, 502, { "Retry-After": "30" });
    }
    return route.continue();
  });
  const tab = await context.newPage();
  // Test-scoped silence, as the harness gives its page; verified on a blank document before the app loads.
  await tab.addInitScript(() => {
    window.__testMuted = true;
    for (const type of ["loadstart", "play"]) addEventListener(type, e => { if (e.target instanceof HTMLMediaElement) e.target.muted = true; }, true);
  });
  await tab.goto("about:blank");
  expect(await tab.evaluate(() => window.__testMuted === true), "test-scoped mute installed before navigation").toBe(true);
  return tab;
}

test("a schedule game URL opened in a genuinely new tab recovers its validated membership there; Back reaches the team, then Scores", async ({ page, harness, context }, info) => {
  serveTeams(harness); board(harness);
  await page.setViewportSize({ width: 393, height: 852 });
  await harness.open();
  // The URL the app itself generates for the row.
  await page.locator(`#game-${TULANE_GAME} a.game-summary`).tap();
  await gameScreen(page).getByRole("link", { name: "Duke season and schedule" }).tap();
  const row = teamScreen(page).locator(`[data-focus-key="sched-401858271"]`);
  await expect(row).toBeVisible();
  const href = await row.getAttribute("href");
  expect(href).toBe("/?event=401858271&team=150");
  const seen = { teamRequests: [], blocked: [], unexpected: [] };
  const tab = await newTab(context, new URL(info.project.use.baseURL).origin, seen);
  const errors = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.setViewportSize({ width: 375, height: 812 });
  await tab.goto(href);
  const game = tab.locator(".game-screen:not(.team-screen)");
  await expect(game.locator(".masthead")).toBeVisible();
  await expect(game.locator("h1.game-title")).toContainText("DUKE");
  await expect(game.locator(".schedule-source")).toContainText("From the Duke schedule, checked");
  expect(seen.teamRequests).toEqual(["?team=150"]);
  expect(await tab.evaluate(() => history.state?.ss ?? null)).toMatchObject({ kind: "game", id: "401858271", team: "150", from: false });
  await tab.screenshot({ path: info.outputPath("new-tab-schedule-game-375.png"), fullPage: true, animations: "disabled" });
  await game.getByRole("button", { name: "Back to Duke schedule" }).tap();
  await expect(tab.locator(".team-screen h1.team-title")).toHaveText("Duke Blue Devils");
  await expect(tab.locator(`.team-screen [data-focus-key="sched-401858271"]`)).toBeFocused();
  await tab.locator(".team-screen").getByRole("button", { name: /^Back to scores/ }).tap();
  await expect(tab.locator(".scores-view")).toBeVisible();
  expect(seen.unexpected, "no unintercepted external request from the new tab").toEqual([]);
  expect(errors).toEqual([]);
  await info.attach("new-tab-requests", { contentType: "application/json", body: JSON.stringify(seen, null, 2) });
  await tab.close();
  await context.unroute("**/*");
  // The original tab is unaffected.
  await expect(teamScreen(page).locator("h1.team-title")).toHaveText("Duke Blue Devils");
});

test("hiding a Duke game conceals its row and withholds the record and averages on Duke's page and its opponent's", async ({ page, harness }, info) => {
  serveTeams(harness);
  await page.setViewportSize({ width: 375, height: 812 });
  await harness.open({ path: "/?team=150", waitForScores: false });
  await expect(teamScreen(page).locator(".team-averages")).toBeVisible();
  const hide = id => page.evaluate(id => {
    const key = "ss:duke-visibility:v2", stored = JSON.parse(localStorage.getItem(key)) ?? { version: 2, rules: [{ from: 0, mode: "away" }], manual: {}, remembered: {}, waiting: {} };
    const value = JSON.stringify({ ...stored, manual: { ...stored.manual, [id]: true } });
    localStorage.setItem(key, value); dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }, id);
  await hide(TULANE_GAME);
  await expect(teamScreen(page).getByText("Record and season statistics hidden")).toBeVisible();
  await expect(teamScreen(page).locator(".team-averages")).toHaveCount(0);
  await expect(teamScreen(page)).not.toContainText("Tulane");
  await expect(teamScreen(page).locator(".team-meta")).toHaveText(/2026 season\s*·\s*Record hidden/);
  await expect(teamScreen(page).locator(`[data-focus-key="sched-${TULANE_GAME}"]`)).toHaveCount(0);
  await expect(teamScreen(page).locator("a.sched-row")).toHaveCount(11);
  await page.screenshot({ path: info.outputPath("team-150-duke-game-hidden-375.png"), fullPage: true, animations: "disabled" });
  // Its own screen, reached by URL, is the generic unavailable one.
  await page.goto(`/?event=${TULANE_GAME}&team=150`);
  await expect(gameScreen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  await expect(gameScreen(page)).not.toContainText(/Tulane|TULN/);
  // The opponent's page conceals the shared game once hidden; with no other gap it would show its own
  // aggregates, but UNC's postseason wasn't captured, so they wait for complete coverage.
  await page.goto("/?team=153");
  await expect(teamScreen(page).locator("h1.team-title")).toHaveText("North Carolina Tar Heels");
  await expect(teamScreen(page).getByText("Record and season statistics not shown yet")).toBeVisible();
  await expect(teamScreen(page).locator(`[data-focus-key="sched-${SHARED}"]`)).toBeVisible();
  await page.screenshot({ path: info.outputPath("team-153-partial-375.png"), fullPage: true, animations: "disabled" });
  await hide(SHARED);
  await expect(teamScreen(page).locator(`[data-focus-key="sched-${SHARED}"]`)).toHaveCount(0);
  await expect(teamScreen(page).getByText("Duke game hidden by your settings")).toBeVisible();
  await page.screenshot({ path: info.outputPath("team-153-partial-duke-game-hidden-375.png"), fullPage: true, animations: "disabled" });
});

test("an unavailable team says so, offers Retry and returns to Scores", async ({ page, harness }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await harness.open({ path: "/?team=150", waitForScores: false });
  await expect(teamScreen(page).getByRole("heading", { name: "This team isn’t available" })).toBeVisible();
  expect(harness.state.teamRequests).toEqual(["?team=150"]);
  await page.screenshot({ path: info.outputPath("team-unavailable-375.png"), fullPage: true, animations: "disabled" });
  await teamScreen(page).getByRole("button", { name: "Back to scores", exact: true }).tap();
  await expect(scores(page)).toBeVisible();
});

// The painted text boxes (line boxes) of each displayed element, for separation checks on actual layout.
// A Range over an element also reports glyph boxes of descendants that are never painted: visually hidden
// accessible text (.sr-only) lays out its glyphs at full size inside a clipped 1px box. Such text is
// excluded by its actual clipping (an ancestor clipped to at most 1px, or a clip/clip-path), not by class.
// Every other visible glyph is measured, aria-hidden or not. Undisplayed elements have no boxes.
const textBoxes = locator => locator.evaluateAll(els => els.filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden").map(el => {
  const unpainted = node => {
    for (let a = node.parentElement; a; a = a === el ? null : a.parentElement) {
      const style = getComputedStyle(a), box = a.getBoundingClientRect();
      if ((style.clip !== "auto" && style.clip !== "") || style.clipPath !== "none" || ((box.width <= 1 || box.height <= 1) && style.overflow !== "visible")) return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), rects = [], painted = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim() || unpainted(node)) continue;
    painted.push(node.data);
    const range = document.createRange(); range.selectNodeContents(node);
    rects.push(...[...range.getClientRects()].filter(b => b.width > 1 && b.height > 1).map(b => ({ l: b.left, r: b.right, t: b.top, b: b.bottom })));
  }
  return { text: el.textContent.trim(), painted: painted.join("").replace(/\s+/g, " ").trim(), rects };
}));
function overlaps(items) {
  const found = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++)
    if (items[i].rects.some(a => items[j].rects.some(b => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5))) found.push([items[i].painted, items[j].painted]);
  return found;
}
const ZOOM = "html { zoom: 2; }";
const WIDE_FONT = "*, *::before, *::after { font-family: Verdana, 'DejaVu Sans', sans-serif !important; }";
for (const [width, height, zoom, wide] of [[375, 812, false], [1440, 1000, false], [375, 812, true], [375, 812, true, true]]) {
  test(`the team page reads without page overflow at ${width}×${height}${zoom ? " with actual 200% CSS zoom" : ""}${wide ? " and wide fallback fonts" : ""}`, async ({ page, harness }, info) => {
    serveTeams(harness);
    await page.setViewportSize({ width, height });
    await harness.open({ path: "/?team=150", waitForScores: false });
    if (zoom) await page.addStyleTag({ content: ZOOM + (wide ? WIDE_FONT : "") });
    await expect(teamScreen(page).locator("a.sched-row")).toHaveCount(12);
    // The harness answers the fixture's logo with an HTTP 503 before the network: a real image error, so the
    // product's own onError fallback shows the abbreviation in every engine.
    await expect(teamScreen(page).locator(".team-head .mh-logo")).toHaveText("DUKE");
    expect(harness.state.logoRequests).toContain("/i/teamlogos/ncaa/500/150.png");
    // The whole prepared page is captured before any layout assertion, so a failure leaves its full pixels.
    await page.screenshot({ path: info.outputPath(`team-${width}x${height}${zoom ? "-zoom200" : ""}${wide ? "-wide" : ""}.png`), fullPage: true, animations: "disabled" });
    expect(await noOverflow(page)).toBe(true);
    // Every control is at least 44 CSS px tall; full names wrap inside their row.
    const small = await teamScreen(page).locator("a, button").evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44).map(el => el.outerHTML.slice(0, 80)));
    expect(small).toEqual([]);
    const clipped = await teamScreen(page).locator(".s-name, .team-title").evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).length);
    expect(clipped).toBe(0);
    // All eight averages are shown, each on one line, and no figure or label touches another: the table where
    // its columns fit, otherwise the labeled list (200% zoom). Exactly one of the two is displayed.
    await expect(teamScreen(page).locator(zoom ? ".team-averages-list" : ".team-averages")).toBeVisible();
    await expect(teamScreen(page).locator(zoom ? ".team-averages" : ".team-averages-list")).toBeHidden();
    const values = await textBoxes(teamScreen(page).locator(".team-averages td, .avg-stat dd b"));
    expect(values.map(v => v.text)).toEqual(["31.7", "16.0", "442.7", "292.7", "233.2", "200.2", "209.5", "92.5"]);
    for (const value of values) expect(value.rects.length, `${value.text} on one line`).toBe(1);
    expect(overlaps([...values, ...await textBoxes(teamScreen(page).locator(".team-averages th, .avg-stat dt, .avg-side"))])).toEqual([]);
    // The real upcoming Next game with TV: date, time, Next, TV and the full name never touch.
    const next = teamScreen(page).locator("a.sched-row:has(.s-next)");
    await expect(next).toHaveCount(1);
    await expect(next.locator(".s-tv")).toHaveCount(1);
    const parts = await textBoxes(next.locator(".s-date, .s-time, .s-next, .s-tv, .s-ha, .s-name"));
    expect(parts.length).toBe(6);
    // Each part really paints text (the TV's spoken "on" prefix is visually hidden; its network name is not).
    for (const part of parts) expect(part.painted, part.text).not.toBe("");
    expect(parts.find(part => part.text.startsWith("on ")).painted).not.toMatch(/^on /);
    expect(overlaps(parts)).toEqual([]);
    // Full names keep meaningful width: no word of any opponent's name is broken across lines.
    const broken = await teamScreen(page).locator(".s-name").evaluateAll(els => els.flatMap(el => {
      const node = el.firstChild, out = [];
      if (node?.nodeType !== Node.TEXT_NODE) return out;
      for (const m of node.data.matchAll(/\S+/g)) {
        const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
        if (new Set([...range.getClientRects()].filter(b => b.width > 1).map(b => Math.round(b.top))).size > 1) out.push(`${node.data}: ${m[0]}`);
      }
      return out;
    }));
    expect(broken).toEqual([]);
    // The bar's redundant abbreviation is one line or omitted, never stacked letter by letter.
    const bar = await teamScreen(page).locator(".team-bar-title").evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      return { hidden: getComputedStyle(el).visibility === "hidden", lines: new Set([...range.getClientRects()].filter(b => b.width > 1).map(b => Math.round(b.top))).size };
    });
    expect(bar.hidden || bar.lines <= 1, JSON.stringify(bar)).toBe(true);
    const [side, main] = await Promise.all([".team-side", ".team-main"].map(s => teamScreen(page).locator(s).boundingBox()));
    if (width >= 1440 && !zoom) expect(main.x, "two columns on a wide screen").toBeGreaterThan(side.x + side.width);
    else expect(main.y, "one column on a phone or with large text").toBeGreaterThanOrEqual(side.y + side.height - 1);
  });
}

// #181 leaders slice: Minimized CFBD YDS captures; all state variations below are SYNTHETIC.
const { createLeadersSnapshot } = await bundle("lib/cfbd-season-leaders.ts");
const TEXAS_BASE = JSON.parse(readFileSync(new URL("../fixtures/espn-team-season-texas-2026-normalized.json", import.meta.url), "utf8"));
const cfbdFixture = name => JSON.parse(readFileSync(new URL(`../fixtures/cfbd-${name}.json`, import.meta.url), "utf8"));
const CFBD = createLeadersSnapshot(cfbdFixture("03-fbs-identities"), ["11-national-passing", "12-national-rushing", "13-national-receiving"].map(cfbdFixture), "2026-10-23T01:05:44.000Z");
const TEXAS_SEASON = { ...TEXAS_BASE, leaders: { ...CFBD.teams["251"].leaders, checkedAt: CFBD.checkedAt, stale: false } };
async function verifyFixtureMute(page) {
  // Verify the fixture's real media mute listener before any UI interaction; do not play audio.
  expect(await page.evaluate(() => { const audio = document.createElement("audio"); document.body.append(audio); audio.dispatchEvent(new Event("loadstart", { bubbles: true })); const muted = audio.muted; audio.remove(); return muted; })).toBe(true);
}
function serveCandidate(harness, getSeason) {
  harness.state.team = (_url, route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(getSeason()) });
}
for (const [width, zoom] of [[320, false], [390, false], [390, true], [1440, false]]) {
  test(`three full-name Texas leaders above averages at ${width}px${zoom ? " and 200% zoom" : ""}`, async ({ page, harness }, info) => {
    serveCandidate(harness, () => TEXAS_SEASON);
    await page.setViewportSize({ width, height: 900 });
    await harness.open({ path: "/?team=251", waitForScores: false });
    await verifyFixtureMute(page);
    if (zoom) await page.addStyleTag({ content: ZOOM });
    await expect(teamScreen(page).locator(".team-leader-name")).toHaveText(["Arch Manning", "Daylan Smothers", "Ryan Wingo"]);
    await expect(teamScreen(page).locator(".team-leader-row dd strong")).toHaveText(["1,298", "289", "345"]);
    await expect(teamScreen(page).locator(".team-leader-row dd span")).toHaveText(["total yards", "total yards", "total yards"]);
    await expect(teamScreen(page).locator(".team-leaders-heading")).toContainText("Regular season");
    await expect(teamScreen(page).locator("a.sched-row")).toHaveCount(12);
    expect(await noOverflow(page)).toBe(true);
    const leader = await teamScreen(page).locator(".team-leaders").boundingBox(), avg = await teamScreen(page).locator('[aria-labelledby="team-averages-h"]').boundingBox();
    expect(leader.y + leader.height).toBeLessThanOrEqual(avg.y + 1);
    expect(overlaps(await textBoxes(teamScreen(page).locator(".team-leader-name, .team-leader-row dd, .team-leader-category")))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`leaders-texas-${width}${zoom ? "-zoom200" : ""}.png`), fullPage: true, animations: "disabled" });
    // The existing schedule route remains a real in-app game, then returns to this team.
    await teamScreen(page).locator("a.sched-row").first().click();
    await expect(gameScreen(page)).toBeVisible();
    await gameScreen(page).getByRole("button", { name: "Back to Texas schedule" }).click();
    await expect(teamScreen(page).locator(".team-leader-name").first()).toHaveText("Arch Manning");
  });
}
test("partial/stale leader data is honest and Retry restores only missing content", async ({ page, harness }, info) => {
  let candidate = { ...TEXAS_SEASON, stale: true, leaders: { ...TEXAS_SEASON.leaders, rushingYards: null } };
  serveCandidate(harness, () => candidate);
  await page.setViewportSize({ width: 320, height: 900 });
  await harness.open({ path: "/?team=251", waitForScores: false });
  await verifyFixtureMute(page);
  await expect(teamScreen(page).locator(".team-leader-name")).toHaveText(["Arch Manning", "Leader unavailable", "Ryan Wingo"]);
  await expect(teamScreen(page).locator(".feed-banner")).toContainText("Showing the season checked");
  await expect(teamScreen(page).locator(".team-leaders-status")).toContainText("Some season leaders couldn’t be loaded");
  await page.screenshot({ path: info.outputPath("leaders-partial-stale-320.png"), fullPage: true, animations: "disabled" });
  candidate = TEXAS_SEASON;
  await teamScreen(page).locator('[data-focus-key="leaders-retry"]').click();
  await expect(teamScreen(page).locator(".team-leader-name")).toHaveText(["Arch Manning", "Daylan Smothers", "Ryan Wingo"]);
});
test("incomplete coverage and hidden started Duke omit every new name and number from DOM and accessible text", async ({ page, harness }, info) => {
  // SYNTHETIC injected leader sentinels on existing Duke fixture solely exercise aggregate withholding.
  let candidate = { ...SEASONS[150], leaders: TEXAS_SEASON.leaders };
  serveCandidate(harness, () => candidate);
  await page.setViewportSize({ width: 320, height: 900 });
  await harness.open({ path: "/?team=150", waitForScores: false });
  await verifyFixtureMute(page);
  await expect(teamScreen(page).locator(".team-leader-name").first()).toHaveText("Arch Manning");
  await page.evaluate(id => {
    const key = "ss:duke-visibility:v2", stored = JSON.parse(localStorage.getItem(key)) ?? { version: 2, rules: [{ from: 0, mode: "away" }], manual: {}, remembered: {}, waiting: {} };
    const value = JSON.stringify({ ...stored, manual: { ...stored.manual, [id]: true } });
    localStorage.setItem(key, value); dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }, TULANE_GAME);
  await expect(teamScreen(page).getByText("Record and season statistics hidden")).toBeVisible();
  expect(await teamScreen(page).textContent()).not.toMatch(/Arch Manning|Daylan Smothers|Ryan Wingo|1,298/);
  expect(await teamScreen(page).ariaSnapshot()).not.toMatch(/Arch Manning|Daylan Smothers|Ryan Wingo|1,298/);
  await expect(teamScreen(page).locator(".team-leader-row")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("leaders-protected-320.png"), fullPage: true, animations: "disabled" });
  candidate = { ...TEXAS_SEASON, postseason: { status: "unavailable" } };
  await page.goto("/?team=251");
  await expect(teamScreen(page).getByText("Record and season statistics not shown yet")).toBeVisible();
  expect(await teamScreen(page).textContent()).not.toMatch(/Arch Manning|Daylan Smothers|Ryan Wingo|1,298/);
  await expect(teamScreen(page).locator(".team-leader-row")).toHaveCount(0);
});

// #189: genuine captured Texas totals and independently verified current ranks;
// transport/stale/unavailable/privacy variations are SYNTHETIC, never hosted proof.
const TEXAS_RANKINGS = { year: 2026, games: 6, population: 138, checkedAt: '2026-10-23T19:51:58.000Z', stale: false, metrics: Object.fromEntries(['totalYards','netPassingYards','rushingYards','totalYardsOpponent','netPassingYardsOpponent','rushingYardsOpponent'].map((k,i)=>[k,{total:[2168,1361,807,1635,997,638][i],games:6,rank:[93,74,102,11,12,27][i],population:138,coverage:138,tied:false}])) };
for (const [width, zoom] of [[320, false], [390, false], [390, true]]) {
  test(`separate FBS rankings preserve current team flow at ${width}px${zoom ? ' large text' : ''}`, async ({ page, harness }, info) => {
    serveCandidate(harness,()=>({...TEXAS_SEASON,rankings:TEXAS_RANKINGS}));
    await page.setViewportSize({width,height:900});
    await harness.open({path:'/?team=251',now:'2026-10-23T20:00:00Z',waitForScores:false});
    await verifyFixtureMute(page);
    if(zoom)await page.addStyleTag({content:ZOOM});
    const section=teamScreen(page).locator('.team-rankings');
    await expect(section).toContainText('2026 season · yards per game');
    await expect(section).toContainText('6 games reported by CFBD for Texas');
    await expect(section.locator('.rank-cell b')).toHaveText(['361.3','272.5','226.8','166.2','134.5','106.3']);
    await expect(section.locator('.rank-cell small')).toHaveText(['93 of 138','11 of 138','74 of 138','12 of 138','102 of 138','27 of 138']);
    const before=await teamScreen(page).locator('[aria-labelledby="team-averages-h"]').boundingBox(),after=await section.boundingBox();
    expect(before.y+before.height).toBeLessThanOrEqual(after.y+1);
    await section.getByText('How these rankings work',{exact:true}).click();
    await expect(section.locator('details')).toHaveAttribute('open','');
    await expect(section).toContainText('statistical ranks, not poll rankings');
    expect(await noOverflow(page)).toBe(true);
    await expect(teamScreen(page).locator('a.sched-row')).toHaveCount(12);
    await page.screenshot({path:info.outputPath(`rankings-${width}${zoom?'-zoom200':''}.png`),fullPage:true,animations:'disabled'});
  });
}
test('incomplete Duke schedule omits ranking values and methodology from all rendered markup',async({page,harness})=>{
 serveCandidate(harness,()=>({...TEXAS_SEASON,rankings:TEXAS_RANKINGS,postseason:{status:'unavailable'}}));
 await harness.open({path:'/?team=251',now:'2026-10-23T20:00:00Z',waitForScores:false});await verifyFixtureMute(page);
 await expect(teamScreen(page).locator('.team-rankings')).toHaveCount(0);await expect(teamScreen(page)).not.toContainText('93 of 138');
});
