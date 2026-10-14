import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, event, NOW } from "./fixtures.mjs";
import { bundle } from "../helpers.mjs";

// Stats responses are the real normalizer's output for the saved public ESPN
// fixtures, served through the intercepted same-origin route. The Worker
// runtime and real upstream are verified separately (docs/game-stats.md).
const { normalizeGameStats } = await bundle("lib/game-stats.ts");
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/espn-summary-${name}.json`, import.meta.url), "utf8"));
const FINAL = { id: "401858481", teams: ["84", "158"] }, PREGAME = { id: "401856715", teams: ["99", "96"] }, LIVE = { id: "401856717", teams: ["251", "201"] };

function matchup({ id, teams }, options) {
  const e = event(id, options);
  e.competitions[0].competitors.forEach((c, i) => { c.id = teams[i]; c.team.id = teams[i]; });
  return e;
}
function serve(harness, { fail = 0, gate } = {}) {
  let failures = fail;
  harness.state.stats = async (url, route) => {
    if (gate) await gate;
    if (failures > 0) { failures--; return route.fulfill({ status: 503, contentType: "application/json", headers: { "Retry-After": "300" }, body: "{}" }); }
    const id = url.searchParams.get("event"), name = id === FINAL.id ? "final" : id === PREGAME.id ? "pregame" : "live";
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(normalizeGameStats(fixture(name), id, new Date(Date.parse(NOW) - 5000).toISOString())) });
  };
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const screen = page => page.locator(".game-screen");
async function openGame(page, id, how = "tap") {
  const link = page.locator(`#game-${id} a.game-summary`);
  if (how === "tap") await link.tap(); else { await link.focus(); await page.keyboard.press("Enter"); }
  await expect(screen(page)).toBeVisible();
  await expect(page.locator(".scores-view")).toBeHidden();
}
const view = (page, name) => screen(page).getByRole("button", { name, exact: true });

test("first tap opens the dedicated screen with the final team comparison; Player stats by touch, Enter and Space", async ({ page, harness }, info) => {
  let release;
  serve(harness, { gate: new Promise(resolve => { release = resolve; }) });
  harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] }), matchup(PREGAME, { state: "upcoming", rank: 9, date: "2026-09-06T01:00:00Z" })];
  await harness.open();
  expect(harness.state.statsRequests).toEqual([]); // No eager prefetch from the scoreboard.
  await openGame(page, FINAL.id);
  expect(new URL(page.url()).searchParams.get("event")).toBe(FINAL.id);
  await expect(screen(page).getByRole("status").filter({ hasText: "Loading team stats…" })).toBeVisible();
  release();
  const table = screen(page).locator("table.compare-table").first();
  await expect(table.locator("caption")).toHaveText(/Team stats/);
  await expect(table.getByRole("row", { name: /Total yards/ })).toContainText("328");
  // All 15 game metrics are on the default Team stats section, with no disclosure.
  await expect(screen(page).locator("table.compare-table tbody tr")).toHaveCount(15);
  await expect(screen(page).getByRole("row", { name: /Fourth-down conversions/ })).toBeVisible();
  await expect(screen(page).getByText("Stats checked at")).toBeVisible();
  expect(harness.state.statsRequests).toEqual([`?event=${FINAL.id}&phase=final&refresh=0`]);
  // Game details stay in the app: score and status, with no external Gamecast link (user request).
  await expect(screen(page).locator(".mh-score")).toHaveText(["20", "17"]);
  await expect(screen(page).getByRole("link")).toHaveCount(0);
  await expect(screen(page).getByText("Gamecast")).toHaveCount(0);
  const team = view(page, "Team stats"), players = view(page, "Player stats");
  for (const control of [team, players]) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await players.tap();
  await expect(players).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/section=players/);
  await expect(screen(page).getByRole("region", { name: /receiving statistics$/ }).first()).toBeVisible();
  await team.focus(); await page.keyboard.press("Enter");
  await expect(team).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/section=players/);
  await players.focus(); await page.keyboard.press("Space");
  await expect(players).toHaveAttribute("aria-pressed", "true");
  expect(await noOverflow(page)).toBe(true);
  // A scoreboard poll keeps the screen, its section and focus without new stats work.
  const scoreRequests = harness.state.scoreRequests.length;
  await page.clock.fastForward(30_000);
  await expect.poll(() => harness.state.scoreRequests.length).toBeGreaterThan(scoreRequests);
  await expect(players).toHaveAttribute("aria-pressed", "true");
  await expect(players).toBeFocused();
  expect(harness.state.statsRequests).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("final-stats.png"), fullPage: true, animations: "disabled" });
});

