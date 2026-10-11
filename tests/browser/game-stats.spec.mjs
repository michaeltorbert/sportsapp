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

test("first tap loads the final team comparison; disclosures toggle independently by touch, Enter and Space", async ({ page, harness }, info) => {
  let release;
  serve(harness, { gate: new Promise(resolve => { release = resolve; }) });
  harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] }), matchup(PREGAME, { state: "upcoming", rank: 9, date: "2026-09-06T01:00:00Z" })];
  await harness.open();
  expect(harness.state.statsRequests).toEqual([]); // No eager prefetch for collapsed cards.
  const card = page.locator(`#game-${FINAL.id}`);
  await card.locator("summary").tap();
  await expect(card.getByRole("status").filter({ hasText: "Loading team stats…" })).toBeVisible();
  release();
  const table = card.locator("table.stats-table").first();
  await expect(table.locator("caption")).toHaveText(/Team stats/);
  await expect(table.getByRole("row", { name: /Total yards/ })).toContainText("328");
  await expect(card.getByText("Stats checked at")).toBeVisible();
  expect(harness.state.statsRequests).toEqual([`?event=${FINAL.id}&phase=final&refresh=0`]);
  // Existing details remain: Gamecast link stays last in the card.
  await expect(card.locator(".game-details > :last-child a.gamecast")).toBeVisible();
  const details = card.getByRole("button", { name: /Team details/ }), players = card.getByRole("button", { name: /Players/ });
  for (const control of [details, players]) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await details.tap();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByRole("region", { name: /Team details for/ })).toContainText("Fourth-down conversions");
  await expect(players).toHaveAttribute("aria-expanded", "false");
  await players.focus(); await page.keyboard.press("Enter");
  await expect(players).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByRole("region", { name: /Players for/ })).toContainText("Receiving");
  await details.focus(); await page.keyboard.press("Space");
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await expect(players).toHaveAttribute("aria-expanded", "true");
  // The outer card stayed open throughout.
  await expect(card.locator("details")).toHaveAttribute("open", "");
  expect(await noOverflow(page)).toBe(true);
  // A scoreboard poll keeps the expanded card, inner disclosure state and focus without new stats work.
  const scoreRequests = harness.state.scoreRequests.length;
  await details.focus();
  await page.clock.fastForward(30_000);
  await expect.poll(() => harness.state.scoreRequests.length).toBeGreaterThan(scoreRequests);
  await expect(card.locator("details")).toHaveAttribute("open", "");
  await expect(players).toHaveAttribute("aria-expanded", "true");
  await expect(details).toBeFocused();
  expect(harness.state.statsRequests).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("final-stats.png"), fullPage: true, animations: "disabled" });
});

test("pregame season averages are labeled per game and have no Players section", async ({ page, harness }) => {
  serve(harness);
  harness.state.events = [matchup(PREGAME, { state: "upcoming", rank: 9, date: "2026-09-06T01:00:00Z" })];
  await harness.open();
  const card = page.locator(`#game-${PREGAME.id}`);
  await card.locator("summary").tap();
  await expect(card.getByRole("heading", { name: "Season averages" })).toBeVisible();
  await expect(card.getByRole("row", { name: /Points scored/ })).toContainText("per game");
  await expect(card.getByRole("button", { name: /Players/ })).toHaveCount(0);
  expect(harness.state.statsRequests).toEqual([`?event=${PREGAME.id}&phase=pregame&refresh=0`]);
});

test("live stats: first tap loads started game totals, the source status shows separately, and it polls every 30s while open", async ({ page, harness }) => {
  serve(harness);
  harness.state.events = [matchup(LIVE, { state: "live" })];
  await harness.open();
  const card = page.locator(`#game-${LIVE.id}`);
  await card.locator("summary").tap();
  await expect(card.getByRole("heading", { name: "Team stats" })).toBeVisible();
  await expect(card.getByRole("row", { name: /Total yards/ })).toContainText("235");
  await expect(card.getByText("Source reports 3:48 - 3rd")).toBeVisible();
  await expect(card.locator("a.gamecast")).toBeVisible();
  expect(harness.state.statsRequests).toEqual([`?event=${LIVE.id}&phase=started&refresh=0`]);
  await page.clock.fastForward(31_000);
  await expect.poll(() => harness.state.statsRequests.length).toBe(2);
  // Collapsing stops polling.
  await card.locator("summary").tap();
  await page.clock.fastForward(61_000);
  expect(harness.state.statsRequests).toHaveLength(2);
});

