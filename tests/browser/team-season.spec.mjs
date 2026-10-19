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

test("board → game → team → schedule game: in-app links, owned Back and Forward with focus and scroll, and no framework navigation", async ({ page, harness }, info) => {
  serveTeams(harness); board(harness);
  await page.setViewportSize({ width: 393, height: 852 });
  await harness.open();
  expect(harness.state.teamRequests, "the scoreboard does no team work").toEqual([]);
  await page.evaluate(() => { window.__main = document.querySelector("main"); });
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

test("a schedule game opened directly or reloaded is found only in its team's checked schedule; Back falls back to the team, then Scores", async ({ page, harness }) => {
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
  // A fresh document (as a new tab would open it; interception is per page) works from the URL alone.
  await page.goto("/?team=150");
  await expect(teamScreen(page).locator("h1.team-title")).toHaveText("Duke Blue Devils");
  expect(await entry(page)).toMatchObject({ kind: "team", team: "150", from: false });
  // Membership is exact: an event outside the context team's schedule is unavailable, whatever the URL says.
  await page.goto(`/?event=${DUKE_ONLY}&team=153`);
  await expect(gameScreen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  await expect(gameScreen(page).locator(".masthead")).toHaveCount(0);
  await page.goto(`/?event=401999999&team=150`);
  await expect(gameScreen(page).getByRole("heading", { name: "This game isn’t available" })).toBeVisible();
  // A malformed team is no team page and makes no request.
  const requests = harness.state.teamRequests.length;
  await page.goto(`/?team=abc`);
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
  await expect(teamScreen(page).getByText("Record and averages hidden")).toBeVisible();
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
  await expect(teamScreen(page).getByText("Record and averages not shown yet")).toBeVisible();
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

const ZOOM = "html { zoom: 2; }";
const WIDE_FONT = "*, *::before, *::after { font-family: Verdana, 'DejaVu Sans', sans-serif !important; }";
for (const [width, height, zoom, wide] of [[375, 812, false], [1440, 1000, false], [375, 812, true], [375, 812, true, true]]) {
  test(`the team page reads without page overflow at ${width}×${height}${zoom ? " with actual 200% CSS zoom" : ""}${wide ? " and wide fallback fonts" : ""}`, async ({ page, harness }, info) => {
    serveTeams(harness);
    await page.setViewportSize({ width, height });
    await harness.open({ path: "/?team=150", waitForScores: false });
    if (zoom) await page.addStyleTag({ content: ZOOM + (wide ? WIDE_FONT : "") });
    await expect(teamScreen(page).locator("a.sched-row")).toHaveCount(12);
    // The fixture's logo is failed before the network by the harness; the abbreviation tile stands in.
    await expect(teamScreen(page).locator(".team-head .mh-logo")).toHaveText("DUKE");
    expect(harness.state.logoRequests).toContain("/i/teamlogos/ncaa/500/150.png");
    expect(await noOverflow(page)).toBe(true);
    // Every control is at least 44 CSS px tall; full names wrap inside their row.
    const small = await teamScreen(page).locator("a, button").evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44).map(el => el.outerHTML.slice(0, 80)));
    expect(small).toEqual([]);
    const clipped = await teamScreen(page).locator(".s-name, .team-title").evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).length);
    expect(clipped).toBe(0);
    const [side, main] = await Promise.all([".team-side", ".team-main"].map(s => teamScreen(page).locator(s).boundingBox()));
    if (width >= 1440 && !zoom) expect(main.x, "two columns on a wide screen").toBeGreaterThan(side.x + side.width);
    else expect(main.y, "one column on a phone or with large text").toBeGreaterThanOrEqual(side.y + side.height - 1);
    await page.screenshot({ path: info.outputPath(`team-${width}x${height}${zoom ? "-zoom200" : ""}${wide ? "-wide" : ""}.png`), fullPage: true, animations: "disabled" });
  });
}