test("pregame season averages are labeled per game and Player stats waits for kickoff", async ({ page, harness }) => {
  serve(harness);
  harness.state.events = [matchup(PREGAME, { state: "upcoming", rank: 9, date: "2026-09-06T01:00:00Z" })];
  await harness.open();
  await openGame(page, PREGAME.id);
  await expect(screen(page).getByRole("heading", { name: "Season averages" })).toBeVisible();
  await expect(screen(page).getByRole("row", { name: /Points scored/ })).toContainText("per game");
  await expect(screen(page).getByText("These are not game totals.")).toBeVisible();
  await view(page, "Player stats").tap();
  await expect(screen(page).getByText("Player stats start after kickoff")).toBeVisible();
  await expect(screen(page).locator(".player-table")).toHaveCount(0);
  expect(harness.state.statsRequests).toEqual([`?event=${PREGAME.id}&phase=pregame&refresh=0`]);
});

test("live stats: opening loads started totals, the source status shows separately, it polls every 30s while open and stops on Back", async ({ page, harness }) => {
  serve(harness);
  harness.state.events = [matchup(LIVE, { state: "live" })];
  await harness.open();
  await openGame(page, LIVE.id);
  await expect(screen(page).getByRole("heading", { name: "Team stats", level: 2 })).toBeVisible();
  await expect(screen(page).getByRole("row", { name: /Total yards/ })).toContainText("235");
  await expect(screen(page).getByText("Source reports 3:48 - 3rd")).toBeVisible();
  await expect(screen(page).locator("a.gamecast, a[target=\"_blank\"]")).toHaveCount(0);
  expect(harness.state.statsRequests).toEqual([`?event=${LIVE.id}&phase=started&refresh=0`]);
  await page.clock.fastForward(31_000);
  await expect.poll(() => harness.state.statsRequests.length).toBe(2);
  // Leaving the screen stops polling.
  await screen(page).getByRole("button", { name: /^Back to scores/ }).tap();
  await expect(screen(page)).toHaveCount(0);
  await page.clock.fastForward(61_000);
  expect(harness.state.statsRequests).toHaveLength(2);
});

test("a stats failure stays explicit on the screen; Retry waits for backoff, then one attempt loads stats", async ({ page, harness }) => {
  serve(harness, { fail: 1 });
  harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] })];
  // 6 p.m. ET, so the five-minute wait cannot roll "Today" past midnight.
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  await openGame(page, FINAL.id);
  await expect(screen(page).getByText("Stats could not be loaded")).toBeVisible();
  await expect(screen(page).locator(".mh-score").first()).toHaveText("20");
  // Retry-After: 300 is honored: the control is disabled with an honest wait and no early request.
  // The stats Retry specifically: CI observed the score-feed warning's own Retry on screen at the same time.
  const retry = screen(page).locator('[data-focus-key="stats-retry"]');
  await expect(retry).toHaveCount(1);
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/Retry in 5m/);
  await page.clock.fastForward(120_000);
  await expect(retry).toHaveText(/Retry in 3m/);
  expect(harness.state.statsRequests).toHaveLength(1);
  // When the backoff allows it, exactly one attempt runs.
  await page.clock.fastForward(181_000);
  await expect(screen(page).getByRole("row", { name: /Total yards/ })).toContainText("391");
  expect(harness.state.statsRequests).toHaveLength(2);
});