test("a stats failure stays in the card; Retry waits for backoff, then one attempt loads stats", async ({ page, harness }) => {
  serve(harness, { fail: 1 });
  harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] })];
  // 6 p.m. ET, so the five-minute wait cannot roll "Today" past midnight.
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  const card = page.locator(`#game-${FINAL.id}`);
  await card.locator("summary").tap();
  await expect(card.getByText("Stats could not be loaded")).toBeVisible();
  await expect(card.locator(".score").first()).toHaveText("20");
  // Retry-After: 300 is honored: the control is disabled with an honest wait and no early request.
  const retry = card.getByRole("button", { name: /Retry/ });
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText(/Retry in 5m/);
  await page.clock.fastForward(120_000);
  await expect(retry).toHaveText(/Retry in 3m/);
  expect(harness.state.statsRequests).toHaveLength(1);
  // When the backoff allows it, exactly one attempt runs.
  await page.clock.fastForward(181_000);
  await expect(card.getByRole("row", { name: /Total yards/ })).toContainText("391");
  expect(harness.state.statsRequests).toHaveLength(2);
});

const ZOOM = "html { zoom: 2; }";
// Linux CI WebKit falls back to wider fonts than macOS; "wide" forces comparable metrics
// (Verdana, else DejaVu Sans) so that layout risk is exercised on every platform.
const WIDE_FONT = "*, *::before, *::after { font-family: Verdana, 'DejaVu Sans', sans-serif !important; }";
for (const [width, height, zoom, wide] of [[393, 852, false], [440, 956, false], [820, 1180, false], [1180, 820, false], [1440, 1000, false], [393, 852, true], [393, 852, true, true]]) {
  test(`no page-wide overflow with stats and players open at ${width}×${height}${zoom ? " with actual 200% CSS zoom" : ""}${wide ? " and wide fallback fonts" : ""}`, async ({ page, harness }, info) => {
    serve(harness);
    harness.state.events = [matchup(FINAL, { state: "final", scores: [20, 17] }), matchup(PREGAME, { state: "upcoming", rank: 9, date: "2026-09-06T01:00:00Z" })];
    await page.setViewportSize({ width, height });
    await harness.open();
    if (zoom) {
      await page.addStyleTag({ content: ZOOM + (wide ? WIDE_FONT : "") });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("2");
      // The existing header navigation stays inside its row, with 44px targets, before any card opens.
      expect(await noOverflow(page)).toBe(true);
      const nav = await page.locator(".destination-nav").evaluate(el => { const box = el.getBoundingClientRect(), style = getComputedStyle(el); return { right: box.right - parseFloat(style.paddingRight), links: [...el.querySelectorAll("a")].map(a => { const b = a.getBoundingClientRect(); return { right: b.right, height: b.height }; }) }; });
      for (const link of nav.links) { expect(link.right).toBeLessThanOrEqual(nav.right + 0.5); expect(link.height).toBeGreaterThanOrEqual(44); }
    }
    for (const id of [FINAL.id, PREGAME.id]) await page.locator(`#game-${id} summary`).tap();
    const card = page.locator(`#game-${FINAL.id}`);
    await card.getByRole("button", { name: /Team details/ }).tap();
    await card.getByRole("button", { name: /Players/ }).tap();
    await expect(card.getByRole("region", { name: /Players for/ })).toBeVisible();
    await expect(page.locator(`#game-${PREGAME.id}`).getByRole("heading", { name: "Season averages" })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    // Any player-table overflow is contained in its named region, not the page.
    for (const region of await card.getByRole("region", { name: /statistics$/ }).all()) {
      expect(await region.evaluate(el => getComputedStyle(el).overflowX)).toBe("auto");
      expect(await region.getAttribute("tabindex")).toBe("0");
    }
    await page.screenshot({ path: info.outputPath(`stats-${width}x${height}${zoom ? "-zoom200" : ""}${wide ? "-wide" : ""}.png`), fullPage: true, animations: "disabled" });
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
      const card = page.locator(`#game-${FINAL.id}`);
      await card.locator("summary").focus(); await page.keyboard.press("Enter");
      const players = card.getByRole("button", { name: /Players/ });
      await expect(players).toBeVisible();
      await players.focus(); await page.keyboard.press("Space");
      await expect(players).toHaveAttribute("aria-expanded", "true");
      const region = card.getByRole("region", { name: /passing statistics/ }).first();
      // Reach the first player region with Tab alone.
      for (let i = 0; i < 6 && !(await region.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press("Tab");
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

// A score-status change moves a card between state sections (a remount).
function setStatus(e, status) {
  e.status.type = { ...e.status.type, ...status };
  return e;
}
const SUSPENDED = { name: "STATUS_SUSPENDED", state: "in", completed: false, shortDetail: "Suspended" };
const IN_PROGRESS = { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "3:00 - 4th" };

test("a live ↔ paused section move keeps the focused stats control, disclosures, expansion and scroll", async ({ page, harness }) => {
  serve(harness);
  const live = matchup(LIVE, { state: "live", rank: 7 });
  harness.state.events = [live, ...["a", "b", "c"].map(id => event(`other-final-${id}`, { state: "final", scores: [21, 17] }))];
  await page.setViewportSize({ width: 393, height: 640 });
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  const card = page.locator(`#game-${LIVE.id}`);
  await card.locator("summary").tap();
  const details = card.getByRole("button", { name: /Team details/ }), players = card.getByRole("button", { name: /Players/ });
  await details.tap();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await details.focus();
  await page.evaluate(() => scrollTo(0, 260));
  const before = await page.evaluate(() => scrollY);
  for (const [status, section] of [[SUSPENDED, "Delayed"], [IN_PROGRESS, "On now"]]) {
    setStatus(live, status);
    await page.clock.fastForward(30_000);
    await expect(page.locator(".score-section", { has: card }).locator("h2")).toHaveText(section);
    await expect(details).toBeFocused();
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(players).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator("details")).toHaveAttribute("open", "");
    // Fully visible, allowing subpixel rounding from scrollIntoView.
    expect(await details.evaluate(el => { const box = el.getBoundingClientRect(); return box.top >= -1 && box.bottom <= innerHeight + 1; })).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  }
  expect(before).toBeGreaterThan(0);
  // The existing summary control is restored the same way.
  await card.locator("summary").focus();
  setStatus(live, SUSPENDED);
  await page.clock.fastForward(30_000);
  await expect(page.locator(".score-section", { has: card }).locator("h2")).toHaveText("Delayed");
  await expect(card.locator("summary")).toBeFocused();
  await expect(card.locator("details")).toHaveAttribute("open", "");
});

test("a section move does not steal focus held outside the card", async ({ page, harness }) => {
  serve(harness);
  const live = matchup(LIVE, { state: "live", rank: 7 });
  harness.state.events = [live];
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  const card = page.locator(`#game-${LIVE.id}`);
  await card.locator("summary").tap();
  await card.getByRole("button", { name: /Team details/ }).focus();
  // The user moves focus elsewhere before the score update.
  const hide = page.getByLabel("Hide finals");
  await hide.focus();
  setStatus(live, SUSPENDED);
  await page.clock.fastForward(30_000);
  await expect(page.locator(".score-section", { has: card }).locator("h2")).toHaveText("Delayed");
  await expect(hide).toBeFocused();
  // A deliberate blur to the page is not undone by a later move either.
  await card.getByRole("button", { name: /Team details/ }).focus();
  await card.getByRole("button", { name: /Team details/ }).evaluate(el => el.blur());
  setStatus(live, IN_PROGRESS);
  await page.clock.fastForward(30_000);
  await expect(page.locator(".score-section", { has: card }).locator("h2")).toHaveText("On now");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("a failed live refresh keeps its warning and backoff after the card moves to Delayed", async ({ page, harness }) => {
  let fail = false;
  serve(harness);
  const ok = harness.state.stats;
  harness.state.stats = (url, route) => fail ? route.fulfill({ status: 503, contentType: "application/json", headers: { "Retry-After": "300" }, body: "{}" }) : ok(url, route);
  const live = matchup(LIVE, { state: "live", rank: 7 });
  harness.state.events = [live];
  await harness.open({ now: "2026-09-05T22:00:00Z" });
  const card = page.locator(`#game-${LIVE.id}`);
  await card.locator("summary").tap();
  await expect(card.getByRole("row", { name: /Total yards/ })).toContainText("235");
  fail = true;
  await page.clock.fastForward(31_000);
  await expect(card.getByText("Stats may be out of date")).toBeVisible();
  const requests = harness.state.statsRequests.length;
  setStatus(live, SUSPENDED);
  await page.clock.fastForward(30_000);
  await expect(page.locator(".score-section", { has: card }).locator("h2")).toHaveText("Delayed");
  await expect(card.getByText("Stats may be out of date")).toBeVisible();
  await expect(card.getByRole("button", { name: /Retry in/ })).toBeDisabled();
  await expect(card.getByText("Play is paused")).toBeVisible();
  expect(harness.state.statsRequests).toHaveLength(requests);
});