const ZOOM = "html { zoom: 2; }";
// Linux CI WebKit falls back to wider fonts than macOS; "wide" forces comparable metrics
// (Verdana, else DejaVu Sans) so that layout risk is exercised on every platform.
const WIDE_FONT = "*, *::before, *::after { font-family: Verdana, 'DejaVu Sans', sans-serif !important; }";
for (const [width, height, zoom, wide] of [[393, 852, false], [440, 956, false], [820, 1180, false], [1180, 820, false], [1440, 1000, false], [393, 852, true], [393, 852, true, true]]) {
  test(`no page-wide overflow on the game screen at ${width}×${height}${zoom ? " with actual 200% CSS zoom" : ""}${wide ? " and wide fallback fonts" : ""}`, async ({ page, harness }, info) => {
    serve(harness);
    harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] }), matchup(PREGAME, { state: "upcoming", rank: 9, date: "2026-09-06T01:00:00Z" })];
    await page.setViewportSize({ width, height });
    await harness.open();
    if (zoom) {
      await page.addStyleTag({ content: ZOOM + (wide ? WIDE_FONT : "") });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("2");
      // The existing header navigation stays inside its row, with 44px targets, before any game opens.
      expect(await noOverflow(page)).toBe(true);
      const nav = await page.locator(".destination-nav").evaluate(el => { const box = el.getBoundingClientRect(), style = getComputedStyle(el); return { right: box.right - parseFloat(style.paddingRight), links: [...el.querySelectorAll("a")].map(a => { const b = a.getBoundingClientRect(); return { right: b.right, height: b.height }; }) }; });
      for (const link of nav.links) { expect(link.right).toBeLessThanOrEqual(nav.right + 0.5); expect(link.height).toBeGreaterThanOrEqual(44); }
    }
    await openGame(page, PREGAME.id);
    await expect(screen(page).getByRole("heading", { name: "Season averages" })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await screen(page).getByRole("button", { name: /^Back to scores/ }).tap();
    await openGame(page, FINAL.id);
    await expect(screen(page).getByRole("row", { name: /Fumbles lost/ })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: info.outputPath(`team-${width}x${height}${zoom ? "-zoom200" : ""}${wide ? "-wide" : ""}.png`), fullPage: true, animations: "disabled" });
    await view(page, "Player stats").tap();
    await expect(screen(page).getByRole("region", { name: /receiving statistics$/ }).first()).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    // Any player-table overflow is contained in its named region, not the page.
    for (const region of await screen(page).getByRole("region", { name: /statistics$/ }).all()) {
      expect(await region.evaluate(el => getComputedStyle(el).overflowX)).toBe("auto");
      expect(await region.getAttribute("tabindex")).toBe("0");
    }
    await page.screenshot({ path: info.outputPath(`players-${width}x${height}${zoom ? "-zoom200" : ""}${wide ? "-wide" : ""}.png`), fullPage: true, animations: "disabled" });
  });
}

// Hardware-keyboard scrolling is exercised in desktop (non-touch) contexts for both engines.
// Mobile-emulated WebKit does not arrow-key scroll overflow regions; touch is its input there.
test.describe("desktop hardware keyboard", () => {
  test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: async ({ browserName }, provide) => provide(devices[browserName === "webkit" ? "Desktop Safari" : "Desktop Chrome"].userAgent) });
  for (const [width, height, zoom, wide] of [[320, 800, false], [393, 852, true], [393, 852, true, true]]) {
    test(`Tab reaches the player-table region and arrow keys scroll only it at ${width}×${height}${zoom ? " with 200% CSS zoom" : ""}${wide ? " and wide fallback fonts" : ""}`, async ({ page, harness, browserName }, info) => {
      serve(harness);
      harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] })];
      await page.setViewportSize({ width, height });
      await harness.open();
      if (zoom) await page.addStyleTag({ content: ZOOM + (wide ? WIDE_FONT : "") });
      await openGame(page, FINAL.id, "keyboard");
      // Arrival focus is on the screen's heading.
      await expect(screen(page).locator("h1.game-title")).toBeFocused();
      const players = view(page, "Player stats");
      await players.focus(); await page.keyboard.press("Space");
      await expect(players).toHaveAttribute("aria-pressed", "true");
      const region = screen(page).getByRole("region", { name: /passing statistics/ }).first();
      await expect(region).toBeVisible();
      // Reach the first player region with Tab alone.
      for (let i = 0; i < 8 && !(await region.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press("Tab");
      await expect(region).toBeFocused();
      const metrics = await region.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(metrics.scroll, "the table overflows its region at this size").toBeGreaterThan(metrics.client);
      const pageX = await page.evaluate(() => scrollX);
      // Native keyboard scrolling only. Playwright desktop WebKit ignores the first arrow press
      // after focus and scrolls (smoothly) on later presses; record the count rather than hide it.
      let presses = 0;
      for (; presses < 3 && (await region.evaluate(el => el.scrollLeft)) <= 0; presses++) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(600);
      }
      expect(await region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      expect(presses).toBeLessThanOrEqual(browserName === "chromium" ? 1 : 2);
      console.log(`keyboard-scroll ${browserName} ${info.title}: ArrowRight presses to first scroll = ${presses}`);
      expect(await page.evaluate(() => scrollX)).toBe(pageX);
      for (let i = 0; i < 3 && (await region.evaluate(el => el.scrollLeft)) > 0; i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(600); }
      expect(await region.evaluate(el => el.scrollLeft)).toBeLessThanOrEqual(0);
      expect(await noOverflow(page)).toBe(true);
    });
  }
});

// A score-status change moves the hidden scoreboard card between sections (a remount).
function setStatus(e, status) {
  e.status.type = { ...e.status.type, ...status };
  return e;
}
const SUSPENDED = { name: "STATUS_SUSPENDED", state: "in", completed: false, shortDetail: "Suspended" };
const IN_PROGRESS = { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "3:00 - 4th" };

test("a live ↔ paused change keeps the open screen, its section, focused control and scroll", async ({ page, harness }) => {
  serve(harness);
  const live = matchup(LIVE, { state: "live", rank: 7 });
  harness.state.events = [live, ...["a", "b", "c"].map(id => event(`other-final-${id}`, { state: "final", scores: [21, 17] }))];
  await page.setViewportSize({ width: 393, height: 640 });
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  await openGame(page, LIVE.id);
  await view(page, "Player stats").tap();
  const region = screen(page).getByRole("region", { name: /receiving statistics$/ }).first();
  await region.focus();
  await page.evaluate(() => scrollTo(0, 260));
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(0);
  for (const [status, state] of [[SUSPENDED, "Suspended"], [IN_PROGRESS, "3:00 - 4th"]]) {
    setStatus(live, status);
    await page.clock.fastForward(30_000);
    await expect(screen(page).locator(".mh-state")).toContainText(state);
    await expect(region).toBeFocused();
    await expect(view(page, "Player stats")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  }
  setStatus(live, SUSPENDED);
  await page.clock.fastForward(30_000);
  await expect(screen(page).getByText("Play is paused")).toBeVisible();
});

test("a card moving on the hidden scoreboard does not steal focus from the screen or undo a blur", async ({ page, harness }) => {
  serve(harness);
  const live = matchup(LIVE, { state: "live", rank: 7 });
  harness.state.events = [live];
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  // Focus a card control first so the scoreboard's restoration routine has a saved target.
  await page.locator(`#game-${LIVE.id} a.game-summary`).focus();
  await openGame(page, LIVE.id, "keyboard");
  const team = view(page, "Team stats");
  await team.focus();
  setStatus(live, SUSPENDED);
  await page.clock.fastForward(30_000);
  await expect(page.locator(".score-section", { has: page.locator(`#game-${LIVE.id}`) }).locator("h2")).toHaveText("Delayed");
  await expect(team).toBeFocused();
  // A deliberate blur to the page is not undone by a later move either.
  await team.evaluate(el => el.blur());
  setStatus(live, IN_PROGRESS);
  await page.clock.fastForward(30_000);
  await expect(page.locator(".score-section", { has: page.locator(`#game-${LIVE.id}`) }).locator("h2")).toHaveText("On now");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(screen(page)).toBeVisible();
});

test("a failed live refresh keeps its warning and backoff after play pauses", async ({ page, harness }) => {
  let fail = false;
  serve(harness);
  const ok = harness.state.stats;
  harness.state.stats = (url, route) => fail ? route.fulfill({ status: 503, contentType: "application/json", headers: { "Retry-After": "300" }, body: "{}" }) : ok(url, route);
  const live = matchup(LIVE, { state: "live", rank: 7 });
  harness.state.events = [live];
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  await openGame(page, LIVE.id);
  await expect(screen(page).getByRole("row", { name: /Total yards/ })).toContainText("235");
  fail = true;
  await page.clock.fastForward(31_000);
  await expect(screen(page).getByText("Stats may be out of date")).toBeVisible();
  const requests = harness.state.statsRequests.length;
  setStatus(live, SUSPENDED);
  await page.clock.fastForward(30_000);
  await expect(screen(page).locator(".mh-state")).toContainText("Suspended");
  await expect(screen(page).getByText("Stats may be out of date")).toBeVisible();
  await expect(screen(page).getByRole("button", { name: /Retry in/ })).toBeDisabled();
  await expect(screen(page).getByText("Play is paused")).toBeVisible();
  expect(harness.state.statsRequests).toHaveLength(requests);
});
